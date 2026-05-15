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

function _escapeLdap(value) {
  const s = String(value || '');
  if (ldap && typeof ldap.escape === 'function') return ldap.escape(s);
  // RFC4515 escaping fallback
  return s
    .replace(/\\/g, '\\5c')
    .replace(/\*/g, '\\2a')
    .replace(/\(/g, '\\28')
    .replace(/\)/g, '\\29')
    .replace(/\u0000/g, '\\00');
}

function _normalizeUsernameInput(raw) {
  const input = String(raw || '').trim();
  if (!input) return '';
  if (input.includes('\\')) return input.split('\\').pop();
  if (input.includes('@')) return input.split('@')[0];
  return input;
}

function _bindPrincipal(cfg) {
  if (cfg.bind_dn) return cfg.bind_dn;
  const user = String(cfg.bind_username || '').trim();
  if (!user) return '';
  if (user.includes('\\') || user.includes('@')) return user;
  if (cfg.domain) return `${user}@${cfg.domain}`;
  return user;
}

function _resolveLdapDomain(cfg) {
  const explicit = String(cfg?.domain || '').trim();
  if (explicit) return explicit;

  const bindUser = String(cfg?.bind_username || '').trim();
  if (bindUser.includes('@')) return bindUser.split('@').pop();

  const baseDn = String(cfg?.search_base || cfg?.base_dn || '');
  if (!baseDn) return '';
  const dcParts = baseDn
    .split(',')
    .map(part => part.trim())
    .filter(part => /^DC=/i.test(part))
    .map(part => part.split('=')[1])
    .filter(Boolean);
  return dcParts.length ? dcParts.join('.') : '';
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
      res.on('searchEntry', e => {
        const obj =
          e?.object ||
          e?.pojo?.object ||
          (() => {
            const pojo = e?.pojo;
            if (!pojo || typeof pojo !== 'object') return null;
            const out = {};
            if (pojo.objectName) out.dn = pojo.objectName;
            const attrs = Array.isArray(pojo.attributes) ? pojo.attributes : [];
            for (const a of attrs) {
              const key = a?.type;
              if (!key) continue;
              const values = Array.isArray(a?.values) ? a.values : [];
              out[key] = values.length > 1 ? values : (values[0] ?? '');
            }
            return Object.keys(out).length ? out : null;
          })();
        if (obj && typeof obj === 'object') entries.push(obj);
      });
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

  const inputUsername = String(username || '').trim();
  const searchUsername = _normalizeUsernameInput(inputUsername);
  const resolvedDomain = _resolveLdapDomain(cfg);

  const client = _createClient(cfg);
  let serviceClient;

  try {
    // 1. Bind with service account to find user DN
    serviceClient = _createClient(cfg);
    await _bind(serviceClient, _bindPrincipal(cfg), _bindPassword(cfg));

    const searchBase = cfg.search_base || cfg.base_dn;
    if (!searchBase) throw new Error('LDAP search base non configurata');
    const escapedUser = _escapeLdap(searchUsername);
    const escapedUpn = _escapeLdap(resolvedDomain ? `${searchUsername}@${resolvedDomain}` : inputUsername);
    const filter = (cfg.user_filter || '(sAMAccountName={{username}})')
      .replaceAll('{{username}}', escapedUser)
      .replaceAll('{{upn}}', escapedUpn);

    const entries = await _search(serviceClient, searchBase, {
      filter,
      scope: 'sub',
      attributes: ['dn', 'cn', 'displayName', 'mail', 'memberOf', 'telephoneNumber', 'sAMAccountName', 'userPrincipalName']
    });

    if (!entries || entries.length === 0) return null;
    const entry = entries.find(Boolean);
    if (!entry) return null;

    // 2. Bind with user credentials — try UPN first (most reliable for AD),
    //    then sAMAccountName@domain, then full DN as last resort
    const bindCandidates = [];
    if (entry.userPrincipalName) bindCandidates.push(entry.userPrincipalName);
    if (inputUsername.includes('@')) bindCandidates.push(inputUsername);
    if (resolvedDomain) bindCandidates.push(`${searchUsername}@${resolvedDomain}`);
    bindCandidates.push(entry.dn);

    let bindOk = false;
    let lastErr;
    for (const principal of bindCandidates) {
      const tryClient = _createClient(cfg);
      try {
        await _bind(tryClient, principal, password);
        bindOk = true;
        tryClient.destroy();
        break;
      } catch (err) {
        lastErr = err;
        tryClient.destroy();
      }
    }
    if (!bindOk) throw lastErr || new Error('LDAP bind failed for all candidate principals');

    // 3. Upsert user in local DB
    const email = entry.mail || null;
    const displayName = entry.displayName || entry.cn || username;
    const memberOf = Array.isArray(entry.memberOf) ? entry.memberOf : (entry.memberOf ? [entry.memberOf] : []);

    // Access control: if LDAP mappings exist, user must belong to at least one mapped LDAP group.
    // Also checks nested/transitive group membership via LDAP_MATCHING_RULE_IN_CHAIN.
    logger.info(`[LDAP] memberOf for ${searchUsername}: ${JSON.stringify(memberOf)}`);
    const allowed = await _isUserAllowedByMappings(memberOf, serviceClient, cfg, entry.dn);
    if (!allowed) {
      logger.warn(`[LDAP] Access denied for ${searchUsername} - not in any mapped LDAP group`);
      throw new Error('LDAP access denied: user does not belong to an authorized LDAP group');
    }

    // Determine role from group mappings (direct + nested)
    const role = await _resolveRoleFromGroups(memberOf, serviceClient, cfg, entry.dn) || 'viewer';
    const permissions = JSON.stringify(ROLE_DEFAULTS[role] || {});

      const existing = await getOne("SELECT id FROM users WHERE username=$1 AND auth_type='ldap'", [searchUsername]);
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
        [searchUsername, displayName, email, role, permissions, color]
      );
      return await getOne('SELECT * FROM users WHERE id=$1', [result.rows[0].id]);
    }
  } finally {
    client.destroy();
    if (serviceClient) serviceClient.destroy();
  }
}

