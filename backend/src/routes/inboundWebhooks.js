const { Router } = require('express');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');
const { query, getMany, getOne } = require('../db/database');
const auditService = require('../services/auditService');
const { notifyIncident } = require('../services/notificationService');
const wsService = require('../services/wsService');

const router = Router();

// Ensures a thrown/rejected error inside an async handler reaches Express's error middleware
// (res.json/status) instead of becoming an unhandled rejection that crashes the whole process.
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const SEVERITIES = ['critical', 'high', 'medium', 'low'];
const STATUSES = ['investigating', 'identified', 'monitoring', 'resolved'];

// Guards against token brute-forcing / spam without requiring the caller to authenticate first.
const receiveLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

// Shared by the create and update receivers: looks up the webhook by token prefix, then confirms
// the full secret with a hash comparison (mirrors the API key auth pattern used elsewhere).
async function resolveInboundWebhook(token) {
  const prefix = token.slice(0, 14);
  const candidates = await getMany(
    `SELECT * FROM inbound_webhooks WHERE token_prefix=$1 AND is_active=true`,
    [prefix]
  );
  for (const row of candidates) {
    if (await bcrypt.compare(token, row.token_hash)) return row;
  }
  return null;
}

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
  body('asset_ids').optional().isArray(),
  body('asset_slugs').optional().isArray(),
  body('service_ids').optional().isArray(),
  body('service_slugs').optional().isArray(),
  body('ticket_ref').optional().isString().trim().isLength({ max: 100 }),
], asyncRoute(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const matched = await resolveInboundWebhook(req.params.token);
  if (!matched) return res.status(401).json({ error: 'Invalid or disabled token' });

  const severity = SEVERITIES.includes(req.body.severity) ? req.body.severity : matched.default_severity;
  const title = req.body.source ? `[${req.body.source}] ${req.body.title}` : req.body.title;

  // Resolve slugs (e.g. a monitoring tool's hostname) alongside raw UUIDs, matching the format
  // the regular POST /api/incidents endpoint accepts, so the same affected-scope logic applies.
  const slugRows = Array.isArray(req.body.asset_slugs) && req.body.asset_slugs.length > 0
    ? await getMany(`SELECT id FROM assets WHERE slug = ANY($1::varchar[])`, [req.body.asset_slugs])
    : [];
  const assetIds = [...new Set([
    ...(Array.isArray(req.body.asset_ids) ? req.body.asset_ids : []),
    ...slugRows.map((row) => row.id),
  ])];

  const serviceSlugRows = Array.isArray(req.body.service_slugs) && req.body.service_slugs.length > 0
    ? await getMany(`SELECT id FROM services WHERE slug = ANY($1::varchar[])`, [req.body.service_slugs])
    : [];
  const serviceIds = [...new Set([
    ...(Array.isArray(req.body.service_ids) ? req.body.service_ids : []),
    ...serviceSlugRows.map((row) => row.id),
  ])];

  const result = await query(
    `INSERT INTO incidents (title, description, ticket_ref, severity, status, started_at, created_by)
     VALUES ($1,$2,$3,$4,'investigating',NOW(),NULL) RETURNING id`,
    [title, req.body.description || null, req.body.ticket_ref || null, severity]
  );
  const id = result.rows[0].id;
  await query(
    `INSERT INTO incident_updates (incident_id, status, message) VALUES ($1,'investigating',$2)`,
    [id, req.body.description || 'Incident opened via inbound webhook.']
  );
  for (const assetId of assetIds) {
    await query(`INSERT INTO incident_assets (incident_id, asset_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, assetId]);
    const newStatus = ['critical', 'high'].includes(severity) ? 'major_outage' : 'partial_outage';
    await query(`UPDATE assets SET status=$1, updated_at=NOW() WHERE id=$2`, [newStatus, assetId]);
    await query(`INSERT INTO status_history (entity_type, entity_id, status, changed_by, reason) VALUES ('asset',$1,$2,$3,$4)`,
      [assetId, newStatus, `webhook:${matched.name}`, `Incident: ${title}`]);
  }
  for (const serviceId of serviceIds) {
    await query(`INSERT INTO incident_services (incident_id, service_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, serviceId]);
  }
  query('UPDATE inbound_webhooks SET last_used_at=NOW() WHERE id=$1', [matched.id]).catch(() => {});

  await notifyIncident(id, 'incident_created');
  wsService.broadcast({ type: 'incident_created', id, severity });
  res.status(201).json({ id, message: 'Incident created' });
}));

// ─── POST /api/inbound-webhooks/receive/:token/:incidentId/updates ───────────
// Appends a timeline update to an incident previously created via this (or any) webhook, and
// closes it when status is 'resolved' — mirrors POST /api/incidents/:id/updates.
router.post('/receive/:token/:incidentId/updates', receiveLimiter, [
  body('status').isIn(STATUSES),
  body('message').isString().trim().isLength({ min: 1 }),
], asyncRoute(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const matched = await resolveInboundWebhook(req.params.token);
  if (!matched) return res.status(401).json({ error: 'Invalid or disabled token' });

  const incident = await getOne(`SELECT id FROM incidents WHERE id=$1`, [req.params.incidentId]);
  if (!incident) return res.status(404).json({ error: 'Incident not found' });

  await query(
    `INSERT INTO incident_updates (incident_id, status, message) VALUES ($1,$2,$3)`,
    [req.params.incidentId, req.body.status, req.body.message]
  );

  const wasResolved = req.body.status === 'resolved';
  await query(
    `UPDATE incidents SET status=$1${wasResolved ? ', resolved_at=NOW()' : ''}, updated_at=NOW() WHERE id=$2`,
    [req.body.status, req.params.incidentId]
  );

  if (wasResolved) {
    const assets = await getMany('SELECT asset_id FROM incident_assets WHERE incident_id=$1', [req.params.incidentId]);
    for (const a of assets) {
      await query(`UPDATE assets SET status='operational', updated_at=NOW() WHERE id=$1`, [a.asset_id]);
      await query(`INSERT INTO status_history (entity_type, entity_id, status, changed_by, reason) VALUES ('asset',$1,'operational',$2,$3)`,
        [a.asset_id, `webhook:${matched.name}`, `Incident resolved: ${req.params.incidentId}`]);
    }
    await notifyIncident(req.params.incidentId, 'incident_resolved');
  }

  query('UPDATE inbound_webhooks SET last_used_at=NOW() WHERE id=$1', [matched.id]).catch(() => {});
  wsService.broadcast({ type: 'incident_updated', id: req.params.incidentId, status: req.body.status });
  res.status(201).json({ message: 'Update added' });
}));

module.exports = router;
