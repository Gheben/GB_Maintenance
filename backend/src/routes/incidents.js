const { Router } = require('express');
const { body, validationResult } = require('express-validator');
const { requireAuth, requireOperator, requireAdmin } = require('../middleware/authMiddleware');
const { query, getOne, getMany } = require('../db/database');
const auditService = require('../services/auditService');
const { notifyIncident } = require('../services/notificationService');
const wsService = require('../services/wsService');

const router = Router();
router.use(requireAuth);

const SEVERITIES = ['critical','high','medium','low'];
const STATUSES = ['investigating','identified','monitoring','resolved'];

// ─── GET /api/incidents ───────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const { status, severity, page = 1, limit = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const params = []; let i = 1;
  const filters = [];

  if (status)   { filters.push(`i.status=$${i++}`); params.push(status); }
  if (severity) { filters.push(`i.severity=$${i++}`); params.push(severity); }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const countRes = await query(`SELECT COUNT(*) FROM incidents i ${where}`, params);
  const total = parseInt(countRes.rows[0].count);

  const rows = await getMany(
    `SELECT i.*, u.display_name as created_by_name,
       (SELECT COUNT(*)::int FROM incident_assets ia WHERE ia.incident_id=i.id) as asset_count
     FROM incidents i LEFT JOIN users u ON u.id=i.created_by
     ${where} ORDER BY i.started_at DESC LIMIT $${i++} OFFSET $${i}`,
    [...params, parseInt(limit), offset]
  );
  res.json({ data: rows, total, page: parseInt(page), limit: parseInt(limit) });
});

// ─── GET /api/incidents/active ────────────────────────────────────────────────
router.get('/active', async (req, res) => {
  const rows = await getMany(
    `SELECT i.*, u.display_name as created_by_name FROM incidents i
     LEFT JOIN users u ON u.id=i.created_by
     WHERE i.status != 'resolved' ORDER BY i.started_at DESC LIMIT 20`
  );
  res.json(rows);
});

// ─── GET /api/incidents/:id ───────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  const incident = await getOne(
    `SELECT i.*, u.display_name as created_by_name FROM incidents i
     LEFT JOIN users u ON u.id=i.created_by WHERE i.id=$1`,
    [req.params.id]
  );
  if (!incident) return res.status(404).json({ error: 'Incidente non trovato' });

  const assets = await getMany(
    `SELECT a.id, a.name, a.category, a.status, a.criticality
     FROM assets a JOIN incident_assets ia ON ia.asset_id=a.id WHERE ia.incident_id=$1`,
    [req.params.id]
  );
  const updates = await getMany(
    `SELECT iu.*, u.display_name as author FROM incident_updates iu
     LEFT JOIN users u ON u.id=iu.created_by WHERE iu.incident_id=$1 ORDER BY iu.created_at ASC`,
    [req.params.id]
  );
  res.json({ ...incident, assets, updates });
});