function _extractCn(dn) {
  const match = String(dn || '').match(/^CN=([^,]+)/i);
  return match ? match[1].toLowerCase().trim() : '';
}

async function _isUserAllowedByMappings(memberOf, serviceClient, cfg, userDn) {
  const { getMany } = require('../db/database');
  const mappings = await getMany(
    `SELECT DISTINCT ldap_group_dn
     FROM ldap_group_mappings
     WHERE ldap_group_dn IS NOT NULL AND TRIM(ldap_group_dn) <> ''`
  );
  // Backward compatibility: if no mappings are defined, allow LDAP users.
  if (!mappings || mappings.length === 0) return true;

  const userGroupDns = new Set((memberOf || []).map(g => String(g || '').toLowerCase().trim()));
  const userGroupCns = new Set((memberOf || []).map(g => _extractCn(g)).filter(Boolean));

  for (const m of mappings) {
    const mapped = String(m.ldap_group_dn || '').toLowerCase().trim();
    if (!mapped) continue;
    // Full DN match
    if (userGroupDns.has(mapped)) return true;
    // Fallback: CN match (handles cases where DN format differs slightly)
    const mappedCn = _extractCn(mapped);
    if (mappedCn && userGroupCns.has(mappedCn)) return true;
  }

  // Nested/transitive group check via AD LDAP_MATCHING_RULE_IN_CHAIN
  if (serviceClient && userDn && cfg) {
    const searchBase = cfg.search_base || cfg.base_dn;
    if (searchBase) {
      try {
        const escapedDn = _escapeLdap(userDn);
        const nestedEntries = await _search(serviceClient, searchBase, {
          filter: `(member:1.2.840.113556.1.4.1941:=${escapedDn})`,
          scope: 'sub',
          attributes: ['dn', 'distinguishedName']
        });
        const nestedDns = new Set(nestedEntries.map(e => String(e.dn || e.distinguishedName || '').toLowerCase().trim()).filter(Boolean));
        const nestedCns = new Set(nestedEntries.map(e => _extractCn(e.dn || e.distinguishedName || '')).filter(Boolean));
        logger.info(`[LDAP] Nested groups for user: ${JSON.stringify([...nestedDns])}`);
        for (const m of mappings) {
          const mapped = String(m.ldap_group_dn || '').toLowerCase().trim();
          if (!mapped) continue;
          if (nestedDns.has(mapped)) return true;
          const mappedCn = _extractCn(mapped);
          if (mappedCn && nestedCns.has(mappedCn)) return true;
        }
      } catch (err) {
        logger.warn(`[LDAP] Nested group check failed: ${err.message}`);
      }
    }
  }

  return false;
}

