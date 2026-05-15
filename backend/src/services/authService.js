const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { query, getOne, getMany } = require('../db/database');
const logger = require('../utils/logger');

const JWT_SECRET  = process.env.JWT_SECRET  || 'changeme-insecure-default';
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || '8h';

// ─── Permission Keys ──────────────────────────────────────────────────────────
const PERMISSION_KEYS = [
  'dashboard', 'assets', 'services', 'maintenance', 'incidents',
  'calendar', 'status_page', 'notifications', 'reports',
  'users', 'settings', 'apikeys', 'audit'
];

const ROLE_DEFAULTS = {
  superadmin: Object.fromEntries(PERMISSION_KEYS.map(k => [k, true])),
  admin:        Object.fromEntries(PERMISSION_KEYS.map(k => [k, true])),
  change_manager: {
    dashboard: true, assets: true, services: true, maintenance: true,
    incidents: true, calendar: true, status_page: true, notifications: true,
    reports: true, users: false, settings: false, apikeys: false, audit: true
  },
  operator: {
    dashboard: true, assets: true, services: true, maintenance: true,
    incidents: true, calendar: true, status_page: true, notifications: true,
    reports: true, users: false, settings: false, apikeys: false, audit: false
  },
  viewer: {
    dashboard: true, assets: true, services: true, maintenance: true,
    incidents: true, calendar: true, status_page: true, notifications: true,
    reports: false, users: false, settings: false, apikeys: false, audit: false
  },
  subscriber: {
    dashboard: true, assets: false, services: false, maintenance: false,
    incidents: false, calendar: true, status_page: true, notifications: true,
    reports: false, users: false, settings: false, apikeys: false, audit: false
  }
};

function normalizePermissions(role, permissions) {
  const baseline = ROLE_DEFAULTS[role] || {};
  const current = permissions && typeof permissions === 'object' ? permissions : {};
  const merged = {};
  for (const key of PERMISSION_KEYS) {
    if (typeof current[key] === 'boolean') merged[key] = current[key];
    else merged[key] = !!baseline[key];
  }
  return merged;
}

// ─── Password ─────────────────────────────────────────────────────────────────
function hashPassword(plain) {
  return bcrypt.hashSync(plain, 12);
}
function verifyPassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

// ─── JWT ──────────────────────────────────────────────────────────────────────
function signToken(user) {
  const jti = uuidv4();
  const payload = {
    jti,
    sub: user.id,
    username: user.username,
    displayName: user.display_name || user.username,
    role: user.role,
    permissions: normalizePermissions(user.role, user.permissions),
  };
  return { token: jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES }), jti };
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

// ─── Safe user projection ─────────────────────────────────────────────────────
function safeUser(u) {
  if (!u) return null;
  const { password_hash, totp_secret, ...safe } = u;
  safe.permissions = normalizePermissions(safe.role, safe.permissions);
  return safe;
}

// ─── SuperAdmin Seed ──────────────────────────────────────────────────────────
async function seedSuperAdmin() {
  const username = (process.env.SUPERADMIN_USERNAME || 'sysadmin').trim();
  const password = (process.env.SUPERADMIN_PASSWORD || 'Admin@12345!').trim();

  const existing = await getOne("SELECT id FROM users WHERE role = 'superadmin'");
  const allPerms = Object.fromEntries(PERMISSION_KEYS.map(k => [k, true]));
  const hash = hashPassword(password);

  if (existing) {
    await query(
      `UPDATE users SET username=$1, password_hash=$2, permissions=$3, updated_at=NOW() WHERE role='superadmin'`,
      [username, hash, JSON.stringify(allPerms)]
    );
    logger.info(`[Auth] SuperAdmin updated: username="${username}"`);
  } else {
    await query(
      `INSERT INTO users (username, display_name, password_hash, role, auth_type, permissions, avatar_color)
       VALUES ($1, $2, $3, 'superadmin', 'local', $4, '#6366f1')`,
      [username, 'System Administrator', hash, JSON.stringify(allPerms)]
    );
    logger.info(`[Auth] SuperAdmin created: username="${username}"`);
  }
}

// ─── Local Login ──────────────────────────────────────────────────────────────
async function loginLocal(username, password) {
  const user = await getOne(
    `SELECT * FROM users WHERE LOWER(username) = LOWER($1) AND auth_type = 'local' AND is_active = true`,
    [username]
  );
  if (!user) return null;

  // Check account lock
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    const unlockAt = new Date(user.locked_until).toLocaleString('it-IT');
    throw Object.assign(new Error(`Account bloccato fino al ${unlockAt}`), { code: 'ACCOUNT_LOCKED' });
  }

  const valid = verifyPassword(password, user.password_hash);
  if (!valid) {
    const fails = (user.failed_login_count || 0) + 1;
    const lockUntil = fails >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;
    await query(
      `UPDATE users SET failed_login_count=$1, locked_until=$2 WHERE id=$3`,
      [fails, lockUntil, user.id]
    );
    return null;
  }

  // Reset fail count on success
  await query(
    `UPDATE users SET failed_login_count=0, locked_until=NULL, last_login_at=NOW() WHERE id=$1`,
    [user.id]
  );

  return user;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────
