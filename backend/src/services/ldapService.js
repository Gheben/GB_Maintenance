let ldap;
try { ldap = require('ldapjs'); } catch { ldap = null; }

const { query, getOne } = require('../db/database');
const logger = require('../utils/logger');
const { encrypt, decrypt, isEncrypted } = require('../utils/encryption');
const { ROLE_DEFAULTS } = require('./authService');

const SETTINGS_KEY = 'ldap_config';
const LDAP_MEMO_MAX_ENTRIES = 300;
const LDAP_MEMO = new Map();
const LDAP_INFLIGHT = new Map();

function _cacheTokenFromCfg(cfg = {}) {
  return [
    String(cfg.url || '').trim().toLowerCase(),
    String(cfg.search_base || '').trim().toLowerCase(),
    String(cfg.base_dn || '').trim().toLowerCase(),
    String(cfg.group_search_base || '').trim().toLowerCase(),
    String(cfg.groups_search_base || '').trim().toLowerCase(),
  ].join('|');
}

function _memoGet(key) {
  const hit = LDAP_MEMO.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.expiresAt) {
    LDAP_MEMO.delete(key);
    return undefined;
  }
  return hit.value;
}

function _memoSet(key, value, ttlMs) {
  LDAP_MEMO.set(key, { value, expiresAt: Date.now() + Math.max(1, ttlMs) });
  if (LDAP_MEMO.size <= LDAP_MEMO_MAX_ENTRIES) return;
  const firstKey = LDAP_MEMO.keys().next().value;
  if (firstKey) LDAP_MEMO.delete(firstKey);
}

async function _memoizeLdapCall(key, ttlMs, producer, shouldCache = () => true) {
  const cached = _memoGet(key);
  if (cached !== undefined) return cached;

  if (LDAP_INFLIGHT.has(key)) return LDAP_INFLIGHT.get(key);

  const pending = (async () => {
    try {
      const value = await producer();
      if (shouldCache(value)) {
        _memoSet(key, value, ttlMs);
      }
      return value;
    } finally {
      LDAP_INFLIGHT.delete(key);
    }
  })();

  LDAP_INFLIGHT.set(key, pending);
  return pending;
}

function _normalizeGroupDns(groupDns = []) {
  const byLowerKey = new Map();
  for (const raw of (Array.isArray(groupDns) ? groupDns : [])) {
    const trimmed = String(raw || '').trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (!byLowerKey.has(lower)) byLowerKey.set(lower, trimmed);
  }
  return [...byLowerKey.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, original]) => original);
}

function _normalizedDnsKey(groupDns = []) {
  return _normalizeGroupDns(groupDns).map((dn) => dn.toLowerCase());
}

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

function normalizeOffice(raw) {
  if (Array.isArray(raw)) return String(raw[0] || '').trim() || null;
  const value = String(raw || '').trim();
  return value || null;
}

function detectImageMime(buffer) {
  if (!buffer || buffer.length < 4) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) return 'image/png';
  // GIF: GIF87a / GIF89a
  if (
    buffer.length >= 6 &&
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38 &&
    (buffer[4] === 0x37 || buffer[4] === 0x39) &&
    buffer[5] === 0x61
  ) return 'image/gif';
  // WebP: RIFF....WEBP
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) return 'image/webp';

  return null;
}

function toBufferMaybe(value) {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value;
  if (Array.isArray(value) && value.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    return Buffer.from(value);
  }
  if (value?.type === 'Buffer' && Array.isArray(value?.data)) {
    return Buffer.from(value.data);
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }
  return null;
}

function normalizeThumbnailPhotoDataUrl(raw) {
  if (!raw) return null;

  const first = Array.isArray(raw) ? raw[0] : raw;
  if (!first) return null;

  if (typeof first === 'string' && first.startsWith('data:image/')) {
    return first;
  }

  let buffer = toBufferMaybe(first);
  if (typeof first === 'string') {
    const value = first.trim();
    if (!value) return null;

    // Try base64 first, but accept it only if bytes look like a real image.
    const base64Decoded = Buffer.from(value, 'base64');
    if (base64Decoded.length > 0 && detectImageMime(base64Decoded)) {
      buffer = base64Decoded;
    }

    if (!buffer || buffer.length === 0 || !detectImageMime(buffer)) {
      const binaryDecoded = Buffer.from(value, 'latin1');
      if (binaryDecoded.length > 0 && detectImageMime(binaryDecoded)) {
        buffer = binaryDecoded;
      }
    }
  }

  if (!buffer || buffer.length === 0) return null;
  // Keep payload bounded to avoid oversized JWT/session responses.
  if (buffer.length > 200 * 1024) return null;

  const mime = detectImageMime(buffer);
  if (!mime) return null;

  return `data:${mime};base64,${buffer.toString('base64')}`;
}

