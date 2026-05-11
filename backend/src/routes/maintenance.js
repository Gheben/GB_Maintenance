const { Router } = require('express');
const { body, validationResult } = require('express-validator');
const { requireAuth, requireOperator, requireAdmin, requireChangeManager } = require('../middleware/authMiddleware');
const { query, getOne, getMany } = require('../db/database');
const auditService = require('../services/auditService');
const { notifyMaintenance } = require('../services/notificationService');
const wsService = require('../services/wsService');

const router = Router();
router.use(requireAuth);

const TYPES = ['planned','emergency','upgrade','security_patch','infrastructure','other'];
const STATUSES = ['draft','pending_approval','scheduled','in_progress','completed','cancelled','extended'];
const IMPACTS = ['critical','high','medium','low'];

// ─── GET /api/maintenance ─────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const { status, type, impact_level, asset_id, from, to, page = 1, limit = 50, upcoming } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const params = []; let i = 1;
  const filters = [];

  if (status)       { filters.push(`mw.status=$${i++}`); params.push(status); }
  if (type)         { filters.push(`mw.type=$${i++}`); params.push(type); }
  if (impact_level) { filters.push(`mw.impact_level=$${i++}`); params.push(impact_level); }
  if (from)         { filters.push(`mw.scheduled_start >= $${i++}`); params.push(from); }
  if (to)           { filters.push(`mw.scheduled_end <= $${i++}`); params.push(to); }
  if (upcoming === 'true') { filters.push(`mw.scheduled_start > NOW() AND mw.status IN ('scheduled','draft','pending_approval')`); }
  if (asset_id) {
    filters.push(`mw.id IN (SELECT maintenance_id FROM maintenance_assets WHERE asset_id=$${i++})`);
    params.push(asset_id);
  }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const countRes = await query(`SELECT COUNT(*) FROM maintenance_windows mw ${where}`, params);
  const total = parseInt(countRes.rows[0].count);

  const rows = await getMany(
    `SELECT mw.*,
       u1.display_name as created_by_name,
       u2.display_name as approved_by_name,
       (SELECT COUNT(*)::int FROM maintenance_assets ma WHERE ma.maintenance_id=mw.id) as asset_count
     FROM maintenance_windows mw
     LEFT JOIN users u1 ON u1.id=mw.created_by
     LEFT JOIN users u2 ON u2.id=mw.approved_by
     ${where} ORDER BY mw.scheduled_start DESC LIMIT $${i++} OFFSET $${i}`,
    [...params, parseInt(limit), offset]
  );
  res.json({ data: rows, total, page: parseInt(page), limit: parseInt(limit) });
});

// ─── GET /api/maintenance/calendar ───────────────────────────────────────────
router.get('/calendar', async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'Parametri from e to richiesti' });
  const rows = await getMany(
    `SELECT id, title, type, status, impact_level, scheduled_start, scheduled_end
     FROM maintenance_windows
     WHERE scheduled_start < $1 AND scheduled_end > $2
       AND status NOT IN ('cancelled')
     ORDER BY scheduled_start`,
    [to, from]
  );
  res.json(rows);
});

// ─── GET /api/maintenance/:id ─────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  const maint = await getOne(
    `SELECT mw.*,
       u1.display_name as created_by_name, u1.email as created_by_email,
       u2.display_name as approved_by_name,
       mt.name as template_name
     FROM maintenance_windows mw
     LEFT JOIN users u1 ON u1.id=mw.created_by
     LEFT JOIN users u2 ON u2.id=mw.approved_by
     LEFT JOIN maintenance_templates mt ON mt.id=mw.template_id
     WHERE mw.id=$1`,
    [req.params.id]
  );
  if (!maint) return res.status(404).json({ error: 'Manutenzione non trovata' });

  const assets = await getMany(
    `SELECT a.id, a.name, a.category, a.status, a.criticality
     FROM assets a JOIN maintenance_assets ma ON ma.asset_id=a.id WHERE ma.maintenance_id=$1`,
    [req.params.id]
  );
  // Affected services (via asset links)
  const assetIds = assets.map(a => a.id);
  let affectedServices = [];
  if (assetIds.length > 0) {
    affectedServices = await getMany(
      `SELECT DISTINCT s.id, s.name, s.status, s.criticality
       FROM services s JOIN service_assets sa ON sa.service_id=s.id
       WHERE sa.asset_id=ANY($1::uuid[])`,
      [assetIds]
    );
  }
  res.json({ ...maint, assets, affectedServices });
});

