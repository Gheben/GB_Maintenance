const { verifyToken, isSessionRevoked, getUserById } = require('../services/authService');
const { getOne } = require('../db/database');
const logger = require('../utils/logger');

// ─── JWT Auth ─────────────────────────────────────────────────────────────────
async function requireAuth(req, res, next) {
  try {
    const header = req.headers['authorization'] || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Token mancante' });

    let payload;
    try {
      payload = verifyToken(token);
    } catch (err) {
      return res.status(401).json({ error: 'Token non valido o scaduto' });
    }

    // Check session revocation
    if (payload.jti) {
      const revoked = await isSessionRevoked(payload.jti);
      if (revoked) return res.status(401).json({ error: 'Sessione revocata' });
    }

    // Attach fresh user data
    const user = await getUserById(payload.sub);
    if (!user || !user.is_active) return res.status(401).json({ error: 'Utente non trovato o disabilitato' });

    req.user = { ...user, jti: payload.jti };
    next();
  } catch (err) {
    logger.error(`[AuthMiddleware] ${err.message}`);
    res.status(500).json({ error: 'Errore di autenticazione' });
  }
}

// ─── Optional JWT Auth (public routes with identity-aware behavior) ─────────
async function optionalAuth(req, res, next) {
  try {
    const header = req.headers['authorization'] || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return next();

    let payload;
    try {
      payload = verifyToken(token);
    } catch {
      return next();
    }

    if (payload.jti) {
      const revoked = await isSessionRevoked(payload.jti);
      if (revoked) return next();
    }

    const user = await getUserById(payload.sub);
    if (!user || !user.is_active) return next();

    req.user = { ...user, jti: payload.jti };
    return next();
  } catch (err) {
    logger.error(`[AuthMiddleware][optionalAuth] ${err.message}`);
    return next();
  }
}

// ─── API Key Auth ─────────────────────────────────────────────────────────────
const bcrypt = require('bcryptjs');

async function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.api_key;
  if (!key) return res.status(401).json({ error: 'API key mancante' });

  const prefix = key.slice(0, 10);
  const rows = await require('../db/database').getMany(
    `SELECT ak.*, u.role, u.is_active FROM api_keys ak
     JOIN users u ON u.id = ak.owner_id
     WHERE ak.key_prefix=$1 AND ak.is_active=true
       AND (ak.expires_at IS NULL OR ak.expires_at > NOW())`,
    [prefix]
  );

  for (const row of rows) {
    if (bcrypt.compareSync(key, row.key_hash)) {
      if (!row.is_active) return res.status(403).json({ error: 'Utente disabilitato' });
      req.user = { id: row.owner_id, role: row.role, permissions: row.permissions };
      req.apiKeyId = row.id;
      // Update last_used_at async
      require('../db/database').query('UPDATE api_keys SET last_used_at=NOW() WHERE id=$1', [row.id]);
      return next();
    }
  }
  return res.status(401).json({ error: 'API key non valida' });
}

// ─── Role Guards ──────────────────────────────────────────────────────────────
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Non autenticato' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Ruolo richiesto: ${roles.join(' o ')}` });
    }
    next();
  };
}

const requireAdmin = requireRole('superadmin', 'admin');
const requireSuperAdmin = requireRole('superadmin');
const requireChangeManager = requireRole('superadmin', 'admin', 'change_manager');
const requireOperator = requireRole('superadmin', 'admin', 'change_manager', 'operator');

// ─── Permission Guard ─────────────────────────────────────────────────────────
function requirePermission(perm) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Non autenticato' });
    const perms = req.user.permissions || {};
    if (req.user.role === 'superadmin' || perms[perm] === true) return next();
    return res.status(403).json({ error: `Permesso '${perm}' richiesto` });
  };
}

// ─── Auth or API Key ──────────────────────────────────────────────────────────
async function requireAuthOrApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  if (apiKey) return requireApiKey(req, res, next);
  return requireAuth(req, res, next);
}

module.exports = {
  requireAuth, optionalAuth, requireApiKey, requireAuthOrApiKey,
  requireRole, requireAdmin, requireSuperAdmin, requireChangeManager, requireOperator,
  requirePermission
};
