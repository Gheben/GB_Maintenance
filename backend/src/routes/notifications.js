const { Router } = require('express');
const { body, validationResult } = require('express-validator');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');
const { query, getOne, getMany } = require('../db/database');
const webpushService = require('../services/webpushService');

const router = Router();
router.use(requireAuth);

// ─── Web Push subscription management ─────────────────────────
router.get('/push/public-key', async (req, res) => {
  try {
    const publicKey = await webpushService.getPublicKey();
    res.json({ publicKey });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/push/subscribe', [
  body('subscription').isObject(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    await webpushService.saveSubscription(req.user.id, req.body.subscription);
    res.json({ message: 'Push subscription saved' });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/push/unsubscribe', [
  body('endpoint').isString().trim().isLength({ min: 1 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  await webpushService.removeSubscription(req.user.id, req.body.endpoint);
  res.json({ message: 'Push subscription removed' });
});

// ─── GET /api/notifications ─── In-app for current user ──────────────────────
router.get('/', async (req, res) => {
  const { unread, page = 1, limit = 30 } = req.query;
  const pageNum = Math.max(1, Number.parseInt(page, 10) || 1);
  const limitNum = Math.min(200, Math.max(1, Number.parseInt(limit, 10) || 30));
  const offset = (pageNum - 1) * limitNum;
  const filters = [`user_id=$1`]; const params = [req.user.id]; let i = 2;
  if (unread === 'true') { filters.push(`is_read=false`); }
  const where = `WHERE ${filters.join(' AND ')}`;
  const [totalRes, rows, unreadRes] = await Promise.all([
    query(`SELECT COUNT(*) FROM in_app_notifications ${where}`, params),
    getMany(
      `SELECT * FROM in_app_notifications ${where} ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i}`,
      [...params, limitNum, offset]
    ),
    query(`SELECT COUNT(*) FROM in_app_notifications WHERE user_id=$1 AND is_read=false`, [req.user.id]),
  ]);
  res.json({
    data: rows,
    total: Number.parseInt(totalRes.rows[0].count, 10) || 0,
    page: pageNum,
    limit: limitNum,
    unread_count: Number.parseInt(unreadRes.rows[0].count, 10) || 0,
  });
});

// ─── POST /api/notifications/read ────────────────────────────────────────────
router.post('/read', async (req, res) => {
  const { ids } = req.body;
  if (Array.isArray(ids) && ids.length > 0) {
    await query(`UPDATE in_app_notifications SET is_read=true WHERE id=ANY($1::uuid[]) AND user_id=$2`, [ids, req.user.id]);
  } else {
    await query(`UPDATE in_app_notifications SET is_read=true WHERE user_id=$1`, [req.user.id]);
  }
  res.json({ message: 'Notifications marked as read' });
});

// ─── DELETE /api/notifications ───────────────────────────────────────────────
router.delete('/', async (req, res) => {
  const { ids } = req.body || {};
  if (Array.isArray(ids) && ids.length > 0) {
    await query(`DELETE FROM in_app_notifications WHERE id=ANY($1::uuid[]) AND user_id=$2`, [ids, req.user.id]);
    return res.json({ message: 'Notifications deleted', deleted: ids.length });
  }

  const deletedRes = await query(`DELETE FROM in_app_notifications WHERE user_id=$1`, [req.user.id]);
  res.json({ message: 'All notifications deleted', deleted: deletedRes.rowCount || 0 });
});

// ─── GET /api/notifications/log ──────────────────────────────────────────────
router.get('/log', requireAdmin, async (req, res) => {
  const { event_type, status, page = 1, limit = 50 } = req.query;
  const pageNum = Math.max(1, Number.parseInt(page, 10) || 1);
  const limitNum = Math.min(500, Math.max(1, Number.parseInt(limit, 10) || 50));
  const offset = (pageNum - 1) * limitNum;
  const params = []; let i = 1;
  const filters = [];
  if (event_type) { filters.push(`event_type=$${i++}`); params.push(event_type); }
  if (status)     { filters.push(`status=$${i++}`); params.push(status); }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const [totalRes, rows] = await Promise.all([
    query(`SELECT COUNT(*) FROM notification_log ${where}`, params),
    getMany(
      `SELECT * FROM notification_log ${where} ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i}`,
      [...params, limitNum, offset]
    ),
  ]);
  res.json({
    data: rows,
    total: Number.parseInt(totalRes.rows[0].count, 10) || 0,
    page: pageNum,
    limit: limitNum,
  });
});

// ─── GET /api/notifications/templates ────────────────────────────────────────
router.get('/templates', requireAdmin, async (req, res) => {
  const rows = await getMany('SELECT * FROM notification_templates ORDER BY event_type');
  res.json(rows);
});

// ─── PUT /api/notifications/templates/:id ─────────────────────────────────────
router.put('/templates/:id', requireAdmin, [
  body('subject_template').optional().isString(),
  body('body_html_template').optional().isString(),
  body('is_active').optional().isBoolean(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const sets=[]; const vals=[]; let i=1;
  if (req.body.subject_template !== undefined)   { sets.push(`subject_template=$${i++}`); vals.push(req.body.subject_template); }
  if (req.body.body_html_template !== undefined) { sets.push(`body_html_template=$${i++}`); vals.push(req.body.body_html_template); }
  if (req.body.is_active !== undefined)          { sets.push(`is_active=$${i++}`); vals.push(req.body.is_active); }
  if (sets.length === 0) return res.status(400).json({ error: 'No fields to update' });
  sets.push(`updated_at=$${i++}`); vals.push(new Date()); vals.push(req.params.id);
  await query(`UPDATE notification_templates SET ${sets.join(',')} WHERE id=$${i}`, vals);
  res.json({ message: 'Template updated' });
});

module.exports = router;
