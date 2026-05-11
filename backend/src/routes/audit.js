const { Router } = require('express');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');
const { getMany, query } = require('../db/database');

const router = Router();
router.use(requireAuth, requireAdmin);

// ─── GET /api/audit ───────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const { user_id, username, action, entity_type, from, to, page = 1, limit = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const params = []; let i = 1;
  const filters = [];

  if (user_id)     { filters.push(`user_id=$${i++}`); params.push(user_id); }
  if (username)    { filters.push(`username ILIKE $${i++}`); params.push(`%${username}%`); }
  if (action)      { filters.push(`action ILIKE $${i++}`); params.push(`%${action}%`); }
  if (entity_type) { filters.push(`entity_type=$${i++}`); params.push(entity_type); }
  if (from)        { filters.push(`created_at >= $${i++}`); params.push(from); }
  if (to)          { filters.push(`created_at <= $${i++}`); params.push(to); }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const total = parseInt((await query(`SELECT COUNT(*) FROM audit_log ${where}`, params)).rows[0].count);
  const rows = await getMany(
    `SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i}`,
    [...params, parseInt(limit), offset]
  );
  res.json({ data: rows, total, page: parseInt(page), limit: parseInt(limit) });
});

module.exports = router;
