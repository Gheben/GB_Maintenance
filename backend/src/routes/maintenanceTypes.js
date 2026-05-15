const { Router } = require('express');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');
const { query, getOne, getMany } = require('../db/database');
const auditService = require('../services/auditService');

const router = Router();
router.use(requireAuth);

// Slugify: "Security Patch" → "security_patch"
function toSlug(str) {
  return str.trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

// ─── GET /api/maintenance-types ──────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const rows = await getMany(
      `SELECT * FROM maintenance_types ORDER BY sort_order, label`,
      []
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/maintenance-types ─────────────────────────────────────────────
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { label, slug: customSlug, sort_order, color } = req.body;
    if (!label || !label.trim()) return res.status(400).json({ error: 'Label is required' });

    const slug = customSlug ? customSlug.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_') : toSlug(label);
    if (!slug) return res.status(400).json({ error: 'Invalid slug' });

    const maxOrder = await query(`SELECT COALESCE(MAX(sort_order),0)+1 AS next FROM maintenance_types`);
    const order = sort_order != null ? parseInt(sort_order) : maxOrder.rows[0].next;
    const safeColor = (color && /^#[0-9a-fA-F]{3,8}$/.test(color)) ? color : '#6366f1';

    const result = await query(
      `INSERT INTO maintenance_types (slug, label, sort_order, color) VALUES ($1,$2,$3,$4)
       ON CONFLICT (slug) DO NOTHING
       RETURNING *`,
      [slug, label.trim(), order, safeColor]
    );

    if (result.rows.length === 0) {
      return res.status(409).json({ error: `Slug "${slug}" already exists` });
    }

    await auditService.log(req.user.id, req.user.username, 'maintenance_type:create', 'maintenance_type', result.rows[0].id, null, req.ip, req.get('user-agent'));
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/maintenance-types/:id ──────────────────────────────────────────
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const existing = await getOne(`SELECT * FROM maintenance_types WHERE id=$1`, [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Type not found' });

    const { label, sort_order, color } = req.body;
    const sets = []; const vals = []; let i = 1;
    if (label !== undefined) { sets.push(`label=$${i++}`); vals.push(label.trim()); }
    if (sort_order !== undefined) { sets.push(`sort_order=$${i++}`); vals.push(parseInt(sort_order)); }
    if (color !== undefined) {
      const safeColor = /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : '#6366f1';
      sets.push(`color=$${i++}`); vals.push(safeColor);
    }
    if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update' });
    sets.push(`updated_at=$${i++}`); vals.push(new Date());
    vals.push(req.params.id);

    const result = await query(
      `UPDATE maintenance_types SET ${sets.join(',')} WHERE id=$${i} RETURNING *`,
      vals
    );

    await auditService.log(req.user.id, req.user.username, 'maintenance_type:update', 'maintenance_type', req.params.id, null, req.ip, req.get('user-agent'));
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/maintenance-types/:id ───────────────────────────────────────
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const existing = await getOne(`SELECT * FROM maintenance_types WHERE id=$1`, [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Type not found' });

    const usage = await query(
      `SELECT COUNT(*) FROM maintenance_windows WHERE type=$1`,
      [existing.slug]
    );
    if (parseInt(usage.rows[0].count) > 0) {
      return res.status(409).json({ error: `Cannot delete: ${usage.rows[0].count} maintenance window(s) use this type` });
    }

    await query(`DELETE FROM maintenance_types WHERE id=$1`, [req.params.id]);
    await auditService.log(req.user.id, req.user.username, 'maintenance_type:delete', 'maintenance_type', req.params.id, null, req.ip, req.get('user-agent'));
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
