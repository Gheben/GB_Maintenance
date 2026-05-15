const { Router } = require('express');
const { body, validationResult } = require('express-validator');
const { requireAuth, requireOperator, requireAdmin } = require('../middleware/authMiddleware');
const { query, getOne, getMany } = require('../db/database');
const auditService = require('../services/auditService');
const wsService = require('../services/wsService');

const router = Router();
router.use(requireAuth);

const CRITICALITIES = ['critical','high','medium','low'];
const STATUSES = ['operational','degraded','partial_outage','major_outage','under_maintenance'];

function normalizeOwnerTargets(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const type = String(raw.type || '').trim();
    if (!['user', 'local_group', 'ldap_user', 'ldap_group'].includes(type)) continue;
    const id = raw.id ? String(raw.id).trim() : '';
    const dn = raw.dn ? String(raw.dn).trim() : '';
    const name = raw.name ? String(raw.name).trim() : '';
    const email = raw.email ? String(raw.email).trim() : '';
    const key = `${type}:${id || dn}`;
    if (!key || key.endsWith(':') || seen.has(key)) continue;
    seen.add(key);
    out.push({ type, id: id || undefined, dn: dn || undefined, name: name || undefined, email: email || undefined });
    if (out.length >= 50) break;
  }
  return out;
}

function primaryOwnerFieldsFromTargets(targets) {
  const first = Array.isArray(targets) && targets.length > 0 ? targets[0] : null;
  if (!first) {
    return { owner_type: 'user', owner_id: null, owner_group_id: null, owner_ldap_dn: null, owner_ldap_name: null };
  }
  if (first.type === 'user') {
    return { owner_type: 'user', owner_id: first.id || null, owner_group_id: null, owner_ldap_dn: null, owner_ldap_name: null };
  }
  if (first.type === 'local_group') {
    return { owner_type: 'local_group', owner_id: null, owner_group_id: first.id || null, owner_ldap_dn: null, owner_ldap_name: null };
  }
  return {
    owner_type: first.type,
    owner_id: null,
    owner_group_id: null,
    owner_ldap_dn: first.dn || null,
    owner_ldap_name: first.name || first.dn || null,
  };
}

// ─── GET /api/services ────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const { search, criticality, status, page = 1, limit = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const params = []; let i = 1;
  const filters = ['s.is_active=true'];

  if (search)      { filters.push(`(s.name ILIKE $${i} OR s.description ILIKE $${i})`); params.push(`%${search}%`); i++; }
  if (criticality) { filters.push(`s.criticality=$${i++}`); params.push(criticality); }
  if (status)      { filters.push(`s.status=$${i++}`); params.push(status); }

  const where = `WHERE ${filters.join(' AND ')}`;
  const countRes = await query(`SELECT COUNT(*) FROM services s ${where}`, params);
  const total = parseInt(countRes.rows[0].count);

  const rows = await getMany(
    `SELECT s.*, u.display_name as owner_name, u.email as owner_email,
       lg.name as owner_group_name,
       COALESCE(lic.license_count, 0) as license_count,
       COALESCE(lic.expired_license_count, 0) as expired_license_count,
       lic.next_license_expiry,
       prim.primary_license_name,
       prim.primary_supplier_name,
       COALESCE(NULLIF(s.owner_targets->0->>'name',''),
         CASE s.owner_type
           WHEN 'local_group' THEN lg.name
           WHEN 'ldap_user'   THEN s.owner_ldap_name
           WHEN 'ldap_group'  THEN s.owner_ldap_name
           ELSE u.display_name
         END
       , '') as owner_label,
       COALESCE(jsonb_array_length(s.owner_targets), 0)::int as owner_count,
       COALESCE(jsonb_array_length(s.user_targets), 0)::int as user_count,
       (SELECT COUNT(*)::int FROM service_subscribers ss WHERE ss.service_id=s.id) as subscriber_count,
       (SELECT COUNT(*)::int FROM service_assets sa WHERE sa.service_id=s.id) as asset_count
     FROM services s
     LEFT JOIN users u ON u.id=s.owner_id
     LEFT JOIN local_groups lg ON lg.id=s.owner_group_id
     LEFT JOIN LATERAL (
       SELECT
         COUNT(*)::int AS license_count,
         COUNT(*) FILTER (WHERE l.expiry_date IS NOT NULL AND l.expiry_date < CURRENT_DATE)::int AS expired_license_count,
         MIN(l.expiry_date) FILTER (WHERE l.expiry_date IS NOT NULL AND l.expiry_date >= CURRENT_DATE) AS next_license_expiry
       FROM license_services ls
       JOIN licenses l ON l.id = ls.license_id
       WHERE ls.service_id = s.id AND l.is_active = true
     ) lic ON TRUE
     LEFT JOIN LATERAL (
       SELECT
         l.name AS primary_license_name,
         sp.company AS primary_supplier_name
       FROM license_services ls
       JOIN licenses l ON l.id = ls.license_id
       LEFT JOIN suppliers sp ON sp.id = l.supplier_id
       WHERE ls.service_id = s.id AND l.is_active = true
       ORDER BY l.expiry_date NULLS LAST, l.name
       LIMIT 1
     ) prim ON TRUE
     ${where} ORDER BY s.system_name NULLS LAST, s.name LIMIT $${i++} OFFSET $${i}`,
    [...params, parseInt(limit), offset]
  );
  res.json({ data: rows, total, page: parseInt(page), limit: parseInt(limit) });
});

