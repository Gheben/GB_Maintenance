const { Router } = require('express');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');
const { getMany, getOne, query } = require('../db/database');
const auditService = require('../services/auditService');

const router = Router();
router.use(requireAuth);

function toSlug(str) {
  return str.trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

// ─── GET /api/asset-categories ───────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const rows = await getMany(`SELECT * FROM asset_categories ORDER BY sort_order, label`, []);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/asset-categories ──────────────────────────────────────────────
router.post('/', requireAdmin, async (req, res) => {
  const { label, color = '#6366f1' } = req.body;
  if (!label || typeof label !== 'string' || !label.trim())
    return res.status(400).json({ error: 'label required' });
  if (!/^#[0-9a-fA-F]{3,8}$/.test(color))
    return res.status(400).json({ error: 'invalid color' });
  const slug = toSlug(label);
  try {
    const existing = await getOne(`SELECT id FROM asset_categories WHERE slug=$1`, [slug]);
    if (existing) return res.status(409).json({ error: 'Category already exists' });
    const maxRow = await getOne(`SELECT COALESCE(MAX(sort_order),0) AS m FROM asset_categories`, []);
    const sort_order = (maxRow?.m ?? 0) + 1;
    const row = await getOne(
      `INSERT INTO asset_categories (slug, label, color, sort_order) VALUES ($1,$2,$3,$4) RETURNING *`,
      [slug, label.trim(), color, sort_order]
    );
    await auditService.log(req.user.id, req.user.username, 'asset_category:create', 'asset_category', row.id, `slug=${slug}`, req.ip, req.get('user-agent'));
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/asset-categories/:id ───────────────────────────────────────────
router.put('/:id', requireAdmin, async (req, res) => {
  const existing = await getOne(`SELECT id FROM asset_categories WHERE id=$1`, [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { label, color } = req.body;
  const updates = [];
  const params = [];
  let i = 1;
  if (label != null) { updates.push(`label=$${i++}`); params.push(label.trim()); }
  if (color != null) {
    if (!/^#[0-9a-fA-F]{3,8}$/.test(color)) return res.status(400).json({ error: 'invalid color' });
    updates.push(`color=$${i++}`); params.push(color);
  }
  if (!updates.length) return res.status(400).json({ error: 'No fields to update' });
  updates.push(`updated_at=NOW()`);
  params.push(req.params.id);
  try {
    const row = await getOne(`UPDATE asset_categories SET ${updates.join(',')} WHERE id=$${i} RETURNING *`, params);
    await auditService.log(req.user.id, req.user.username, 'asset_category:update', 'asset_category', req.params.id, null, req.ip, req.get('user-agent'));
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/asset-categories/:id ────────────────────────────────────────
router.delete('/:id', requireAdmin, async (req, res) => {
  const existing = await getOne(`SELECT id, slug FROM asset_categories WHERE id=$1`, [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  try {
    await query(`DELETE FROM asset_categories WHERE id=$1`, [req.params.id]);
    await auditService.log(req.user.id, req.user.username, 'asset_category:delete', 'asset_category', req.params.id, `slug=${existing.slug}`, req.ip, req.get('user-agent'));
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