async function getAllUsers() {
  const users = await getMany(
    `SELECT id, username, display_name, email, office, role, auth_type, permissions,
            totp_enabled, totp_verified, is_active, last_login_at,
            failed_login_count, locked_until, avatar_color, created_at, updated_at
     FROM users ORDER BY username`
  );
  return users.map(u => ({ ...u, permissions: normalizePermissions(u.role, u.permissions) }));
}

async function getUserById(id) {
  const user = await getOne(
    `SELECT id, username, display_name, email, office, role, auth_type, permissions,
            totp_enabled, totp_verified, is_active, last_login_at, avatar_color,
            password_changed_at, created_at, updated_at
     FROM users WHERE id=$1`,
    [id]
  );
  if (!user) return null;
  return { ...user, permissions: normalizePermissions(user.role, user.permissions) };
}

async function getUserWithHash(id) {
  return getOne('SELECT * FROM users WHERE id=$1', [id]);
}

async function createUser(username, password, role, opts = {}) {
  const hash = hashPassword(password);
  const perms = normalizePermissions(role, opts.permissions || ROLE_DEFAULTS[role] || {});
  const colors = ['#6366f1','#8b5cf6','#ec4899','#f59e0b','#10b981','#3b82f6','#ef4444'];
  const color = colors[Math.floor(Math.random() * colors.length)];

  const result = await query(
    `INSERT INTO users (username, display_name, email, office, password_hash, role, auth_type, permissions, avatar_color)
     VALUES ($1, $2, $3, $4, $5, 'local', $6, $7, $8) RETURNING id`,
    [username, opts.display_name || username, opts.email || null, opts.office || null, hash, role, JSON.stringify(perms), color]
  );
  return result.rows[0].id;
}

async function updateUser(id, fields) {
  const sets = [];
  const vals = [];
  let idx = 1;

  if (fields.username !== undefined)     { sets.push(`username=$${idx++}`); vals.push(fields.username); }
  if (fields.display_name !== undefined) { sets.push(`display_name=$${idx++}`); vals.push(fields.display_name); }
  if (fields.email !== undefined)        { sets.push(`email=$${idx++}`); vals.push(fields.email); }
  if (fields.office !== undefined)       { sets.push(`office=$${idx++}`); vals.push(fields.office === '' ? null : fields.office); }
  if (fields.role !== undefined)         { sets.push(`role=$${idx++}`); vals.push(fields.role); }
  if (fields.permissions !== undefined)  { sets.push(`permissions=$${idx++}`); vals.push(JSON.stringify(fields.permissions)); }
  if (fields.is_active !== undefined)    { sets.push(`is_active=$${idx++}`); vals.push(fields.is_active); }
  if (fields.avatar_color !== undefined) { sets.push(`avatar_color=$${idx++}`); vals.push(fields.avatar_color); }
  if (fields.password) {
    sets.push(`password_hash=$${idx++}`);
    vals.push(hashPassword(fields.password));
    sets.push(`password_changed_at=$${idx++}`);
    vals.push(new Date());
    sets.push(`failed_login_count=$${idx++}`);
    vals.push(0);
    sets.push(`locked_until=$${idx++}`);
    vals.push(null);
  }

  if (sets.length === 0) return;
  sets.push(`updated_at=$${idx++}`);
  vals.push(new Date());
  vals.push(id);

  await query(`UPDATE users SET ${sets.join(',')} WHERE id=$${idx}`, vals);
}

async function deleteUser(id) {
  await query('DELETE FROM users WHERE id=$1', [id]);
}

// ─── Session Management ───────────────────────────────────────────────────────
async function createSession(userId, jti, ip, userAgent, expiresIn = '8h') {
  const ms = parseExpiry(expiresIn);
  const expiresAt = new Date(Date.now() + ms);
  await query(
    `INSERT INTO user_sessions (user_id, token_jti, ip_address, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, jti, ip, userAgent, expiresAt]
  );
}

async function revokeSession(jti) {
  await query(`UPDATE user_sessions SET revoked=true WHERE token_jti=$1`, [jti]);
}

async function revokeAllUserSessions(userId) {
  await query(`UPDATE user_sessions SET revoked=true WHERE user_id=$1`, [userId]);
}

async function isSessionRevoked(jti) {
  const row = await getOne(`SELECT revoked FROM user_sessions WHERE token_jti=$1`, [jti]);
  return !row || row.revoked;
}

async function getUserSessions(userId) {
  return getMany(
    `SELECT id, token_jti, ip_address, user_agent, expires_at, revoked, created_at
     FROM user_sessions WHERE user_id=$1 AND expires_at > NOW() ORDER BY created_at DESC`,
    [userId]
  );
}

function parseExpiry(str) {
  const match = String(str).match(/^(\d+)([smhd])$/);
  if (!match) return 8 * 3600 * 1000;
  const n = parseInt(match[1], 10);
  const unit = match[2];
  const ms = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[unit];
  return n * ms;
}

module.exports = {
  PERMISSION_KEYS, ROLE_DEFAULTS,
  hashPassword, verifyPassword,
  signToken, verifyToken,
  safeUser,
  seedSuperAdmin,
  loginLocal,
  getAllUsers, getUserById, getUserWithHash, createUser, updateUser, deleteUser,
  createSession, revokeSession, revokeAllUserSessions, isSessionRevoked, getUserSessions,
};
