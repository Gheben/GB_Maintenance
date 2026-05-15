const { Router } = require('express');
const { requireAuth, requireSuperAdmin } = require('../middleware/authMiddleware');
const { getMany, getOne, query } = require('../db/database');

const router = Router();
router.use(requireAuth, requireSuperAdmin);

function normalizeRetentionDays(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 365;
  return Math.min(3650, Math.max(1, parsed));
}

async function loadAuditRetention() {
  const row = await getOne("SELECT value FROM settings WHERE key='general_config'");
  const general = row ? JSON.parse(row.value || '{}') : {};
  return {
    retentionDays: normalizeRetentionDays(general.audit_log_retention_days),
    autoPurge: general.audit_log_auto_purge !== false,
  };
}

// ─── GET /api/audit ───────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const { user_id, username, action, entity_type, from, to, page = 1, limit = 50 } = req.query;
  const pageNum = Math.max(1, Number.parseInt(page, 10) || 1);
  const limitNum = Math.min(500, Math.max(1, Number.parseInt(limit, 10) || 50));
  const offset = (pageNum - 1) * limitNum;
  const retention = await loadAuditRetention();

  const params = []; let i = 1;
  const filters = [];

  filters.push(`created_at >= NOW() - ($${i++} || ' days')::INTERVAL`);
  params.push(String(retention.retentionDays));

  if (user_id)     { filters.push(`user_id=$${i++}`); params.push(user_id); }
  if (username)    { filters.push(`username ILIKE $${i++}`); params.push(`%${username}%`); }
  if (action)      { filters.push(`action ILIKE $${i++}`); params.push(`%${action}%`); }
  if (entity_type) { filters.push(`entity_type=$${i++}`); params.push(entity_type); }
  if (from)        { filters.push(`created_at >= $${i++}`); params.push(from); }
  if (to)          { filters.push(`created_at <= $${i++}`); params.push(to); }

  const where = `WHERE ${filters.join(' AND ')}`;
  const [totalRes, rows] = await Promise.all([
    query(`SELECT COUNT(*) FROM audit_log ${where}`, params),
    getMany(
      `SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i}`,
      [...params, limitNum, offset]
    ),
  ]);
  const total = Number.parseInt(totalRes.rows[0].count, 10) || 0;
  res.json({
    data: rows,
    total,
    page: pageNum,
    limit: limitNum,
    retention_days: retention.retentionDays,
    retention_auto_purge: retention.autoPurge,
  });
});

// ─── DELETE /api/audit/purge ──────────────────────────────────────────────────
router.delete('/purge', async (req, res) => {
  const retention = await loadAuditRetention();
  const requestedDays = Number.parseInt(req.query.days, 10);
  const days = Number.isFinite(requestedDays) ? Math.max(1, requestedDays) : retention.retentionDays;
  const result = await query(
    `DELETE FROM audit_log WHERE created_at < NOW() - ($1 || ' days')::INTERVAL`,
    [String(days)]
  );
  res.json({ removed: result.rowCount, days });
});

module.exports = router;
