const { Router } = require('express');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');
const { query, getMany } = require('../db/database');
const auditService = require('../services/auditService');
const { notifyIncident } = require('../services/notificationService');
const wsService = require('../services/wsService');

const router = Router();

// Ensures a thrown/rejected error inside an async handler reaches Express's error middleware
// (res.json/status) instead of becoming an unhandled rejection that crashes the whole process.
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const SEVERITIES = ['critical', 'high', 'medium', 'low'];

// Guards against token brute-forcing / spam without requiring the caller to authenticate first.
const receiveLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── GET /api/inbound-webhooks ────────────────────────────────────────────────
router.get('/', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const rows = await getMany(
    `SELECT id, name, token_prefix, default_severity, is_active, last_used_at, created_at
     FROM inbound_webhooks ORDER BY created_at DESC`
  );
  res.json(rows);
}));

// ─── POST /api/inbound-webhooks ───────────────────────────────────────────────
router.post('/', requireAuth, requireAdmin, [
  body('name').isString().trim().isLength({ min: 1, max: 200 }),
  body('default_severity').optional().isIn(SEVERITIES),
], asyncRoute(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const token = `gbmih_${crypto.randomBytes(24).toString('hex')}`;
  const prefix = token.slice(0, 14);
  const hash = await bcrypt.hash(token, 10);

  const result = await query(
    `INSERT INTO inbound_webhooks (name, token_prefix, token_hash, default_severity, owner_id)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [req.body.name, prefix, hash, req.body.default_severity || 'medium', req.user.id]
  );
  const id = result.rows[0].id;
  await auditService.log(req.user.id, req.user.username, 'inbound_webhook:create', 'inbound_webhook', id, `name=${req.body.name}`, req.ip);

  // Return the plain token ONCE — never retrievable again
  res.status(201).json({ id, token, message: 'Save this URL/token now — it will not be shown again' });
}));

// ─── PATCH /api/inbound-webhooks/:id ──────────────────────────────────────────
router.patch('/:id', requireAuth, requireAdmin, [
  body('name').optional().isString().trim().isLength({ min: 1, max: 200 }),
  body('default_severity').optional().isIn(SEVERITIES),
  body('is_active').optional().isBoolean(),
], asyncRoute(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const sets = []; const vals = []; let i = 1;
  for (const field of ['name', 'default_severity', 'is_active']) {
    if (req.body[field] !== undefined) { sets.push(`${field}=$${i++}`); vals.push(req.body[field]); }
  }
  if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update' });
  vals.push(req.params.id);
  await query(`UPDATE inbound_webhooks SET ${sets.join(',')} WHERE id=$${i}`, vals);
  await auditService.log(req.user.id, req.user.username, 'inbound_webhook:update', 'inbound_webhook', req.params.id, null, req.ip);
  res.json({ message: 'Updated' });
}));

// ─── DELETE /api/inbound-webhooks/:id ─────────────────────────────────────────
router.delete('/:id', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  await query(`DELETE FROM inbound_webhooks WHERE id=$1`, [req.params.id]);
  await auditService.log(req.user.id, req.user.username, 'inbound_webhook:delete', 'inbound_webhook', req.params.id, null, req.ip);
  res.json({ message: 'Deleted' });
}));

// ─── POST /api/inbound-webhooks/receive/:token ────────────────────────────────
// Public endpoint for external monitoring tools; access is controlled solely by the secret
// token embedded in the URL (never by IP or login), so disabling/deleting it stops all traffic.
router.post('/receive/:token', receiveLimiter, [
  body('title').isString().trim().isLength({ min: 1, max: 300 }),
  body('description').optional().isString(),
  body('severity').optional().isString(),
  body('source').optional().isString().trim().isLength({ max: 100 }),
], asyncRoute(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const token = req.params.token;
  const prefix = token.slice(0, 14);
  const candidates = await getMany(
    `SELECT * FROM inbound_webhooks WHERE token_prefix=$1 AND is_active=true`,
    [prefix]
  );
  let matched = null;
  for (const row of candidates) {
    if (await bcrypt.compare(token, row.token_hash)) { matched = row; break; }
  }
  if (!matched) return res.status(401).json({ error: 'Invalid or disabled token' });

  const severity = SEVERITIES.includes(req.body.severity) ? req.body.severity : matched.default_severity;
  const title = req.body.source ? `[${req.body.source}] ${req.body.title}` : req.body.title;

  const result = await query(
    `INSERT INTO incidents (title, description, severity, status, started_at, created_by)
     VALUES ($1,$2,$3,'investigating',NOW(),NULL) RETURNING id`,
    [title, req.body.description || null, severity]
  );
  const id = result.rows[0].id;
  await query(
    `INSERT INTO incident_updates (incident_id, status, message) VALUES ($1,'investigating',$2)`,
    [id, req.body.description || 'Incident opened via inbound webhook.']
  );
  query('UPDATE inbound_webhooks SET last_used_at=NOW() WHERE id=$1', [matched.id]).catch(() => {});

  await notifyIncident(id, 'incident_created');
  wsService.broadcast({ type: 'incident_created', id, severity });
  res.status(201).json({ id, message: 'Incident created' });
}));

module.exports = router;