// ─── POST /api/incidents ──────────────────────────────────────────────────────
router.post('/', requireOperator, [
  body('title').isString().trim().isLength({ min: 1, max: 300 }),
  body('severity').isIn(SEVERITIES),
  body('description').optional().isString(),
  body('asset_ids').optional().isArray(),
  body('started_at').optional().isISO8601(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const result = await query(
    `INSERT INTO incidents (title, description, severity, status, started_at, created_by)
     VALUES ($1,$2,$3,'investigating',$4,$5) RETURNING id`,
    [req.body.title, req.body.description||null, req.body.severity,
     req.body.started_at || new Date(), req.user.id]
  );
  const id = result.rows[0].id;

  if (Array.isArray(req.body.asset_ids)) {
    for (const aid of req.body.asset_ids) {
      await query(`INSERT INTO incident_assets (incident_id, asset_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, aid]);
      // Set asset status to major_outage or partial based on severity
      const newStatus = ['critical','high'].includes(req.body.severity) ? 'major_outage' : 'partial_outage';
      await query(`UPDATE assets SET status=$1, updated_at=NOW() WHERE id=$2`, [newStatus, aid]);
      await query(`INSERT INTO status_history (entity_type, entity_id, status, changed_by, reason) VALUES ('asset',$1,$2,$3,$4)`,
        [aid, newStatus, req.user.username, `Incident: ${req.body.title}`]);
    }
  }

  // First update
  await query(
    `INSERT INTO incident_updates (incident_id, status, message, created_by) VALUES ($1,'investigating',$2,$3)`,
    [id, req.body.description || 'Incidente aperto.', req.user.id]
  );

  await notifyIncident(id, 'incident_created');
  wsService.broadcast({ type: 'incident_created', id, severity: req.body.severity });
  await auditService.log(req.user.id, req.user.username, 'incident:create', 'incident', id, req.body.title, req.ip, req.get('user-agent'));
  res.status(201).json({ id });
});

// ─── PUT /api/incidents/:id ───────────────────────────────────────────────────
router.put('/:id', requireOperator, async (req, res) => {
  const incident = await getOne('SELECT id FROM incidents WHERE id=$1', [req.params.id]);
  if (!incident) return res.status(404).json({ error: 'Non trovato' });

  const allowed = ['title','description','severity'];
  const sets=[]; const vals=[]; let i=1;
  for (const f of allowed) {
    if (req.body[f] !== undefined) { sets.push(`${f}=$${i++}`); vals.push(req.body[f]); }
  }

  if (Array.isArray(req.body.asset_ids)) {
    await query('DELETE FROM incident_assets WHERE incident_id=$1', [req.params.id]);
    for (const aid of req.body.asset_ids) {
      await query(`INSERT INTO incident_assets (incident_id, asset_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [req.params.id, aid]);
    }
  }

  if (sets.length > 0) {
    sets.push(`updated_at=$${i++}`); vals.push(new Date()); vals.push(req.params.id);
    await query(`UPDATE incidents SET ${sets.join(',')} WHERE id=$${i}`, vals);
  }
  res.json({ message: 'Incidente aggiornato' });
});

// ─── POST /api/incidents/:id/updates ─────────────────────────────────────────
router.post('/:id/updates', requireOperator, [
  body('status').isIn(STATUSES),
  body('message').isString().trim().isLength({ min: 1 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  await query(
    `INSERT INTO incident_updates (incident_id, status, message, created_by) VALUES ($1,$2,$3,$4)`,
    [req.params.id, req.body.status, req.body.message, req.user.id]
  );

  const wasResolved = req.body.status === 'resolved';
  await query(
    `UPDATE incidents SET status=$1${wasResolved ? ', resolved_at=NOW()' : ''}, updated_at=NOW() WHERE id=$2`,
    [req.body.status, req.params.id]
  );

  if (wasResolved) {
    // Restore asset statuses
    const assets = await getMany('SELECT asset_id FROM incident_assets WHERE incident_id=$1', [req.params.id]);
    for (const a of assets) {
      await query(`UPDATE assets SET status='operational', updated_at=NOW() WHERE id=$1`, [a.asset_id]);
      await query(`INSERT INTO status_history (entity_type, entity_id, status, changed_by, reason) VALUES ('asset',$1,'operational',$2,$3)`,
        [a.asset_id, req.user.username, `Incident resolved: ${req.params.id}`]);
    }
    await notifyIncident(req.params.id, 'incident_resolved');
  }

  wsService.broadcast({ type: 'incident_updated', id: req.params.id, status: req.body.status });
  res.status(201).json({ message: 'Aggiornamento aggiunto' });
});

// ─── DELETE /api/incidents/:id ────────────────────────────────────────────────
router.delete('/:id', requireAdmin, async (req, res) => {
  await query('DELETE FROM incidents WHERE id=$1', [req.params.id]);
  res.json({ message: 'Incidente eliminato' });
});

module.exports = router;
