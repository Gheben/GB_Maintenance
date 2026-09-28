const { Router } = require('express');
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');
const { query, getOne, getMany } = require('../db/database');
const auditService = require('../services/auditService');

const router = Router();
router.use(requireAuth);

// ─── GET /api/apikeys ─────────────────────────────────────────────────────────
router.get('/', requireAdmin, async (req, res) => {
  const rows = await getMany(
    `SELECT ak.id, ak.name, ak.key_prefix, ak.permissions, ak.is_active,
            ak.last_used_at, ak.expires_at, ak.created_at,
            u.display_name as owner_name
     FROM api_keys ak LEFT JOIN users u ON u.id=ak.owner_id
     WHERE ak.owner_id=$1 OR $2::varchar='superadmin'
     ORDER BY ak.created_at DESC`,
    [req.user.id, req.user.role]
  );
  res.json(rows);
});

// ─── POST /api/apikeys ────────────────────────────────────────────────────────
router.post('/', requireAdmin, [
  body('name').isString().trim().isLength({ min: 1, max: 200 }),
  body('permissions').optional().isObject(),
  body('expires_at').optional().isISO8601(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  // Generate key: prefix_randomhex
  const randomPart = crypto.randomBytes(24).toString('hex');
  const key = `gbm_${randomPart}`;
  const prefix = key.slice(0, 10);
  const hash = await bcrypt.hash(key, 10);

  const result = await query(
    `INSERT INTO api_keys (name, key_prefix, key_hash, permissions, owner_id, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [req.body.name, prefix, hash, JSON.stringify(req.body.permissions || {}),
     req.user.id, req.body.expires_at || null]
  );
  const id = result.rows[0].id;
  await auditService.log(req.user.id, req.user.username, 'apikey:create', 'api_key', id, `name=${req.body.name}`, req.ip);

  // Return the plain key ONCE — never retrievable again
  res.status(201).json({ id, key, message: 'Save this key now — it will not be shown again' });
});

// ─── DELETE /api/apikeys/:id ──────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  const key = await getOne('SELECT owner_id FROM api_keys WHERE id=$1', [req.params.id]);
  if (!key) return res.status(404).json({ error: 'API key not found' });
  if (req.user.role !== 'superadmin' && req.user.role !== 'admin' && key.owner_id !== req.user.id) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  await query('DELETE FROM api_keys WHERE id=$1', [req.params.id]);
  await auditService.log(req.user.id, req.user.username, 'apikey:delete', 'api_key', req.params.id, null, req.ip);
  res.json({ message: 'API key deleted' });
});

// ─── PATCH /api/apikeys/:id ───────────────────────────────────────────────────
router.patch('/:id', async (req, res) => {
  const sets=[]; const vals=[]; let i=1;
  if (req.body.is_active !== undefined) { sets.push(`is_active=$${i++}`); vals.push(req.body.is_active); }
  if (req.body.name !== undefined)      { sets.push(`name=$${i++}`); vals.push(req.body.name); }
  if (sets.length === 0) return res.status(400).json({ error: 'No fields to update' });
  vals.push(req.params.id);
  await query(`UPDATE api_keys SET ${sets.join(',')} WHERE id=$${i}`, vals);
  res.json({ message: 'Updated' });
});

module.exports = router;