// ─── GET /api/services/:id ────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  const service = await getOne(
    `SELECT s.*, u.display_name as owner_name, u.email as owner_email, u.avatar_color as owner_avatar_color,
       lg.name as owner_group_name,
       COALESCE(
         CASE s.owner_type
           WHEN 'local_group' THEN lg.name
           WHEN 'ldap_user'   THEN s.owner_ldap_name
           WHEN 'ldap_group'  THEN s.owner_ldap_name
           ELSE u.display_name
         END
       , '') as owner_label
     FROM services s
     LEFT JOIN users u ON u.id=s.owner_id
     LEFT JOIN local_groups lg ON lg.id=s.owner_group_id
     WHERE s.id=$1`,
    [req.params.id]
  );
  if (!service) return res.status(404).json({ error: 'Servizio non trovato' });

  const assets = await getMany(
    `SELECT a.id, a.name, a.category, a.status, a.criticality
     FROM assets a JOIN service_assets sa ON sa.asset_id=a.id WHERE sa.service_id=$1`,
    [req.params.id]
  );
  const subscribers = await getMany(
    `SELECT ss.*, u.display_name, u.username, u.avatar_color
     FROM service_subscribers ss LEFT JOIN users u ON u.id=ss.user_id
     WHERE ss.service_id=$1 ORDER BY ss.created_at DESC`,
    [req.params.id]
  );
  const depends_on = await getMany(
    `SELECT s.id, s.name, s.slug, s.status AS current_status FROM services s
     JOIN service_dependencies sd ON sd.depends_on_id=s.id WHERE sd.service_id=$1`,
    [req.params.id]
  );
  const required_by = await getMany(
    `SELECT s.id, s.name, s.slug, s.status AS current_status FROM services s
     JOIN service_dependencies sd ON sd.service_id=s.id WHERE sd.depends_on_id=$1`,
    [req.params.id]
  );
  res.json({ ...service, assets, subscribers, depends_on, required_by });
});

// ─── GET /api/services/:id/uptime ─────────────────────────────────────────────
router.get('/:id/uptime', async (req, res) => {
  const days = parseInt(req.query.days || '90');
  // Get linked assets and their uptime
  const assets = await getMany(
    `SELECT a.id FROM service_assets sa JOIN assets a ON a.id=sa.asset_id WHERE sa.service_id=$1`,
    [req.params.id]
  );
  if (assets.length === 0) return res.json({ days: [], uptime_percent: 100 });

  const assetIds = assets.map(a => a.id);
  // Get status history for all assets in last N days
  const history = await getMany(
    `SELECT entity_id, status, created_at FROM status_history
     WHERE entity_type='asset' AND entity_id=ANY($1::uuid[]) AND created_at > NOW() - INTERVAL '${days} days'
     ORDER BY created_at ASC`,
    [assetIds]
  );
  res.json({ history, asset_count: assetIds.length });
});