function extractRawAttributeFromSearchEntry(entry, attrName) {
  const attr = String(attrName || '').trim().toLowerCase();
  if (!attr) return null;

  const candidates = [entry?.raw?.attributes, entry?.pojo?.attributes];
  for (const attrs of candidates) {
    if (!Array.isArray(attrs)) continue;
    for (const a of attrs) {
      const type = String(a?.type || a?.name || '').trim().toLowerCase();
      if (type !== attr) continue;

      const values = [
        ...(Array.isArray(a?.buffers) ? a.buffers : []),
        ...(Array.isArray(a?.vals) ? a.vals : []),
        ...(Array.isArray(a?.values) ? a.values : []),
      ];

      for (const v of values) {
        const buf = toBufferMaybe(v);
        if (buf && buf.length > 0) return buf;
      }
    }
  }

  return null;
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

async function _upsertCachedLdapUsers(users = []) {
  if (!Array.isArray(users) || users.length === 0) return;

  for (const user of users) {
    const dn = String(user?.dn || '').trim() || null;
    const username = String(user?.username || '').trim().toLowerCase() || null;
    const upn = String(user?.upn || '').trim() || null;
    const displayName = String(user?.name || user?.display_name || '').trim() || null;
    const email = String(user?.email || '').trim() || null;
    const office = normalizeOffice(user?.office);

    if (!dn && !username) continue;

    const payload = {
      dn,
      username,
      upn,
      display_name: displayName,
      email,
      office,
      source: 'ldap',
    };

    if (dn) {
      await query(
        `INSERT INTO ldap_users_cache (dn, username, upn, display_name, email, office, source_payload, synced_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW(), NOW())
         ON CONFLICT (dn) DO UPDATE
         SET username=EXCLUDED.username,
             upn=EXCLUDED.upn,
             display_name=EXCLUDED.display_name,
             email=EXCLUDED.email,
             office=EXCLUDED.office,
             source_payload=EXCLUDED.source_payload,
             synced_at=NOW(),
             updated_at=NOW()`,
        [dn, username, upn, displayName, email, office, JSON.stringify(payload)]
      );
    } else {
      await query(
        `INSERT INTO ldap_users_cache (dn, username, upn, display_name, email, office, source_payload, synced_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW(), NOW())
         ON CONFLICT (username) DO UPDATE
         SET dn=EXCLUDED.dn,
             upn=EXCLUDED.upn,
             display_name=EXCLUDED.display_name,
             email=EXCLUDED.email,
             office=EXCLUDED.office,
             source_payload=EXCLUDED.source_payload,
             synced_at=NOW(),
             updated_at=NOW()`,
        [dn, username, upn, displayName, email, office, JSON.stringify(payload)]
      );
    }
  }
}

async function _searchCachedUsers(q) {
  const cleaned = String(q || '').trim().toLowerCase();
  if (!cleaned) {
    const rows = await query(
      `SELECT dn, username, upn, display_name, email, office
       FROM ldap_users_cache
       ORDER BY synced_at DESC, display_name NULLS LAST
       LIMIT 50`
    );
    return rows.rows.map(r => ({
      dn: r.dn,
      username: r.username || '',
      upn: r.upn || '',
      name: r.display_name || r.username || r.email || r.dn,
      email: r.email || '',
      office: r.office || null,
    }));
  }

  const like = `%${cleaned}%`;
  const rows = await query(
    `SELECT dn, username, upn, display_name, email, office
     FROM ldap_users_cache
     WHERE LOWER(COALESCE(username, '')) LIKE $1
        OR LOWER(COALESCE(upn, '')) LIKE $1
        OR LOWER(COALESCE(display_name, '')) LIKE $1
        OR LOWER(COALESCE(email, '')) LIKE $1
        OR LOWER(COALESCE(office, '')) LIKE $1
        OR LOWER(COALESCE(dn, '')) LIKE $1
     ORDER BY synced_at DESC, display_name NULLS LAST
     LIMIT 50`,
    [like]
  );

  return rows.rows.map(r => ({
    dn: r.dn,
    username: r.username || '',
    upn: r.upn || '',
    name: r.display_name || r.username || r.email || r.dn,
    email: r.email || '',
    office: r.office || null,
  }));
}

// ─── Client factory ───────────────────────────────────────────────────────────
function _createClient(cfg) {
  if (!ldap) throw new Error('ldapjs non è installato');
  const client = ldap.createClient({
    url: cfg.url,
    connectTimeout: 8000,
    timeout: 8000,
    tlsOptions: { rejectUnauthorized: false }
  });

  // ldapjs can emit asynchronous "error" events on the client; without a
  // listener Node treats them as unhandled and crashes the process.
  client.on('error', (err) => {
    logger.warn(`LDAP client error: ${err?.message || err}`);
  });

  return client;
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
        if (obj && typeof obj === 'object') {
          const rawThumb = extractRawAttributeFromSearchEntry(e, 'thumbnailPhoto');
          if (rawThumb) obj.thumbnailPhoto = rawThumb;
        }
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
      attributes: ['dn', 'cn', 'displayName', 'mail', 'memberOf', 'telephoneNumber', 'sAMAccountName', 'userPrincipalName', 'office', 'physicalDeliveryOfficeName', 'thumbnailPhoto']
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
    const office = normalizeOffice(entry.office || entry.physicalDeliveryOfficeName);
    const avatarPhotoDataUrl = normalizeThumbnailPhotoDataUrl(entry.thumbnailPhoto);
    const memberOf = Array.isArray(entry.memberOf) ? entry.memberOf : (entry.memberOf ? [entry.memberOf] : []);

    await _upsertCachedLdapUsers([{
      dn: entry.dn,
      username: searchUsername,
      upn: entry.userPrincipalName || null,
      name: displayName,
      email,
      office,
    }]).catch((err) => {
      logger.warn('LDAP cache upsert failed during authentication:', err.message);
    });

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
        `UPDATE users SET display_name=$1, email=$2, office=$3, role=$4, permissions=$5, avatar_photo_data_url=$6, last_login_at=NOW(), updated_at=NOW(), is_active=true
         WHERE id=$7`,
        [displayName, email, office, role, permissions, avatarPhotoDataUrl, existing.id]
      );
      return await getOne('SELECT * FROM users WHERE id=$1', [existing.id]);
    } else {
      const colors = ['#6366f1','#8b5cf6','#ec4899','#f59e0b','#10b981','#3b82f6'];
      const color = colors[Math.floor(Math.random() * colors.length)];
      const result = await query(
        `INSERT INTO users (username, display_name, email, office, role, auth_type, permissions, avatar_color, avatar_photo_data_url, last_login_at)
         VALUES ($1, $2, $3, $4, $5, 'ldap', $6, $7, $8, NOW()) RETURNING id`,
        [searchUsername, displayName, email, office, role, permissions, color, avatarPhotoDataUrl]
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

  const queryText = String(q || '').trim().toLowerCase();
  const memoKey = `ldap:searchUsers:${_cacheTokenFromCfg(cfg)}:${queryText}`;
  return _memoizeLdapCall(memoKey, 45 * 1000, async () => {

  let cachedUsers = [];
  try {
    cachedUsers = await _searchCachedUsers(queryText || '');
  } catch (err) {
    logger.warn('LDAP cached user search failed:', err.message);
  }

  if (!ldap) return cachedUsers;

  const client = _createClient(cfg);
  try {
    await _bind(client, _bindPrincipal(cfg), _bindPassword(cfg));
    const searchBase = cfg.search_base || cfg.base_dn;
    if (!searchBase) return [];
    const escaped = _escapeLdap(queryText || '');
    const filter = queryText
      ? `(&(objectClass=user)(|(sAMAccountName=*${escaped}*)(cn=*${escaped}*)(displayName=*${escaped}*)(mail=*${escaped}*)))`
      : `(objectClass=user)`;
    const entries = await _search(client, searchBase, {
      filter,
      scope: 'sub',
      attributes: ['dn', 'cn', 'displayName', 'mail', 'sAMAccountName', 'userPrincipalName', 'office', 'physicalDeliveryOfficeName'],
      sizeLimit: 50,
    });

    const liveUsers = entries.map(e => ({
      dn: e.dn,
      username: e.sAMAccountName || '',
      upn: e.userPrincipalName || '',
      name: e.displayName || e.cn || e.sAMAccountName || e.dn,
      email: e.mail || '',
      office: normalizeOffice(e.office || e.physicalDeliveryOfficeName),
    }));

    await _upsertCachedLdapUsers(liveUsers).catch((err) => {
      logger.warn('LDAP cache upsert failed during search:', err.message);
    });

    const merged = new Map();
    for (const u of [...cachedUsers, ...liveUsers]) {
      const key = String(u?.dn || '').trim().toLowerCase()
        || String(u?.username || '').trim().toLowerCase()
        || String(u?.upn || '').trim().toLowerCase();
      if (!key) continue;
      merged.set(key, u);
    }

    return [...merged.values()].slice(0, 50);
  } catch (err) {
    logger.warn('LDAP user search failed:', err.message);
    return cachedUsers;
  } finally {
    client.destroy();
  }
  });
}

async function searchGroups(q) {
  const cfg = await getLdapSettings();
  if (!cfg || !cfg.enabled) return [];
  const cleaned = String(q || '').trim().toLowerCase();
  const memoKey = `ldap:searchGroups:${_cacheTokenFromCfg(cfg)}:${cleaned}`;
  return _memoizeLdapCall(memoKey, 60 * 1000, async () => {
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
  });
}

async function countUsersInGroups(groupDns = []) {
  const dns = _normalizeGroupDns(groupDns);
  if (dns.length === 0) return 0;

  const cfg = await getLdapSettings();
  if (!cfg || !cfg.enabled || !ldap) return 0;

  const memoKeyDns = _normalizedDnsKey(dns);
  const memoKey = `ldap:countUsersInGroups:${_cacheTokenFromCfg(cfg)}:${memoKeyDns.join(',')}`;
  return _memoizeLdapCall(memoKey, 60 * 1000, async () => {

  const searchBases = [
    cfg.search_base,
    cfg.base_dn,
    cfg.group_search_base,
    cfg.groups_search_base,
  ].map(v => String(v || '').trim()).filter(Boolean);
  const uniqueBases = [...new Set(searchBases)];
  if (uniqueBases.length === 0) return 0;

  const client = _createClient(cfg);
  try {
    await _bind(client, _bindPrincipal(cfg), _bindPassword(cfg));
    const uniqueUsers = new Set();
    const visitedGroups = new Set();
    const inspectedMembers = new Set();

    const readEntryByDn = async (dn, attrs) => {
      try {
        const rows = await _search(client, dn, {
          filter: '(objectClass=*)',
          scope: 'base',
          attributes: attrs,
          sizeLimit: 1,
        });
        return rows[0] || null;
      } catch (_) {
        return null;
      }
    };

    const isGroupObjectClass = (value) => {
      const values = Array.isArray(value) ? value : [value];
      const classes = values.map(v => String(v || '').toLowerCase().trim());
      return classes.some(c => c === 'group' || c === 'groupofnames' || c === 'groupofuniquenames' || c === 'posixgroup');
    };

    const addUserKey = (entry, fallbackValue = '') => {
      const key = String(entry?.dn || entry?.distinguishedName || '').toLowerCase().trim()
        || String(entry?.mail || '').toLowerCase().trim()
        || String(entry?.sAMAccountName || '').toLowerCase().trim()
        || String(entry?.uid || '').toLowerCase().trim()
        || String(fallbackValue || '').toLowerCase().trim();
      if (key) uniqueUsers.add(key);
    };

    const queue = [...dns];
    while (queue.length > 0) {
      const dn = String(queue.shift() || '').trim();
      const dnKey = dn.toLowerCase();
      if (!dn || visitedGroups.has(dnKey)) continue;
      visitedGroups.add(dnKey);

      const escapedDn = _escapeLdap(dn);
      const filters = [
        `(&(objectClass=user)(memberOf:1.2.840.113556.1.4.1941:=${escapedDn}))`,
        `(&(|(objectClass=user)(objectClass=person))(memberOf=${escapedDn}))`,
      ];

      for (const base of uniqueBases) {
        for (const filter of filters) {
          try {
            const entries = await _search(client, base, {
              filter,
              scope: 'sub',
              attributes: ['dn', 'distinguishedName', 'mail', 'sAMAccountName', 'uid'],
              sizeLimit: 5000,
            });
            for (const entry of entries) addUserKey(entry);
          } catch (_) {
            // Ignore unsupported filters/bases and continue with fallback strategies.
          }
        }
      }

      // Fallback for directories that do not support memberOf matching rules.
      const groupEntry = await readEntryByDn(dn, ['member', 'uniqueMember', 'memberUid']);
      const members = [
        ...(Array.isArray(groupEntry?.member) ? groupEntry.member : (groupEntry?.member ? [groupEntry.member] : [])),
        ...(Array.isArray(groupEntry?.uniqueMember) ? groupEntry.uniqueMember : (groupEntry?.uniqueMember ? [groupEntry.uniqueMember] : [])),
      ];

      for (const memberDnRaw of members) {
        const memberDn = String(memberDnRaw || '').trim();
        if (!memberDn) continue;
        const memberKey = memberDn.toLowerCase();
        if (inspectedMembers.has(memberKey)) continue;
        inspectedMembers.add(memberKey);

        const memberEntry = await readEntryByDn(memberDn, ['objectClass', 'dn', 'distinguishedName', 'mail', 'sAMAccountName', 'uid']);
        if (memberEntry && isGroupObjectClass(memberEntry.objectClass)) {
          queue.push(memberDn);
        } else {
          addUserKey(memberEntry, memberDn);
        }
      }

      const memberUids = Array.isArray(groupEntry?.memberUid)
        ? groupEntry.memberUid
        : (groupEntry?.memberUid ? [groupEntry.memberUid] : []);
      for (const uid of memberUids) {
        const normalized = String(uid || '').toLowerCase().trim();
        if (normalized) uniqueUsers.add(`uid:${normalized}`);
      }
    }

    return uniqueUsers.size;
  } catch (err) {
    logger.warn('LDAP group user count failed:', err.message);
    return 0;
  } finally {
    client.destroy();
  }
  }, (value) => Number.isFinite(value) && value > 0);
}

async function listUsersInGroups(groupDns = [], options = {}) {
  const dns = _normalizeGroupDns(groupDns);
  if (dns.length === 0) return [];

  const cfg = await getLdapSettings();
  if (!cfg || !cfg.enabled || !ldap) return [];

  const maxResults = Math.max(1, Math.min(parseInt(options.maxResults || 2000, 10), 5000));
  const memoKeyDns = _normalizedDnsKey(dns);
  const memoKey = `ldap:listUsersInGroups:${_cacheTokenFromCfg(cfg)}:${maxResults}:${memoKeyDns.join(',')}`;
  return _memoizeLdapCall(memoKey, 60 * 1000, async () => {

  const searchBases = [
    cfg.search_base,
    cfg.base_dn,
    cfg.group_search_base,
    cfg.groups_search_base,
  ].map(v => String(v || '').trim()).filter(Boolean);
  const uniqueBases = [...new Set(searchBases)];
  if (uniqueBases.length === 0) return [];

  const users = new Map();

  const addUser = (entry = {}, fallbackDn = '') => {
    const dn = String(entry?.dn || entry?.distinguishedName || fallbackDn || '').trim();
    const username = String(entry?.sAMAccountName || entry?.uid || '').trim();
    const upn = String(entry?.userPrincipalName || '').trim();
    const email = String(entry?.mail || '').trim();
    const displayName = String(entry?.displayName || entry?.cn || username || email || dn).trim();
    const office = normalizeOffice(entry?.office || entry?.physicalDeliveryOfficeName);

    const key = dn.toLowerCase() || upn.toLowerCase() || username.toLowerCase() || email.toLowerCase();
    if (!key || users.has(key)) return;

    users.set(key, {
      id: dn || upn || username || email,
      username: username || upn || '',
      display_name: displayName || null,
      email: email || null,
      office: office || null,
      role: 'viewer',
      auth_type: 'ldap',
    });
  };

  const readEntryByDn = async (client, dn, attrs) => {
    try {
      const rows = await _search(client, dn, {
        filter: '(objectClass=*)',
        scope: 'base',
        attributes: attrs,
        sizeLimit: 1,
      });
      return rows[0] || null;
    } catch (_) {
      return null;
    }
  };

  const isGroupObjectClass = (value) => {
    const values = Array.isArray(value) ? value : [value];
    const classes = values.map(v => String(v || '').toLowerCase().trim());
    return classes.some(c => c === 'group' || c === 'groupofnames' || c === 'groupofuniquenames' || c === 'posixgroup');
  };

  const client = _createClient(cfg);
  try {
    await _bind(client, _bindPrincipal(cfg), _bindPassword(cfg));

    const visitedGroups = new Set();
    const inspectedMembers = new Set();
    const queue = [...dns];

    while (queue.length > 0 && users.size < maxResults) {
      const groupDn = String(queue.shift() || '').trim();
      const groupKey = groupDn.toLowerCase();
      if (!groupDn || visitedGroups.has(groupKey)) continue;
      visitedGroups.add(groupKey);

      const escapedDn = _escapeLdap(groupDn);
      const filters = [
        `(&(objectClass=user)(memberOf:1.2.840.113556.1.4.1941:=${escapedDn}))`,
        `(&(|(objectClass=user)(objectClass=person))(memberOf=${escapedDn}))`,
      ];

      for (const base of uniqueBases) {
        for (const filter of filters) {
          if (users.size >= maxResults) break;
          try {
            const entries = await _search(client, base, {
              filter,
              scope: 'sub',
              attributes: ['dn', 'distinguishedName', 'cn', 'displayName', 'mail', 'sAMAccountName', 'userPrincipalName', 'uid', 'office', 'physicalDeliveryOfficeName'],
              sizeLimit: Math.min(5000, maxResults),
            });
            for (const entry of entries) {
              addUser(entry);
              if (users.size >= maxResults) break;
            }
          } catch (_) {
            // Ignore unsupported filter and continue with fallback strategy.
          }
        }
      }

      if (users.size >= maxResults) break;

      // Fallback recursive expansion for directories that do not support matching rules.
      const groupEntry = await readEntryByDn(client, groupDn, ['member', 'uniqueMember', 'memberUid']);
      const members = [
        ...(Array.isArray(groupEntry?.member) ? groupEntry.member : (groupEntry?.member ? [groupEntry.member] : [])),
        ...(Array.isArray(groupEntry?.uniqueMember) ? groupEntry.uniqueMember : (groupEntry?.uniqueMember ? [groupEntry.uniqueMember] : [])),
      ];

      for (const memberDnRaw of members) {
        if (users.size >= maxResults) break;
        const memberDn = String(memberDnRaw || '').trim();
        if (!memberDn) continue;
        const memberKey = memberDn.toLowerCase();
        if (inspectedMembers.has(memberKey)) continue;
        inspectedMembers.add(memberKey);

        const memberEntry = await readEntryByDn(client, memberDn, ['objectClass', 'dn', 'distinguishedName', 'cn', 'displayName', 'mail', 'sAMAccountName', 'userPrincipalName', 'uid', 'office', 'physicalDeliveryOfficeName']);
        if (memberEntry && isGroupObjectClass(memberEntry.objectClass)) {
          queue.push(memberDn);
        } else {
          addUser(memberEntry || {}, memberDn);
        }
      }

      const memberUids = Array.isArray(groupEntry?.memberUid)
        ? groupEntry.memberUid
        : (groupEntry?.memberUid ? [groupEntry.memberUid] : []);
      for (const uid of memberUids) {
        if (users.size >= maxResults) break;
        const normalized = String(uid || '').trim();
        if (!normalized) continue;
        const key = `uid:${normalized.toLowerCase()}`;
        if (users.has(key)) continue;
        users.set(key, {
          id: `uid:${normalized}`,
          username: normalized,
          display_name: normalized,
          email: null,
          office: null,
          role: 'viewer',
          auth_type: 'ldap',
        });
      }
    }

    return [...users.values()];
  } catch (err) {
    logger.warn('LDAP list users in groups failed:', err.message);
    return [];
  } finally {
    client.destroy();
  }
  }, (value) => Array.isArray(value) && value.length > 0);
}

module.exports.searchUsers = searchUsers;
module.exports.countUsersInGroups = countUsersInGroups;
module.exports.listUsersInGroups = listUsersInGroups;
