let nodeSaml;
try { nodeSaml = require('@node-saml/node-saml'); } catch { nodeSaml = null; }

const { query, getOne } = require('../db/database');
const logger = require('../utils/logger');
const { ROLE_DEFAULTS } = require('./authService');

const SETTINGS_KEY = 'saml_config';

async function getSamlSettings() {
  try {
    const row = await getOne("SELECT value FROM settings WHERE key=$1", [SETTINGS_KEY]);
    if (!row) return null;
    return JSON.parse(row.value);
  } catch { return null; }
}

async function saveSamlSettings(cfg) {
  await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`,
    [SETTINGS_KEY, JSON.stringify(cfg)]
  );
}

function _getSamlInstance(cfg) {
  if (!nodeSaml) throw new Error('@node-saml/node-saml non è installato');
  const appUrl = process.env.APP_URL || 'http://localhost:4681';
  return new nodeSaml.SAML({
    callbackUrl: `${appUrl}/api/auth/saml/acs`,
    entryPoint: cfg.entry_point,
    issuer: cfg.issuer || 'gbmaintenance',
    idpCert: cfg.idp_cert || '',
    privateKey: cfg.sp_private_key || undefined,
    decryptionPvk: cfg.sp_private_key || undefined,
    wantAssertionsSigned: false,
    signatureAlgorithm: 'sha256',
  });
}

async function getMetadata() {
  const cfg = await getSamlSettings();
  if (!cfg || !cfg.enabled) throw new Error('SAML non abilitato');
  const saml = _getSamlInstance(cfg);
  const appUrl = process.env.APP_URL || 'http://localhost:4681';
  return saml.generateServiceProviderMetadata(
    cfg.sp_cert || null,
    cfg.sp_cert || null
  );
}

async function generateAuthUrl(req) {
  const cfg = await getSamlSettings();
  if (!cfg || !cfg.enabled) throw new Error('SAML non abilitato');
  const saml = _getSamlInstance(cfg);
  return new Promise((resolve, reject) => {
    saml.getAuthorizeUrl(req, {}, (err, url) => {
      if (err) reject(err); else resolve(url);
    });
  });
}

async function validateCallback(req) {
  const cfg = await getSamlSettings();
  if (!cfg || !cfg.enabled) throw new Error('SAML non abilitato');
  const saml = _getSamlInstance(cfg);

  const profile = await new Promise((resolve, reject) => {
    saml.validatePostResponse(req.body, (err, profile) => {
      if (err) reject(err); else resolve(profile);
    });
  });

  const username = profile[cfg.username_attr || 'nameID'] || profile.nameID;
  const email    = profile[cfg.email_attr || 'email'] || profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'] || null;
  const display  = profile[cfg.display_name_attr || 'displayName'] || profile['http://schemas.microsoft.com/identity/claims/displayname'] || username;
  const role     = cfg.default_role || 'viewer';
  const perms    = JSON.stringify(ROLE_DEFAULTS[role] || {});

  const existing = await getOne("SELECT id FROM users WHERE username=$1 AND auth_type='saml'", [username]);
  if (existing) {
    await query(
      `UPDATE users SET display_name=$1, email=$2, last_login_at=NOW(), updated_at=NOW(), is_active=true WHERE id=$3`,
      [display, email, existing.id]
    );
    return getOne('SELECT * FROM users WHERE id=$1', [existing.id]);
  } else {
    const colors = ['#6366f1','#8b5cf6','#ec4899','#f59e0b','#10b981','#3b82f6'];
    const color = colors[Math.floor(Math.random() * colors.length)];
    const result = await query(
      `INSERT INTO users (username, display_name, email, role, auth_type, permissions, avatar_color, last_login_at)
       VALUES ($1, $2, $3, $4, 'saml', $5, $6, NOW()) RETURNING id`,
      [username, display, email, role, perms, color]
    );
    return getOne('SELECT * FROM users WHERE id=$1', [result.rows[0].id]);
  }
}

module.exports = { getSamlSettings, saveSamlSettings, getMetadata, generateAuthUrl, validateCallback };
