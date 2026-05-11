let ldap;
try { ldap = require('ldapjs'); } catch { ldap = null; }

const { query, getOne } = require('../db/database');
const logger = require('../utils/logger');
const { encrypt, decrypt, isEncrypted } = require('../utils/encryption');
const { ROLE_DEFAULTS } = require('./authService');

const SETTINGS_KEY = 'ldap_config';

// ─── Settings ─────────────────────────────────────────────────────────────────
async function getLdapSettings() {
  try {
    const row = await getOne("SELECT value FROM settings WHERE key=$1", [SETTINGS_KEY]);
    if (!row) return null;
    return JSON.parse(row.value);
  } catch { return null; }
}

async function saveLdapSettings(cfg) {
  const existing = await getLdapSettings();
  if (!cfg.bind_password && existing?.bind_password) cfg.bind_password = existing.bind_password;
  if (cfg.bind_password && !isEncrypted(cfg.bind_password)) {
    cfg.bind_password = encrypt(cfg.bind_password);
  }
  await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`,
    [SETTINGS_KEY, JSON.stringify(cfg)]
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function normalizePhone(raw) {
  return String(raw || '').replace(/[\s\-().]/g, '');
}

function _bindPrincipal(cfg) {
  if (cfg.bind_username && cfg.domain) return `${cfg.bind_username}@${cfg.domain}`;
  return cfg.bind_dn || '';
}

function _bindPassword(cfg) {
  const raw = cfg.bind_password || '';
  if (!raw) return '';
  const dec = decrypt(raw);
  if (dec === '' && raw && isEncrypted(raw)) {
    throw new Error('LDAP: impossibile decifrare la password del service account. Reinserire in Impostazioni → LDAP.');
  }
  return dec || raw;
}

// ─── Client factory ───────────────────────────────────────────────────────────
function _createClient(cfg) {
  if (!ldap) throw new Error('ldapjs non è installato');
  return ldap.createClient({
    url: cfg.url,
    connectTimeout: 8000,
    timeout: 8000,
    tlsOptions: { rejectUnauthorized: false }
  });
}

function _bind(client, dn, password) {
  return new Promise((resolve, reject) => {
    client.bind(dn, password, (err) => {
      if (err) reject(err); else resolve();
    });
  });
}

function _search(client, base, opts) {
  return new Promise((resolve, reject) => {
    client.search(base, opts, (err, res) => {
      if (err) return reject(err);
      const entries = [];
      res.on('searchEntry', e => entries.push(e.object));
      res.on('error', reject);
      res.on('end', () => resolve(entries));
    });
  });
}

// ─── Test connection ──────────────────────────────────────────────────────────
async function testLdapConnection(cfg) {
  const client = _createClient(cfg);
  try {
    await _bind(client, _bindPrincipal(cfg), _bindPassword(cfg));
    return { success: true };
  } finally {
    client.destroy();
  }
}

// ─── Authenticate user ────────────────────────────────────────────────────────
async function authenticateUser(username, password) {
  const cfg = await getLdapSettings();
  if (!cfg || !cfg.enabled) throw new Error('LDAP non abilitato');

  const client = _createClient(cfg);
  let serviceClient;

  try {
    // 1. Bind with service account to find user DN
    serviceClient = _createClient(cfg);
    await _bind(serviceClient, _bindPrincipal(cfg), _bindPassword(cfg));

    const searchBase = cfg.search_base || cfg.base_dn;
    const filter = (cfg.user_filter || '(sAMAccountName={{username}})').replace('{{username}}', ldap.escape(username));

    const entries = await _search(serviceClient, searchBase, {
      filter,
      scope: 'sub',
      attributes: ['dn', 'cn', 'displayName', 'mail', 'memberOf', 'telephoneNumber', 'sAMAccountName', 'userPrincipalName']
    });

    if (!entries || entries.length === 0) return null;
    const entry = entries[0];
    const userDn = entry.dn;

    // 2. Bind with user credentials
    await _bind(client, userDn, password);

    // 3. Upsert user in local DB
    const email = entry.mail || null;
    const displayName = entry.displayName || entry.cn || username;
    const memberOf = Array.isArray(entry.memberOf) ? entry.memberOf : (entry.memberOf ? [entry.memberOf] : []);

    // Determine role from group mappings
    const role = await _resolveRoleFromGroups(memberOf) || 'viewer';
    const permissions = JSON.stringify(ROLE_DEFAULTS[role] || {});

    const existing = await getOne("SELECT id FROM users WHERE username=$1 AND auth_type='ldap'", [username]);
    if (existing) {
      await query(
        `UPDATE users SET display_name=$1, email=$2, role=$3, permissions=$4, last_login_at=NOW(), updated_at=NOW(), is_active=true
         WHERE id=$5`,
        [displayName, email, role, permissions, existing.id]
      );
      return await getOne('SELECT * FROM users WHERE id=$1', [existing.id]);
    } else {
      const colors = ['#6366f1','#8b5cf6','#ec4899','#f59e0b','#10b981','#3b82f6'];
      const color = colors[Math.floor(Math.random() * colors.length)];
      const result = await query(
        `INSERT INTO users (username, display_name, email, role, auth_type, permissions, avatar_color, last_login_at)
         VALUES ($1, $2, $3, $4, 'ldap', $5, $6, NOW()) RETURNING id`,
        [username, displayName, email, role, permissions, color]
      );
      return await getOne('SELECT * FROM users WHERE id=$1', [result.rows[0].id]);
    }
  } finally {
    client.destroy();
    if (serviceClient) serviceClient.destroy();
  }
}

async function _resolveRoleFromGroups(memberOf) {
  if (!memberOf || memberOf.length === 0) return null;
  const { getMany } = require('../db/database');
  const mappings = await getMany('SELECT ldap_group_dn, role FROM ldap_group_mappings WHERE role IS NOT NULL');
  const rolePriority = ['superadmin','admin','change_manager','operator','viewer','subscriber'];

  let highestRole = null;
  for (const mapping of mappings) {
    const dn = mapping.ldap_group_dn.toLowerCase();
    if (memberOf.some(g => g.toLowerCase() === dn)) {
      const idx = rolePriority.indexOf(mapping.role);
      const curIdx = highestRole ? rolePriority.indexOf(highestRole) : 999;
      if (idx !== -1 && idx < curIdx) highestRole = mapping.role;
    }
  }
  return highestRole;
}

module.exports = { getLdapSettings, saveLdapSettings, authenticateUser, testLdapConnection, searchGroups };

async function searchGroups(q) {
  const cfg = await getLdapSettings();
  if (!cfg || !cfg.enabled) return [];
  if (!ldap) return [];

  const client = _createClient(cfg);
  try {
    await _bind(client, _bindPrincipal(cfg), _bindPassword(cfg));
    const searchBase = cfg.search_base || cfg.base_dn;
    const escaped = q ? ldap.escape(q) : '';
    const filter = q
      ? `(&(objectClass=group)(cn=*${escaped}*))`
      : `(objectClass=group)`;
    const entries = await _search(client, searchBase, {
      filter,
      scope: 'sub',
      attributes: ['dn', 'cn', 'description'],
      sizeLimit: 50,
    });
    return entries.map(e => ({
      dn: e.dn,
      name: e.cn || e.dn,
      description: e.description || '',
    }));
  } catch (err) {
    logger.warn('LDAP group search failed:', err.message);
    return [];
  } finally {
    client.destroy();
  }
}