// ─── POST /api/services ───────────────────────────────────────────────────────
router.post('/', requireOperator, [
  body('name').isString().trim().isLength({ min: 1, max: 200 }),
  body('criticality').optional().isIn(CRITICALITIES),
  body('description').optional().isString(),
  body('owner_id').optional({ nullable: true }).isUUID(),
  body('owner_type').optional().isIn(['user','local_group','ldap_user','ldap_group']),
  body('owner_group_id').optional({ nullable: true }).isUUID(),
  body('owner_ldap_dn').optional({ nullable: true }).isString(),
  body('owner_ldap_name').optional({ nullable: true }).isString().trim(),
  body('owner_targets').optional().isArray(),
  body('user_targets').optional().isArray(),
  body('system_name').optional().isString().trim(),
  body('sla_uptime_percent').optional().isFloat({ min: 0, max: 100 }),
  body('is_public').optional().isBoolean(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const slug = _slugify(req.body.name) + '-' + Date.now().toString(36);
    const ownerTargets = normalizeOwnerTargets(req.body.owner_targets);
    const userTargets = normalizeOwnerTargets(req.body.user_targets);
    const ownerFields = ownerTargets.length > 0
      ? primaryOwnerFieldsFromTargets(ownerTargets)
      : {
        owner_type: req.body.owner_type || 'user',
        owner_id: req.body.owner_type === 'user' ? (req.body.owner_id || null) : null,
        owner_group_id: req.body.owner_type === 'local_group' ? (req.body.owner_group_id || null) : null,
        owner_ldap_dn: ['ldap_user', 'ldap_group'].includes(req.body.owner_type) ? (req.body.owner_ldap_dn || null) : null,
        owner_ldap_name: ['ldap_user', 'ldap_group'].includes(req.body.owner_type) ? (req.body.owner_ldap_name || null) : null,
      };
    const hasOwner = ownerTargets.length > 0 || !!(ownerFields.owner_id || ownerFields.owner_group_id || ownerFields.owner_ldap_dn);
    if (!hasOwner) {
      return res.status(400).json({ error: 'At least one owner is required' });
    }
    const result = await query(
      `INSERT INTO services (name, slug, description, criticality, owner_id, owner_type, owner_group_id, owner_ldap_dn, owner_ldap_name, owner_targets, user_targets, system_name, sla_uptime_percent, is_public)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
      [req.body.name, slug, req.body.description||null, req.body.criticality||'medium',
       ownerFields.owner_id,
       ownerFields.owner_type,
       ownerFields.owner_group_id,
      ownerFields.owner_ldap_dn,
      ownerFields.owner_ldap_name,
      JSON.stringify(ownerTargets),
      JSON.stringify(userTargets),
       req.body.system_name||null, req.body.sla_uptime_percent||99.9, req.body.is_public||false]
    );
    const id = result.rows[0].id;
    await query(`INSERT INTO status_history (entity_type, entity_id, status, changed_by) VALUES ('service',$1,'operational',$2)`, [id, req.user.username]);
    await auditService.log(req.user.id, req.user.username, 'service:create', 'service', id, `name=${req.body.name}`, req.ip, req.get('user-agent'));
    res.status(201).json({ id });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Nome servizio già in uso' });
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/services/:id ────────────────────────────────────────────────────
router.put('/:id', requireOperator, async (req, res) => {
  const service = await getOne(
    `SELECT id, owner_id, owner_group_id, owner_ldap_dn, owner_targets
     FROM services
     WHERE id=$1`,
    [req.params.id]
  );
  if (!service) return res.status(404).json({ error: 'Servizio non trovato' });

  const allowed = ['name','description','criticality','owner_id','owner_type','owner_group_id','owner_ldap_dn','owner_ldap_name','owner_targets','user_targets','system_name','sla_uptime_percent','is_public','is_active'];
  const sets=[]; const vals=[]; let i=1;
  for (const f of allowed) {
    if (req.body[f] !== undefined) {
      sets.push(`${f}=$${i++}`);
      vals.push(['owner_targets','user_targets'].includes(f) ? JSON.stringify(req.body[f]) : req.body[f]);
    }
  }

  if (req.body.owner_targets !== undefined) {
    const ownerTargets = normalizeOwnerTargets(req.body.owner_targets);
    if (ownerTargets.length < 1) {
      return res.status(400).json({ error: 'At least one owner is required' });
    }
    const ownerFields = primaryOwnerFieldsFromTargets(ownerTargets);
    sets.push(`owner_id=$${i++}`); vals.push(ownerFields.owner_id);
    sets.push(`owner_type=$${i++}`); vals.push(ownerFields.owner_type);
    sets.push(`owner_group_id=$${i++}`); vals.push(ownerFields.owner_group_id);
    sets.push(`owner_ldap_dn=$${i++}`); vals.push(ownerFields.owner_ldap_dn);
    sets.push(`owner_ldap_name=$${i++}`); vals.push(ownerFields.owner_ldap_name);
  } else {
    const currentTargets = Array.isArray(service.owner_targets) ? service.owner_targets : [];
    const hasOwner = currentTargets.length > 0 || !!(service.owner_id || service.owner_group_id || service.owner_ldap_dn);
    if (!hasOwner) {
      return res.status(400).json({ error: 'At least one owner is required' });
    }
  }

  if (req.body.user_targets !== undefined) {
    const userTargets = normalizeOwnerTargets(req.body.user_targets);
    const idx = sets.findIndex((s) => s.startsWith('user_targets='));
    if (idx >= 0) {
      vals[idx] = JSON.stringify(userTargets);
    } else {
      sets.push(`user_targets=$${i++}`);
      vals.push(JSON.stringify(userTargets));
    }
  }
  if (sets.length===0) return res.status(400).json({ error: 'Nessun campo' });
  sets.push(`updated_at=$${i++}`); vals.push(new Date()); vals.push(req.params.id);
  await query(`UPDATE services SET ${sets.join(',')} WHERE id=$${i}`, vals);
  await auditService.log(req.user.id, req.user.username, 'service:update', 'service', req.params.id, null, req.ip, req.get('user-agent'));
  res.json({ message: 'Servizio aggiornato' });
});

// ─── PATCH /api/services/:id/status ──────────────────────────────────────────
router.patch('/:id/status', requireOperator, [
  body('status').isIn(STATUSES),
  body('reason').optional().isString(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  await query(`UPDATE services SET status=$1, updated_at=NOW() WHERE id=$2`, [req.body.status, req.params.id]);
  await query(
    `INSERT INTO status_history (entity_type, entity_id, status, changed_by, reason) VALUES ('service',$1,$2,$3,$4)`,
    [req.params.id, req.body.status, req.user.username, req.body.reason||null]
  );
  wsService.broadcast({ type: 'service_status_changed', serviceId: req.params.id, status: req.body.status });
  res.json({ message: 'Stato aggiornato' });
});

// ─── DELETE /api/services/:id ─────────────────────────────────────────────────
router.delete('/:id', requireAdmin, async (req, res) => {
  await query('UPDATE services SET is_active=false, updated_at=NOW() WHERE id=$1', [req.params.id]);
  await auditService.log(req.user.id, req.user.username, 'service:delete', 'service', req.params.id, null, req.ip, req.get('user-agent'));
  res.json({ message: 'Servizio disattivato' });
});

// ─── GET /api/services/:id/maintenance ──────────────────────────────────────
router.get('/:id/maintenance', async (req, res) => {
  const rows = await getMany(
    `SELECT m.id, m.title, m.type, m.status, m.impact_level, m.scheduled_start, m.scheduled_end
     FROM maintenance_windows m
     JOIN maintenance_assets ma ON ma.maintenance_id=m.id
     JOIN service_assets sa ON sa.asset_id=ma.asset_id
     WHERE sa.service_id=$1
     ORDER BY m.scheduled_start DESC LIMIT 50`,
    [req.params.id]
  );
  res.json(rows);
});

// ─── GET /api/services/:id/users ────────────────────────────────────────────
router.get('/:id/users', async (req, res) => {
  const rows = await getMany(
    `WITH resolved_users AS (
       SELECT DISTINCT u.id, u.username, u.display_name, u.email, u.office, u.role, u.auth_type
       FROM services s
       JOIN LATERAL jsonb_array_elements(COALESCE(s.user_targets, '[]'::jsonb)) ut ON true
       JOIN users u ON (
         (ut->>'type' = 'user' AND (ut->>'id') ~* '^[0-9a-f-]{36}$' AND u.id = (ut->>'id')::uuid)
         OR (
           ut->>'type' = 'local_group'
           AND (ut->>'id') ~* '^[0-9a-f-]{36}$'
           AND EXISTS (
             SELECT 1 FROM user_group_members ugm
             WHERE ugm.group_id = (ut->>'id')::uuid
               AND ugm.user_id = u.id
           )
         )
       )
       WHERE s.id = $1 AND u.is_active = true
     )
     SELECT id, username, display_name, email, office, role, auth_type
     FROM resolved_users
     ORDER BY display_name NULLS LAST, username`,
    [req.params.id]
  );
  res.json(rows);
});

// ─── POST /api/services/:id/dependencies ─────────────────────────────────────
router.post('/:id/dependencies', requireOperator, [
  body('depends_on_id').isUUID(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  if (req.params.id === req.body.depends_on_id) return res.status(400).json({ error: 'Un servizio non può dipendere da se stesso' });
  await query(
    `INSERT INTO service_dependencies (service_id, depends_on_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
    [req.params.id, req.body.depends_on_id]
  );
  res.status(201).json({ message: 'Dipendenza aggiunta' });
});

// ─── DELETE /api/services/:id/dependencies/:depId ────────────────────────────
router.delete('/:id/dependencies/:depId', requireOperator, async (req, res) => {
  await query('DELETE FROM service_dependencies WHERE service_id=$1 AND depends_on_id=$2', [req.params.id, req.params.depId]);
  res.json({ message: 'Dipendenza rimossa' });
});

// ─── POST /api/services/:id/assets ───────────────────────────────────────────
router.post('/:id/assets', requireOperator, [body('asset_id').isUUID()], async (req, res) => {
  await query(`INSERT INTO service_assets (service_id, asset_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [req.params.id, req.body.asset_id]);
  res.status(201).json({ message: 'Asset collegato' });
});

router.delete('/:id/assets/:assetId', requireOperator, async (req, res) => {
  await query('DELETE FROM service_assets WHERE service_id=$1 AND asset_id=$2', [req.params.id, req.params.assetId]);
  res.json({ message: 'Asset scollegato' });
});

// ─── Subscribers ─────────────────────────────────────────────────────────────
router.post('/:id/subscribe', requireAuth, [
  body('email').optional().isEmail(),
  body('notify_maintenance').optional().isBoolean(),
  body('notify_incidents').optional().isBoolean(),
  body('notify_recovery').optional().isBoolean(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const userId = req.user.id;
  const email = req.body.email || req.user.email || null;
  try {
    await query(
      `INSERT INTO service_subscribers (service_id, user_id, email, notify_maintenance, notify_incidents, notify_recovery)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (service_id, user_id) WHERE user_id IS NOT NULL
       DO UPDATE SET notify_maintenance=$4, notify_incidents=$5, notify_recovery=$6`,
      [req.params.id, userId, email,
       req.body.notify_maintenance ?? true,
       req.body.notify_incidents ?? true,
       req.body.notify_recovery ?? true]
    );
    res.json({ message: 'Iscrizione effettuata' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id/subscribe', requireAuth, async (req, res) => {
  await query('DELETE FROM service_subscribers WHERE service_id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  res.json({ message: 'Iscrizione rimossa' });
});

router.delete('/:id/subscribers/:subId', requireAdmin, async (req, res) => {
  await query('DELETE FROM service_subscribers WHERE id=$1 AND service_id=$2', [req.params.subId, req.params.id]);
  res.json({ message: 'Iscritto rimosso' });
});

// ─── GET /api/services/:id/licenses ─────────────────────────────────────────
router.get('/:id/licenses', async (req, res) => {
  const rows = await getMany(
    `SELECT l.id, l.name, l.expiry_date, l.approval_status,
            sp.id as supplier_id, sp.company as supplier_name,
            CASE WHEN ls.service_id IS NULL THEN false ELSE true END AS assigned
     FROM licenses l
     LEFT JOIN suppliers sp ON sp.id=l.supplier_id
     LEFT JOIN license_services ls ON ls.license_id=l.id AND ls.service_id=$1
     WHERE l.is_active=true
     ORDER BY l.name`,
    [req.params.id]
  );
  res.json(rows);
});

// ─── PUT /api/services/:id/licenses ─────────────────────────────────────────
router.put('/:id/licenses', requireOperator, [
  body('license_ids').isArray(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const service = await getOne('SELECT id FROM services WHERE id=$1', [req.params.id]);
  if (!service) return res.status(404).json({ error: 'Servizio non trovato' });

  const licenseIds = Array.isArray(req.body.license_ids) ? req.body.license_ids : [];
  await query('DELETE FROM license_services WHERE service_id=$1', [req.params.id]);
  for (const lid of licenseIds) {
    await query(
      'INSERT INTO license_services (license_id, service_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [lid, req.params.id]
    );
  }

  res.json({ message: 'Licenses updated' });
});

function _slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

module.exports = router;