async function _resolveRoleFromGroups(memberOf, serviceClient, cfg, userDn) {
  const { getMany } = require('../db/database');
  const mappings = await getMany('SELECT ldap_group_dn, role FROM ldap_group_mappings WHERE role IS NOT NULL');
  if (!mappings || mappings.length === 0) return null;

  const rolePriority = ['superadmin','admin','change_manager','operator','viewer','subscriber'];
  const pickBest = (current, candidate) => {
    const ci = rolePriority.indexOf(candidate);
    const curI = current ? rolePriority.indexOf(current) : 999;
    return ci !== -1 && ci < curI ? candidate : current;
  };

  // Direct memberOf check
  const directDns = new Set((memberOf || []).map(g => String(g || '').toLowerCase().trim()));
  const directCns = new Set((memberOf || []).map(g => _extractCn(g)).filter(Boolean));
  let highestRole = null;
  for (const m of mappings) {
    const dn = String(m.ldap_group_dn || '').toLowerCase().trim();
    if (directDns.has(dn)) { highestRole = pickBest(highestRole, m.role); continue; }
    const cn = _extractCn(dn);
    if (cn && directCns.has(cn)) highestRole = pickBest(highestRole, m.role);
  }

  // Nested group check (reuse already-fetched nested groups if possible)
  if (serviceClient && userDn && cfg) {
    const searchBase = cfg.search_base || cfg.base_dn;
    if (searchBase) {
      try {
        const escapedDn = _escapeLdap(userDn);
        const nestedEntries = await _search(serviceClient, searchBase, {
          filter: `(member:1.2.840.113556.1.4.1941:=${escapedDn})`,
          scope: 'sub',
          attributes: ['dn', 'distinguishedName']
        });
        const nestedDns = new Set(nestedEntries.map(e => String(e.dn || e.distinguishedName || '').toLowerCase().trim()).filter(Boolean));
        const nestedCns = new Set(nestedEntries.map(e => _extractCn(e.dn || e.distinguishedName || '')).filter(Boolean));
        for (const m of mappings) {
          const dn = String(m.ldap_group_dn || '').toLowerCase().trim();
          if (nestedDns.has(dn)) { highestRole = pickBest(highestRole, m.role); continue; }
          const cn = _extractCn(dn);
          if (cn && nestedCns.has(cn)) highestRole = pickBest(highestRole, m.role);
        }
      } catch (err) {
        logger.warn(`[LDAP] Nested role resolution failed: ${err.message}`);
      }
    }
  }

  return highestRole;
}

module.exports = { getLdapSettings, saveLdapSettings, authenticateUser, testLdapConnection, searchGroups };

async function searchUsers(q) {
  const cfg = await getLdapSettings();
  if (!cfg || !cfg.enabled) return [];
  if (!ldap) return [];

  const client = _createClient(cfg);
  try {
    await _bind(client, _bindPrincipal(cfg), _bindPassword(cfg));
    const searchBase = cfg.search_base || cfg.base_dn;
    if (!searchBase) return [];
    const escaped = _escapeLdap(q || '');
    const filter = q
      ? `(&(objectClass=user)(|(sAMAccountName=*${escaped}*)(cn=*${escaped}*)(displayName=*${escaped}*)(mail=*${escaped}*)))`
      : `(objectClass=user)`;
    const entries = await _search(client, searchBase, {
      filter,
      scope: 'sub',
      attributes: ['dn', 'cn', 'displayName', 'mail', 'sAMAccountName', 'userPrincipalName'],
      sizeLimit: 50,
    });
    return entries.map(e => ({
      dn: e.dn,
      username: e.sAMAccountName || '',
      upn: e.userPrincipalName || '',
      name: e.displayName || e.cn || e.sAMAccountName || e.dn,
      email: e.mail || '',
    }));
  } catch (err) {
    logger.warn('LDAP user search failed:', err.message);
    return [];
  } finally {
    client.destroy();
  }
}

