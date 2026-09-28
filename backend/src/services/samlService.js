let nodeSaml;
try { nodeSaml = require('@node-saml/node-saml'); } catch { nodeSaml = null; }

const { query, getOne } = require('../db/database');
const logger = require('../utils/logger');
const { ROLE_DEFAULTS } = require('./authService');
const ldapService = require('./ldapService');

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

function _stripPem(cert) {
  if (!cert) return '';
  return cert.replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|-----BEGIN CERT-----|-----END CERT-----|\s/g, '');
}

function _getSamlInstance(cfg) {
  if (!nodeSaml) throw new Error('@node-saml/node-saml is not installed');
  const appUrl = cfg.sp_base_url || process.env.APP_URL || 'http://localhost:4681';
  const entryPoint = cfg.idp_sso_url || cfg.entry_point || '';
  const issuer = cfg.sp_entity_id || cfg.issuer || 'gbmaintenance';
  const rawCert = cfg.idp_cert || '';
  // accept full PEM or raw base64
  const idpCert = rawCert.includes('-----BEGIN') ? _stripPem(rawCert) : rawCert.replace(/\s/g, '');
  return new nodeSaml.SAML({
    callbackUrl: `${appUrl}/api/auth/saml/callback`,
    entryPoint,
    issuer,
    idpCert,
    privateKey: cfg.sp_private_key || undefined,
    decryptionPvk: cfg.sp_private_key || undefined,
    logoutUrl: cfg.idp_slo_url || undefined,
    wantAuthnResponseSigned: false,
    wantAssertionsSigned: false,
    disableRequestedAuthnContext: true,
    acceptedClockSkewMs: 5000,
    identifierFormat: null,
    signatureAlgorithm: 'sha256',
  });
}

async function getMetadata() {
  const cfg = await getSamlSettings();
  if (!cfg || !cfg.enabled) throw new Error('SAML not enabled');
  const saml = _getSamlInstance(cfg);
  const appUrl = process.env.APP_URL || 'http://localhost:4681';
  return saml.generateServiceProviderMetadata(
    cfg.sp_cert || null,
    cfg.sp_cert || null
  );
}

async function generateAuthUrl(req) {
  const cfg = await getSamlSettings();
  if (!cfg || !cfg.enabled) throw new Error('SAML not enabled');
  const saml = _getSamlInstance(cfg);
  if (typeof saml.getAuthorizeUrlAsync === 'function') {
    return saml.getAuthorizeUrlAsync('', req.hostname, {});
  }
  return new Promise((resolve, reject) => {
    saml.getAuthorizeUrl(req, {}, (err, url) => {
      if (err) reject(err); else resolve(url);
    });
  });
}

async function validateCallback(req) {
  const cfg = await getSamlSettings();
  if (!cfg || !cfg.enabled) throw new Error('SAML not enabled');
  const saml = _getSamlInstance(cfg);

  const profile = typeof saml.validatePostResponseAsync === 'function'
    ? (await saml.validatePostResponseAsync(req.body)).profile
    : await new Promise((resolve, reject) => {
      saml.validatePostResponse(req.body, (err, result) => {
        if (err) reject(err); else resolve(result);
      });
    });

  const usernameAttr = cfg.username_attribute || cfg.username_attr;
  const username = (usernameAttr && profile[usernameAttr]) || profile.nameID;
  const emailAttr = cfg.email_attribute || cfg.email_attr;
  const email    = (emailAttr && profile[emailAttr]) || profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'] || null;
  const displayAttr = cfg.display_name_attribute || cfg.display_name_attr;
  const display  = (displayAttr && profile[displayAttr]) || profile['http://schemas.microsoft.com/identity/claims/displayname'] || username;
  const rawGroups = profile.memberOf || profile['http://schemas.microsoft.com/ws/2008/06/identity/claims/groups'] || [];
  const profileGroups = Array.isArray(rawGroups) ? rawGroups : (rawGroups ? [rawGroups] : []);
  const mapped = await ldapService.resolveSamlRole(
    username,
    email,
    profile.userPrincipalName || profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn'] || null,
    profileGroups
  );
  if (cfg.require_group_match && !mapped.role) throw new Error('SAML user is not in an authorized LDAP group');
  const role     = mapped.role || cfg.default_role || 'viewer';
  const perms    = JSON.stringify(ROLE_DEFAULTS[role] || {});
  const ldapGroups = JSON.stringify(mapped.groups || []);
  const avatarPhotoDataUrl = await ldapService.findUserAvatarFromLdap({
    username,
    email,
    upn: profile.userPrincipalName || profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn'] || null,
  }).catch((err) => {
    logger.warn(`SAML LDAP avatar sync failed: ${err.message}`);
    return null;
  });

  const existing = await getOne('SELECT id FROM users WHERE username=$1', [username]);
  if (existing) {
    await query(
      `UPDATE users
       SET display_name=$1,
             email=$2,
             auth_type='saml',
             role=$3,
             permissions=$4,
             ldap_groups=$5,
             avatar_photo_data_url=COALESCE($6, avatar_photo_data_url),
             last_login_at=NOW(),
           updated_at=NOW(),
           is_active=true
           WHERE id=$7`,
          [display, email, role, perms, ldapGroups, avatarPhotoDataUrl, existing.id]
    );
    return getOne('SELECT * FROM users WHERE id=$1', [existing.id]);
  } else {
    const colors = ['#6366f1','#8b5cf6','#ec4899','#f59e0b','#10b981','#3b82f6'];
    const color = colors[Math.floor(Math.random() * colors.length)];
    const result = await query(
      `INSERT INTO users (username, display_name, email, role, auth_type, permissions, avatar_color, avatar_photo_data_url, last_login_at)
      VALUES ($1, $2, $3, $4, 'saml', $5, $6, $7, $8, NOW()) RETURNING id`,
          [username, display, email, role, perms, ldapGroups, color, avatarPhotoDataUrl]
    );
    return getOne('SELECT * FROM users WHERE id=$1', [result.rows[0].id]);
  }
}

module.exports = { getSamlSettings, saveSamlSettings, getMetadata, generateAuthUrl, validateCallback };