// ─── POST /api/maintenance ────────────────────────────────────────────────────
router.post('/', requireOperator, [
  body('title').isString().trim().isLength({ min: 1, max: 300 }),
  body('type').isIn(TYPES),
  body('impact_level').optional().isIn(IMPACTS),
  body('scheduled_start').isISO8601(),
  body('scheduled_end').isISO8601(),
  body('description').optional().isString(),
  body('asset_ids').optional().isArray(),
  body('template_id').optional().isUUID(),
  body('recurrence_type').optional().isIn(['none','daily','weekly','monthly','custom']),
  body('recurrence_cron').optional().isString(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  if (new Date(req.body.scheduled_end) <= new Date(req.body.scheduled_start)) {
    return res.status(400).json({ error: 'La data di fine deve essere successiva a quella di inizio' });
  }

  // Check blackout periods
  const blackout = await getOne(
    `SELECT id, name FROM blackout_periods
     WHERE NOT (end_date < $1::date OR start_date > $2::date)`,
    [req.body.scheduled_start, req.body.scheduled_end]
  );
  if (blackout) {
    return res.status(400).json({ error: `Conflitto con periodo di blackout: ${blackout.name}` });
  }

  // Auto-set status: if high/critical impact or emergency → pending_approval, else → scheduled
  const needsApproval = ['critical','high'].includes(req.body.impact_level) || req.body.type === 'emergency';
  const status = needsApproval ? 'pending_approval' : 'scheduled';

  const result = await query(
    `INSERT INTO maintenance_windows
       (title, description, type, status, impact_level, scheduled_start, scheduled_end,
        recurrence_type, recurrence_cron, recurrence_end_date, template_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [
      req.body.title, req.body.description || null,
      req.body.type, status, req.body.impact_level || 'medium',
      req.body.scheduled_start, req.body.scheduled_end,
      req.body.recurrence_type || 'none',
      req.body.recurrence_cron || null,
      req.body.recurrence_end_date || null,
      req.body.template_id || null,
      req.user.id
    ]
  );
  const id = result.rows[0].id;

  // Link assets
  if (Array.isArray(req.body.asset_ids)) {
    for (const aid of req.body.asset_ids) {
      await query(`INSERT INTO maintenance_assets (maintenance_id, asset_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, aid]);
    }
  }

  await auditService.log(req.user.id, req.user.username, 'maintenance:create', 'maintenance', id, req.body.title, req.ip, req.get('user-agent'));

  // Notify if scheduled
  if (status === 'scheduled') {
    await notifyMaintenance(id, 'maintenance_scheduled');
  }

  wsService.broadcast({ type: 'maintenance_created', id, status });
  res.status(201).json({ id, status });
});

