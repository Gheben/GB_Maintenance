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

// GET /api/incident-severities
router.get('/', async (req, res) => {
  try {
    const rows = await getMany('SELECT * FROM incident_severities ORDER BY sort_order, label', []);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/incident-severities
router.post('/', requireAdmin, async (req, res) => {
  const { label, color = '#6366f1' } = req.body;
  if (!label || typeof label !== 'string' || !label.trim()) {
    return res.status(400).json({ error: 'label required' });
  }
  if (!/^#[0-9a-fA-F]{3,8}$/.test(color)) {
    return res.status(400).json({ error: 'invalid color' });
  }

  const slug = toSlug(label);
  if (!slug) return res.status(400).json({ error: 'invalid label' });

  try {
    const existing = await getOne('SELECT id FROM incident_severities WHERE slug=$1', [slug]);
    if (existing) return res.status(409).json({ error: 'Severity already exists' });

    const maxRow = await getOne('SELECT COALESCE(MAX(sort_order),0) AS m FROM incident_severities', []);
    const sort_order = (maxRow?.m ?? 0) + 1;

    const row = await getOne(
      `INSERT INTO incident_severities (slug, label, color, sort_order)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [slug, label.trim(), color, sort_order]
    );

    await auditService.log(
      req.user.id,
      req.user.username,
      'incident_severity:create',
      'incident_severity',
      row.id,
      `slug=${slug}`,
      req.ip,
      req.get('user-agent')
    );

    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/incident-severities/:id
router.put('/:id', requireAdmin, async (req, res) => {
  const existing = await getOne('SELECT id FROM incident_severities WHERE id=$1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const { label, color } = req.body;
  const updates = [];
  const params = [];
  let i = 1;

  if (label != null) {
    if (!String(label).trim()) return res.status(400).json({ error: 'label required' });
    updates.push(`label=$${i++}`);
    params.push(String(label).trim());
  }

  if (color != null) {
    if (!/^#[0-9a-fA-F]{3,8}$/.test(color)) return res.status(400).json({ error: 'invalid color' });
    updates.push(`color=$${i++}`);
    params.push(color);
  }

  if (!updates.length) return res.status(400).json({ error: 'No fields to update' });

  updates.push('updated_at=NOW()');
  params.push(req.params.id);

  try {
    const row = await getOne(
      `UPDATE incident_severities SET ${updates.join(',')} WHERE id=$${i} RETURNING *`,
      params
    );

    await auditService.log(
      req.user.id,
      req.user.username,
      'incident_severity:update',
      'incident_severity',
      req.params.id,
      null,
      req.ip,
      req.get('user-agent')
    );

    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/incident-severities/:id
router.delete('/:id', requireAdmin, async (req, res) => {
  const existing = await getOne('SELECT id, slug FROM incident_severities WHERE id=$1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  try {
    const usage = await getOne('SELECT COUNT(*)::int AS c FROM incidents WHERE severity=$1', [existing.slug]);
    if (usage?.c > 0) {
      return res.status(409).json({ error: `Cannot delete: ${usage.c} incident(s) use this severity` });
    }

    await query('DELETE FROM incident_severities WHERE id=$1', [req.params.id]);

    await auditService.log(
      req.user.id,
      req.user.username,
      'incident_severity:delete',
      'incident_severity',
      req.params.id,
      `slug=${existing.slug}`,
      req.ip,
      req.get('user-agent')
    );

    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
