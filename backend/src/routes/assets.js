const { Router } = require('express');
const { body, param, query: qv, validationResult } = require('express-validator');
const { requireAuth, requireOperator, requireAdmin } = require('../middleware/authMiddleware');
const { query, getOne, getMany, transaction } = require('../db/database');
const auditService = require('../services/auditService');
const probeService = require('../services/probeService');
const wsService = require('../services/wsService');

const router = Router();
router.use(requireAuth);

const CATEGORIES = ['application','infrastructure','database','network','hardware','api','other'];
const CRITICALITIES = ['critical','high','medium','low'];
const STATUSES = ['operational','degraded','partial_outage','major_outage','under_maintenance'];

// ─── GET /api/assets ──────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const { search, category, criticality, status, page = 1, limit = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const params = []; let i = 1;
  const filters = [`a.is_active = true`];

  if (search) { filters.push(`(a.name ILIKE $${i} OR a.description ILIKE $${i})`); params.push(`%${search}%`); i++; }
  if (category) { filters.push(`a.category = $${i++}`); params.push(category); }
  if (criticality) { filters.push(`a.criticality = $${i++}`); params.push(criticality); }
  if (status) { filters.push(`a.status = $${i++}`); params.push(status); }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const countRes = await query(`SELECT COUNT(*) FROM assets a ${where}`, params);
  const total = parseInt(countRes.rows[0].count);

  const rows = await getMany(
    `SELECT a.*,
       u.display_name as owner_name,
       lg.name as owner_group_name,
       COALESCE(
         CASE a.owner_type
           WHEN 'local_group' THEN lg.name
           WHEN 'ldap_group'  THEN a.owner_ldap_name
           ELSE u.display_name
         END
       , '') as owner_label
     FROM assets a
     LEFT JOIN users u ON u.id=a.owner_id
     LEFT JOIN local_groups lg ON lg.id=a.owner_group_id
     ${where} ORDER BY a.name LIMIT $${i++} OFFSET $${i}`,
    [...params, parseInt(limit), offset]
  );
  res.json({ data: rows, total, page: parseInt(page), limit: parseInt(limit) });
});

// ─── GET /api/assets/categories ───────────────────────────────────────────────
router.get('/categories', (req, res) => res.json(CATEGORIES));

// ─── GET /api/assets/:id ──────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  const asset = await getOne(
    `SELECT a.*,
       u.display_name as owner_name, u.email as owner_email,
       lg.name as owner_group_name,
       COALESCE(
         CASE a.owner_type
           WHEN 'local_group' THEN lg.name
           WHEN 'ldap_group'  THEN a.owner_ldap_name
           ELSE u.display_name
         END
       , '') as owner_label
     FROM assets a
     LEFT JOIN users u ON u.id=a.owner_id
     LEFT JOIN local_groups lg ON lg.id=a.owner_group_id
     WHERE a.id=$1`,
    [req.params.id]
  );
  if (!asset) return res.status(404).json({ error: 'Asset non trovato' });

  // Dependencies (what this asset depends on)
  const dependsOn = await getMany(
    `SELECT a2.id, a2.name, a2.category, a2.status, a2.criticality
     FROM asset_dependencies ad JOIN assets a2 ON a2.id=ad.depends_on_id
     WHERE ad.asset_id=$1`,
    [req.params.id]
  );
  // Required by (who depends on this asset)
  const requiredBy = await getMany(
    `SELECT a2.id, a2.name, a2.category, a2.status, a2.criticality
     FROM asset_dependencies ad JOIN assets a2 ON a2.id=ad.asset_id
     WHERE ad.depends_on_id=$1`,
    [req.params.id]
  );
  // Services using this asset
  const services = await getMany(
    `SELECT s.id, s.name, s.status, s.criticality
     FROM services s JOIN service_assets sa ON sa.service_id=s.id
     WHERE sa.asset_id=$1`,
    [req.params.id]
  );
  res.json({ ...asset, dependsOn, requiredBy, services });
});