async function searchGroups(q) {
  const cfg = await getLdapSettings();
  if (!cfg || !cfg.enabled) return [];
  if (!ldap) return [];

  const client = _createClient(cfg);
  try {
    await _bind(client, _bindPrincipal(cfg), _bindPassword(cfg));
    const searchBases = [
      cfg.group_search_base,
      cfg.groups_search_base,
      cfg.search_base,
      cfg.base_dn,
    ].map(v => String(v || '').trim()).filter(Boolean);
    const uniqueBases = [...new Set(searchBases)];
    if (uniqueBases.length === 0) return [];
    const cleaned = String(q || '').trim();
    const escaped = cleaned ? _escapeLdap(cleaned) : '';
    const attrs = ['dn', 'cn', 'name', 'sAMAccountName', 'description'];
    const mapEntries = (entries) => (entries || [])
      .filter(e => !!e && typeof e === 'object')
      .map(e => {
        const dn = e.dn || e.distinguishedName || e.objectName || '';
        const name = e.cn || e.name || e.sAMAccountName || dn;
        return {
          dn,
          name,
          samAccountName: e.sAMAccountName || '',
          description: e.description || '',
        };
      })
      .filter(g => !!g.dn || !!g.name);

    const filters = cleaned
      ? [
          `(&(objectCategory=group)(|(cn=*${escaped}*)(name=*${escaped}*)(sAMAccountName=*${escaped}*)(description=*${escaped}*)(anr=*${escaped}*)))`,
          `(&(objectClass=group)(|(cn=*${escaped}*)(name=*${escaped}*)(sAMAccountName=*${escaped}*)(description=*${escaped}*)(anr=*${escaped}*)))`,
          `(&(|(objectClass=group)(objectClass=groupOfNames)(objectClass=posixGroup))(|(cn=*${escaped}*)(name=*${escaped}*)(sAMAccountName=*${escaped}*)(description=*${escaped}*)(anr=*${escaped}*)))`,
          `(&(|(objectClass=group)(objectClass=groupOfNames)(objectClass=posixGroup))(cn=*${escaped}*))`,
          `(&(|(objectClass=group)(objectClass=groupOfNames)(objectClass=posixGroup))(name=*${escaped}*))`,
          `(&(|(objectClass=group)(objectClass=groupOfNames)(objectClass=posixGroup))(sAMAccountName=*${escaped}*))`,
          `(|(objectClass=group)(objectClass=groupOfNames)(objectClass=posixGroup))`
        ]
      : ['(|(objectClass=group)(objectClass=groupOfNames)(objectClass=posixGroup))'];

    let lastError = null;
    for (const base of uniqueBases) {
      for (let i = 0; i < filters.length; i++) {
        try {
          const entries = await _search(client, base, {
            filter: filters[i],
            scope: 'sub',
            attributes: attrs,
            sizeLimit: cleaned && i === filters.length - 1 ? 500 : 100,
          });

          let mapped = mapEntries(entries);
          if (cleaned && i === filters.length - 1) {
            const needle = cleaned.toLowerCase();
            mapped = mapped.filter(g =>
              String(g.name || '').toLowerCase().includes(needle) ||
              String(g.samAccountName || '').toLowerCase().includes(needle) ||
              String(g.dn || '').toLowerCase().includes(needle) ||
              String(g.description || '').toLowerCase().includes(needle)
            );
          }

          if (mapped.length > 0) return mapped.slice(0, 50);
          if (!cleaned && i === filters.length - 1) return mapped.slice(0, 50);
        } catch (err) {
          lastError = err;
        }
      }
    }

    if (lastError) logger.warn('LDAP group search fallback failed:', lastError.message);
    return [];
  } catch (err) {
    logger.warn('LDAP group search failed:', err.message);
    return [];
  } finally {
    client.destroy();
  }
}

async function countUsersInGroups(groupDns = []) {
  const dns = [...new Set((Array.isArray(groupDns) ? groupDns : [])
    .map(v => String(v || '').trim())
    .filter(Boolean))];
  if (dns.length === 0) return 0;

  const cfg = await getLdapSettings();
  if (!cfg || !cfg.enabled || !ldap) return 0;

  const searchBase = cfg.search_base || cfg.base_dn;
  if (!searchBase) return 0;

  const client = _createClient(cfg);
  try {
    await _bind(client, _bindPrincipal(cfg), _bindPassword(cfg));
    const uniqueUsers = new Set();

    for (const dn of dns) {
      const escapedDn = _escapeLdap(dn);
      const filters = [
        `(&(objectClass=user)(memberOf:1.2.840.113556.1.4.1941:=${escapedDn}))`,
        `(&(objectClass=user)(memberOf=${escapedDn}))`,
      ];

      let entries = [];
      for (const filter of filters) {
        try {
          entries = await _search(client, searchBase, {
            filter,
            scope: 'sub',
            attributes: ['dn', 'distinguishedName', 'mail', 'sAMAccountName'],
            sizeLimit: 5000,
          });
          if (entries.length > 0) break;
        } catch (_) {
          // Ignore and fallback to the next filter.
        }
      }

      for (const entry of entries) {
        const key = String(entry.dn || entry.distinguishedName || '').toLowerCase().trim()
          || String(entry.mail || '').toLowerCase().trim()
          || String(entry.sAMAccountName || '').toLowerCase().trim();
        if (key) uniqueUsers.add(key);
      }
    }

    return uniqueUsers.size;
  } catch (err) {
    logger.warn('LDAP group user count failed:', err.message);
    return 0;
  } finally {
    client.destroy();
  }
}

module.exports.searchUsers = searchUsers;
module.exports.countUsersInGroups = countUsersInGroups;
