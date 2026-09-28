const { Router } = require('express');
const { body, validationResult } = require('express-validator');
const { requireAuth, requireOperator, requireAdmin } = require('../middleware/authMiddleware');
const { query, getOne, getMany } = require('../db/database');
const auditService = require('../services/auditService');

const router = Router();
router.use(requireAuth);

// ─── Maintenance Templates ────────────────────────────────────────────────────
router.get('/maintenance', async (req, res) => {
  const rows = await getMany(
    `SELECT mt.*, u.display_name as created_by_name FROM maintenance_templates mt
     LEFT JOIN users u ON u.id=mt.created_by ORDER BY mt.name`
  );
  res.json(rows);
});

router.get('/maintenance/:id', async (req, res) => {
  const row = await getOne(
    `SELECT mt.*, u.display_name as created_by_name FROM maintenance_templates mt
     LEFT JOIN users u ON u.id=mt.created_by WHERE mt.id=$1`,
    [req.params.id]
  );
  if (!row) return res.status(404).json({ error: 'Template not found' });
  res.json(row);
});

router.post('/maintenance', requireOperator, [
  body('name').isString().trim().isLength({ min: 1, max: 200 }),
  body('type').isIn(['planned','emergency','upgrade','security_patch','infrastructure','other']),
  body('impact_level').optional().isIn(['critical','high','medium','low']),
  body('duration_minutes').optional().isInt({ min: 1 }),
  body('checklist').optional().isArray(),
  body('description').optional().isString(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const result = await query(
    `INSERT INTO maintenance_templates (name, description, type, impact_level, duration_minutes, checklist, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [req.body.name, req.body.description||null, req.body.type, req.body.impact_level||'medium',
     req.body.duration_minutes||60, JSON.stringify(req.body.checklist||[]), req.user.id]
  );
  await auditService.log(req.user.id, req.user.username, 'template:create', 'maintenance_template', result.rows[0].id, req.body.name, req.ip);
  res.status(201).json({ id: result.rows[0].id });
});

router.put('/maintenance/:id', requireOperator, async (req, res) => {
  const allowed = ['name','description','type','impact_level','duration_minutes','checklist'];
  const sets=[]; const vals=[]; let i=1;
  for (const f of allowed) {
    if (req.body[f] !== undefined) {
      sets.push(`${f}=$${i++}`);
      vals.push(f === 'checklist' ? JSON.stringify(req.body[f]) : req.body[f]);
    }
  }
  if (sets.length===0) return res.status(400).json({ error: 'No fields to update' });
  sets.push(`updated_at=$${i++}`); vals.push(new Date()); vals.push(req.params.id);
  await query(`UPDATE maintenance_templates SET ${sets.join(',')} WHERE id=$${i}`, vals);
  res.json({ message: 'Template updated' });
});

router.delete('/maintenance/:id', requireAdmin, async (req, res) => {
  await query('DELETE FROM maintenance_templates WHERE id=$1', [req.params.id]);
  res.json({ message: 'Template deleted' });
});

module.exports = router;