// ─── GET /api/assets/:id/history ─────────────────────────────────────────────
router.get('/:id/history', async (req, res) => {
  const { limit = 50, page = 1 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const rows = await getMany(
    `SELECT * FROM status_history WHERE entity_type='asset' AND entity_id=$1
     ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [req.params.id, parseInt(limit), offset]
  );
  res.json(rows);
});

// ─── GET /api/assets/:id/probes ───────────────────────────────────────────────
router.get('/:id/probes', async (req, res) => {
  const { limit = 100 } = req.query;
  const rows = await getMany(
    `SELECT * FROM probe_results WHERE asset_id=$1 ORDER BY probed_at DESC LIMIT $2`,
    [req.params.id, parseInt(limit)]
  );
  res.json(rows);
});

// ─── POST /api/assets/:id/probe ───────────────────────────────────────────────
router.post('/:id/probe', requireOperator, async (req, res) => {
  try {
    const result = await probeService.probeNow(req.params.id);
    res.json(result);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ─── GET /api/assets/:id/maintenance ─────────────────────────────────────────
router.get('/:id/maintenance', async (req, res) => {
  const rows = await getMany(
    `SELECT mw.id, mw.title, mw.type, mw.status, mw.scheduled_start, mw.scheduled_end, mw.impact_level
     FROM maintenance_windows mw
     JOIN maintenance_assets ma ON ma.maintenance_id=mw.id
     WHERE ma.asset_id=$1 ORDER BY mw.scheduled_start DESC LIMIT 50`,
    [req.params.id]
  );
  res.json(rows);
});

// ─── GET /api/assets/:id/users ───────────────────────────────────────────────
router.get('/:id/users', async (req, res) => {
  const rows = await getMany(
    `SELECT DISTINCT u.id, u.username, u.display_name, u.email, u.role, u.auth_type
     FROM service_subscribers ss
     JOIN service_assets sa ON sa.service_id = ss.service_id
     LEFT JOIN users u ON u.id = ss.user_id
     WHERE sa.asset_id = $1 AND u.id IS NOT NULL
     ORDER BY u.display_name`,
    [req.params.id]
  );
  res.json(rows);
});

// ─── GET /api/assets/:id/licenses ───────────────────────────────────────────
router.get('/:id/licenses', async (req, res) => {
  const rows = await getMany(
    `SELECT l.id, l.name, l.expiry_date, l.approval_status,
            CASE WHEN la.asset_id IS NULL THEN false ELSE true END AS assigned
     FROM licenses l
     LEFT JOIN license_assets la ON la.license_id=l.id AND la.asset_id=$1
     WHERE l.is_active=true
     ORDER BY l.name`,
    [req.params.id]
  );
  res.json(rows);
});

// ─── PUT /api/assets/:id/licenses ───────────────────────────────────────────
router.put('/:id/licenses', requireOperator, [
  body('license_ids').isArray(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const asset = await getOne('SELECT id FROM assets WHERE id=$1', [req.params.id]);
  if (!asset) return res.status(404).json({ error: 'Asset non trovato' });

  const licenseIds = Array.isArray(req.body.license_ids) ? req.body.license_ids : [];
  await transaction(async (client) => {
    await client.query('DELETE FROM license_assets WHERE asset_id=$1', [req.params.id]);
    for (const lid of licenseIds) {
      await client.query(
        'INSERT INTO license_assets (license_id, asset_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [lid, req.params.id]
      );
    }
  });

  res.json({ message: 'Licenses updated' });
});

// ─── POST /api/assets ─────────────────────────────────────────────────────────
router.post('/', requireOperator, [
  body('name').isString().trim().isLength({ min: 1, max: 200 }),
  body('category').isIn(CATEGORIES),
  body('criticality').optional().isIn(CRITICALITIES),
  body('description').optional().isString(),
  body('owner_id').optional().isUUID(),
  body('owner_type').optional().isIn(['user','local_group','ldap_group']),
  body('owner_group_id').optional({ nullable: true }).isUUID(),
  body('owner_ldap_dn').optional({ nullable: true }).isString(),
  body('owner_ldap_name').optional({ nullable: true }).isString().trim(),
  body('probe_enabled').optional().isBoolean(),
  body('probe_type').optional().isIn(['http','https','tcp']),
  body('probe_url').optional().isString(),
  body('probe_interval_seconds').optional().isInt({ min: 30 }),
  body('probe_timeout_seconds').optional().isInt({ min: 1, max: 60 }),
  body('expected_status_code').optional().isInt({ min: 100, max: 599 }),
  body('tags').optional().isArray(),
  body('metadata').optional().isObject(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const slug = _slugify(req.body.name) + '-' + Date.now().toString(36);
    const result = await query(
      `INSERT INTO assets (name, slug, category, criticality, description, owner_id, owner_type, owner_group_id, owner_ldap_dn, owner_ldap_name,
         probe_enabled, probe_type, probe_url, probe_interval_seconds, probe_timeout_seconds,
         expected_status_code, tags, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
      [
        req.body.name, slug,
        req.body.category, req.body.criticality || 'medium',
        req.body.description || null,
        req.body.owner_type === 'user' ? (req.body.owner_id||null) : null,
        req.body.owner_type || 'user',
        req.body.owner_type === 'local_group' ? (req.body.owner_group_id||null) : null,
        req.body.owner_type === 'ldap_group' ? (req.body.owner_ldap_dn||null) : null,
        req.body.owner_type === 'ldap_group' ? (req.body.owner_ldap_name||null) : null,
        req.body.probe_enabled || false, req.body.probe_type || null,
        req.body.probe_url || null, req.body.probe_interval_seconds || 300,
        req.body.probe_timeout_seconds || 10, req.body.expected_status_code || 200,
        JSON.stringify(req.body.tags || []), JSON.stringify(req.body.metadata || {})
      ]
    );
    const id = result.rows[0].id;
    // Record initial status
    await query(`INSERT INTO status_history (entity_type, entity_id, status, changed_by) VALUES ('asset',$1,'operational',$2)`,
      [id, req.user.username]);
    await auditService.log(req.user.id, req.user.username, 'asset:create', 'asset', id, `name=${req.body.name}`, req.ip, req.get('user-agent'));
    res.status(201).json({ id });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Slug già in uso, cambia il nome' });
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/assets/:id ──────────────────────────────────────────────────────
router.put('/:id', requireOperator, async (req, res) => {
  const asset = await getOne('SELECT id FROM assets WHERE id=$1', [req.params.id]);
  if (!asset) return res.status(404).json({ error: 'Asset non trovato' });

  const allowed = ['name','category','criticality','description','owner_id','owner_type',
    'owner_group_id','owner_ldap_dn','owner_ldap_name','probe_enabled',
    'probe_type','probe_url','probe_interval_seconds','probe_timeout_seconds',
    'expected_status_code','tags','metadata','is_active'];
  const sets = []; const vals = []; let i = 1;
  for (const field of allowed) {
    if (req.body[field] !== undefined) {
      sets.push(`${field}=$${i++}`);
      if (['tags','metadata'].includes(field)) vals.push(JSON.stringify(req.body[field]));
      else vals.push(req.body[field]);
    }
  }
  if (sets.length === 0) return res.status(400).json({ error: 'Nessun campo da aggiornare' });
  sets.push(`updated_at=$${i++}`); vals.push(new Date()); vals.push(req.params.id);
  await query(`UPDATE assets SET ${sets.join(',')} WHERE id=$${i}`, vals);
  await auditService.log(req.user.id, req.user.username, 'asset:update', 'asset', req.params.id, null, req.ip, req.get('user-agent'));
  res.json({ message: 'Asset aggiornato' });
});

// ─── PATCH /api/assets/:id/status ─────────────────────────────────────────────
router.patch('/:id/status', requireOperator, [
  body('status').isIn(STATUSES),
  body('reason').optional().isString(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  await query(`UPDATE assets SET status=$1, updated_at=NOW() WHERE id=$2`, [req.body.status, req.params.id]);
  await query(
    `INSERT INTO status_history (entity_type, entity_id, status, changed_by, reason) VALUES ('asset',$1,$2,$3,$4)`,
    [req.params.id, req.body.status, req.user.username, req.body.reason || null]
  );
  wsService.broadcast({ type: 'asset_status_changed', assetId: req.params.id, status: req.body.status });
  await auditService.log(req.user.id, req.user.username, 'asset:status_change', 'asset', req.params.id, `status=${req.body.status}`, req.ip);
  res.json({ message: 'Stato aggiornato' });
});

// ─── DELETE /api/assets/:id ───────────────────────────────────────────────────
router.delete('/:id', requireAdmin, async (req, res) => {
  await query('UPDATE assets SET is_active=false, updated_at=NOW() WHERE id=$1', [req.params.id]);
  await auditService.log(req.user.id, req.user.username, 'asset:delete', 'asset', req.params.id, null, req.ip, req.get('user-agent'));
  res.json({ message: 'Asset disattivato' });
});

// ─── POST /api/assets/:id/dependencies ───────────────────────────────────────
router.post('/:id/dependencies', requireOperator, [
  body('depends_on_id').isUUID(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  if (req.params.id === req.body.depends_on_id) return res.status(400).json({ error: 'Un asset non può dipendere da se stesso' });

  await query(
    `INSERT INTO asset_dependencies (asset_id, depends_on_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
    [req.params.id, req.body.depends_on_id]
  );
  res.status(201).json({ message: 'Dipendenza aggiunta' });
});

// ─── DELETE /api/assets/:id/dependencies/:depId ───────────────────────────────
router.delete('/:id/dependencies/:depId', requireOperator, async (req, res) => {
  await query('DELETE FROM asset_dependencies WHERE asset_id=$1 AND depends_on_id=$2', [req.params.id, req.params.depId]);
  res.json({ message: 'Dipendenza rimossa' });
});

function _slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

module.exports = router;
