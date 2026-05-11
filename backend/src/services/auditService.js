const { query } = require('../db/database');
const logger = require('../utils/logger');

async function log(userId, username, action, entityType, entityId, details, ipAddress, userAgent) {
  try {
    await query(
      `INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [userId || null, username || 'system', action, entityType || null, String(entityId || ''), details || null, ipAddress || null, userAgent || null]
    );
  } catch (err) {
    logger.error(`[Audit] Failed to log: ${err.message}`);
  }
}

function middleware(action, entityType, getEntityId, getDetails) {
  return async (req, res, next) => {
    const orig = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode < 400) {
        const entityId = typeof getEntityId === 'function' ? getEntityId(req, body) : (req.params.id || '');
        const details = typeof getDetails === 'function' ? getDetails(req, body) : '';
        log(req.user?.id, req.user?.username, action, entityType, entityId, details, req.ip, req.get('user-agent'));
      }
      return orig(body);
    };
    next();
  };
}

module.exports = { log, middleware };