// ─── PUT /api/maintenance/:id ─────────────────────────────────────────────────
router.put('/:id', requireOperator, async (req, res) => {
  const maint = await getOne('SELECT * FROM maintenance_windows WHERE id=$1', [req.params.id]);
  if (!maint) return res.status(404).json({ error: 'Manutenzione non trovata' });
  if (['completed','cancelled'].includes(maint.status)) {
    return res.status(400).json({ error: 'Non puoi modificare una manutenzione completata o annullata' });
  }

  const allowed = ['title','description','type','impact_level','scheduled_start','scheduled_end',
    'recurrence_type','recurrence_cron','recurrence_end_date','template_id','notes'];
  const sets=[]; const vals=[]; let i=1;
  for (const f of allowed) {
    if (req.body[f] !== undefined) { sets.push(`${f}=$${i++}`); vals.push(req.body[f]); }
  }

  // Update linked assets
  if (Array.isArray(req.body.asset_ids)) {
    await query('DELETE FROM maintenance_assets WHERE maintenance_id=$1', [req.params.id]);
    for (const aid of req.body.asset_ids) {
      await query(`INSERT INTO maintenance_assets (maintenance_id, asset_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [req.params.id, aid]);
    }
  }

  if (sets.length > 0) {
    sets.push(`updated_at=$${i++}`); vals.push(new Date()); vals.push(req.params.id);
    await query(`UPDATE maintenance_windows SET ${sets.join(',')} WHERE id=$${i}`, vals);
  }
  await auditService.log(req.user.id, req.user.username, 'maintenance:update', 'maintenance', req.params.id, null, req.ip, req.get('user-agent'));
  res.json({ message: 'Manutenzione aggiornata' });
});

// ─── POST /api/maintenance/:id/approve ───────────────────────────────────────
router.post('/:id/approve', requireChangeManager, async (req, res) => {
  const maint = await getOne('SELECT status FROM maintenance_windows WHERE id=$1', [req.params.id]);
  if (!maint) return res.status(404).json({ error: 'Non trovata' });
  if (maint.status !== 'pending_approval') return res.status(400).json({ error: 'Stato non valido per l\'approvazione' });

  await query(
    `UPDATE maintenance_windows SET status='scheduled', approved_by=$1, approved_at=NOW(), updated_at=NOW() WHERE id=$2`,
    [req.user.id, req.params.id]
  );
  await auditService.log(req.user.id, req.user.username, 'maintenance:approve', 'maintenance', req.params.id, null, req.ip);
  await notifyMaintenance(req.params.id, 'maintenance_scheduled');
  wsService.broadcast({ type: 'maintenance_approved', id: req.params.id });
  res.json({ message: 'Manutenzione approvata' });
});

// ─── POST /api/maintenance/:id/reject ────────────────────────────────────────
router.post('/:id/reject', requireChangeManager, [
  body('reason').isString().trim().isLength({ min: 1 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  await query(
    `UPDATE maintenance_windows SET status='cancelled', rejection_reason=$1, updated_at=NOW() WHERE id=$2`,
    [req.body.reason, req.params.id]
  );
  await auditService.log(req.user.id, req.user.username, 'maintenance:reject', 'maintenance', req.params.id, req.body.reason, req.ip);
  wsService.broadcast({ type: 'maintenance_rejected', id: req.params.id });
  res.json({ message: 'Manutenzione rifiutata' });
});

// ─── POST /api/maintenance/:id/start ─────────────────────────────────────────
router.post('/:id/start', requireOperator, async (req, res) => {
  const maint = await getOne('SELECT status FROM maintenance_windows WHERE id=$1', [req.params.id]);
  if (!maint) return res.status(404).json({ error: 'Non trovata' });
  if (!['scheduled'].includes(maint.status)) return res.status(400).json({ error: 'Stato non valido' });

  await query(`UPDATE maintenance_windows SET status='in_progress', actual_start=NOW(), updated_at=NOW() WHERE id=$1`, [req.params.id]);
  await notifyMaintenance(req.params.id, 'maintenance_started');
  wsService.broadcast({ type: 'maintenance_started', id: req.params.id });
  await auditService.log(req.user.id, req.user.username, 'maintenance:start', 'maintenance', req.params.id, null, req.ip);
  res.json({ message: 'Manutenzione avviata' });
});

// ─── POST /api/maintenance/:id/complete ───────────────────────────────────────
router.post('/:id/complete', requireOperator, [
  body('notes').optional().isString(),
], async (req, res) => {
  const maint = await getOne('SELECT status FROM maintenance_windows WHERE id=$1', [req.params.id]);
  if (!maint || !['in_progress','extended'].includes(maint.status)) {
    return res.status(400).json({ error: 'Stato non valido' });
  }
  await query(
    `UPDATE maintenance_windows SET status='completed', actual_end=NOW(), notes=$1, updated_at=NOW() WHERE id=$2`,
    [req.body.notes || null, req.params.id]
  );
  await notifyMaintenance(req.params.id, 'maintenance_completed');
  wsService.broadcast({ type: 'maintenance_completed', id: req.params.id });
  await auditService.log(req.user.id, req.user.username, 'maintenance:complete', 'maintenance', req.params.id, null, req.ip);
  res.json({ message: 'Manutenzione completata' });
});

// ─── POST /api/maintenance/:id/cancel ────────────────────────────────────────
router.post('/:id/cancel', requireOperator, [
  body('reason').optional().isString(),
], async (req, res) => {
  const maint = await getOne('SELECT status FROM maintenance_windows WHERE id=$1', [req.params.id]);
  if (!maint || ['completed','cancelled'].includes(maint.status)) {
    return res.status(400).json({ error: 'Stato non valido' });
  }
  await query(
    `UPDATE maintenance_windows SET status='cancelled', rejection_reason=$1, updated_at=NOW() WHERE id=$2`,
    [req.body.reason || null, req.params.id]
  );
  wsService.broadcast({ type: 'maintenance_cancelled', id: req.params.id });
  await auditService.log(req.user.id, req.user.username, 'maintenance:cancel', 'maintenance', req.params.id, req.body.reason||null, req.ip);
  res.json({ message: 'Manutenzione annullata' });
});

// ─── DELETE /api/maintenance/:id ─────────────────────────────────────────────
router.delete('/:id', requireAdmin, async (req, res) => {
  await query('DELETE FROM maintenance_windows WHERE id=$1', [req.params.id]);
  await auditService.log(req.user.id, req.user.username, 'maintenance:delete', 'maintenance', req.params.id, null, req.ip);
  res.json({ message: 'Manutenzione eliminata' });
});

module.exports = router;
