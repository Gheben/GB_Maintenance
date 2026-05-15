const { Router } = require('express');
const { body, validationResult } = require('express-validator');
const { requireAuth, requireChangeManager, requireAdmin } = require('../middleware/authMiddleware');
const { query, getOne, getMany } = require('../db/database');
const auditService = require('../services/auditService');

const router = Router();
router.use(requireAuth);

// ─── GET /api/blackout ────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const rows = await getMany(
    `SELECT bp.*, u.display_name as created_by_name FROM blackout_periods bp
     LEFT JOIN users u ON u.id=bp.created_by ORDER BY bp.start_date DESC`
  );
  for (const row of rows) {
    const sids = row.service_ids || [];
    const aids = row.asset_ids   || [];
    row.services = sids.length ? await getMany(`SELECT id, name FROM services WHERE id = ANY($1::uuid[])`, [sids]) : [];
    row.assets   = aids.length ? await getMany(`SELECT id, name FROM assets   WHERE id = ANY($1::uuid[])`, [aids]) : [];
  }
  res.json(rows);
});

// ─── GET /api/blackout/check ──────────────────────────────────────────────────
router.get('/check', async (req, res) => {
  const { start, end } = req.query;
  if (!start || !end) return res.status(400).json({ error: 'start e end richiesti' });
  const row = await getOne(
    `SELECT id, name FROM blackout_periods WHERE start_date <= $2 AND end_date >= $1`,
    [start, end]
  );
  res.json({ blocked: !!row, period: row || null });
});

// ─── GET /api/blackout/:id ────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  const row = await getOne(
    `SELECT bp.*, u.display_name as created_by_name FROM blackout_periods bp
     LEFT JOIN users u ON u.id=bp.created_by WHERE bp.id=$1`,
    [req.params.id]
  );
  if (!row) return res.status(404).json({ error: 'Periodo non trovato' });
  res.json(row);
});

// ─── POST /api/blackout ───────────────────────────────────────────────────────
router.post('/', requireChangeManager, [
  body('name').isString().trim().isLength({ min: 1, max: 200 }),
  body('start_date').isISO8601(),
  body('end_date').isISO8601(),
  body('description').optional().isString(),
  body('service_ids').optional().isArray(),
  body('asset_ids').optional().isArray(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  if (new Date(req.body.end_date) <= new Date(req.body.start_date)) {
    return res.status(400).json({ error: 'end_date deve essere dopo start_date' });
  }
  const sids = req.body.service_ids || [];
  const aids = req.body.asset_ids || [];
  const result = await query(
    `INSERT INTO blackout_periods (name, description, start_date, end_date, created_by, service_ids, asset_ids)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [req.body.name, req.body.description||null, req.body.start_date, req.body.end_date, req.user.id, sids, aids]
  );
  await auditService.log(req.user.id, req.user.username, 'blackout:create', 'blackout_period', result.rows[0].id, req.body.name, req.ip);
  res.status(201).json({ id: result.rows[0].id });
});

// ─── PUT /api/blackout/:id ────────────────────────────────────────────────────
router.put('/:id', requireChangeManager, async (req, res) => {
  const allowed = ['name','description','start_date','end_date'];
  const sets=[]; const vals=[]; let i=1;
  for (const f of allowed) {
    if (req.body[f] !== undefined) { sets.push(`${f}=$${i++}`); vals.push(req.body[f]); }
  }
  if (req.body.service_ids !== undefined) { sets.push(`service_ids=$${i++}`); vals.push(req.body.service_ids || []); }
  if (req.body.asset_ids   !== undefined) { sets.push(`asset_ids=$${i++}`);   vals.push(req.body.asset_ids   || []); }
  if (sets.length===0) return res.status(400).json({ error: 'Nessun campo' });
  vals.push(req.params.id);
  await query(`UPDATE blackout_periods SET ${sets.join(',')} WHERE id=$${i}`, vals);
  res.json({ message: 'Periodo aggiornato' });
});

// ─── DELETE /api/blackout/:id ─────────────────────────────────────────────────
router.delete('/:id', requireAdmin, async (req, res) => {
  await query('DELETE FROM blackout_periods WHERE id=$1', [req.params.id]);
  await auditService.log(req.user.id, req.user.username, 'blackout:delete', 'blackout_period', req.params.id, null, req.ip);
  res.json({ message: 'Periodo eliminato' });
});

module.exports = router;
