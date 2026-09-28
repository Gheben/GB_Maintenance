const { Router } = require('express');
const { body, validationResult } = require('express-validator');
const { requireAuth, requireOperator, requireAdmin } = require('../middleware/authMiddleware');
const { query, getOne, getMany } = require('../db/database');
const auditService = require('../services/auditService');
const wsService = require('../services/wsService');
const ldapService = require('../services/ldapService');
const { buildServiceGraph } = require('../utils/correlationGraph');

const router = Router();
router.use(requireAuth);

const CRITICALITIES = ['critical','high','medium','low'];
const STATUSES = ['operational','degraded','partial_outage','major_outage','under_maintenance'];

function formatDateForPublicApi(value, { includeTime = false } = {}) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat('it-IT', includeTime
    ? {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }
    : {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }
  ).format(d);
}

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
  res.json({
    data: rows.map((row) => ({
      ...row,
      next_license_expiry: formatDateForPublicApi(row.next_license_expiry),
    })),
    total,
    page: parseInt(page),
    limit: parseInt(limit),
  });
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
    `SELECT s.id, s.name, s.slug, s.status AS current_status, s.part_is_relevant FROM services s
     JOIN service_dependencies sd ON sd.depends_on_id=s.id WHERE sd.service_id=$1`,
    [req.params.id]
  );
  const required_by = await getMany(
    `SELECT s.id, s.name, s.slug, s.status AS current_status, s.part_is_relevant FROM services s
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
  body('part_is_relevant').optional().isBoolean(),
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
      `INSERT INTO services (name, slug, description, criticality, owner_id, owner_type, owner_group_id, owner_ldap_dn, owner_ldap_name, owner_targets, user_targets, system_name, sla_uptime_percent, is_public, part_is_relevant)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
      [req.body.name, slug, req.body.description||null, req.body.criticality||'medium',
       ownerFields.owner_id,
       ownerFields.owner_type,
       ownerFields.owner_group_id,
      ownerFields.owner_ldap_dn,
      ownerFields.owner_ldap_name,
      JSON.stringify(ownerTargets),
      JSON.stringify(userTargets),
      req.body.system_name||null, req.body.sla_uptime_percent||99.9, req.body.is_public||false, req.body.part_is_relevant === true]
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
  try {
    const service = await getOne(
      `SELECT id, owner_id, owner_group_id, owner_ldap_dn, owner_targets
       FROM services
       WHERE id=$1`,
      [req.params.id]
    );
    if (!service) return res.status(404).json({ error: 'Servizio non trovato' });

    if (req.body.criticality !== undefined && !CRITICALITIES.includes(req.body.criticality)) {
      return res.status(400).json({ error: 'Criticality non valida' });
    }

    const hasOwnerTargets = req.body.owner_targets !== undefined;
    const ownerFieldNames = new Set(['owner_id', 'owner_type', 'owner_group_id', 'owner_ldap_dn', 'owner_ldap_name']);
    const allowed = ['name','description','criticality','owner_id','owner_type','owner_group_id','owner_ldap_dn','owner_ldap_name','owner_targets','user_targets','system_name','sla_uptime_percent','is_public','part_is_relevant','is_active'];
    const sets=[]; const vals=[]; let i=1;

    for (const f of allowed) {
      if (req.body[f] === undefined) continue;
      // owner_targets is authoritative: skip owner_* direct assignments to avoid duplicate SET clauses
      if (hasOwnerTargets && ownerFieldNames.has(f)) continue;
      sets.push(`${f}=$${i++}`);
      vals.push(['owner_targets','user_targets'].includes(f) ? JSON.stringify(req.body[f]) : req.body[f]);
    }

    if (hasOwnerTargets) {
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
  } catch (err) {
    if (err.code === '23514' || err.code === '22P02') {
      return res.status(400).json({ error: 'Dati non validi per aggiornare il servizio' });
    }
    res.status(500).json({ error: err.message });
  }
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
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '25', 10)));
  const offset = (page - 1) * limit;

  const totalRes = await query(
    `SELECT COUNT(DISTINCT m.id)::int AS total
     FROM maintenance_windows m
     JOIN maintenance_assets ma ON ma.maintenance_id = m.id
     JOIN service_assets sa ON sa.asset_id = ma.asset_id
     WHERE sa.service_id = $1`,
    [req.params.id]
  );

  const rows = await getMany(
    `SELECT DISTINCT m.id, m.title, m.type, m.status, m.impact_level,
            m.scheduled_start, m.scheduled_end, m.actual_start, m.actual_end,
            m.ticket_ref, m.reopened_at, m.reopen_reason, m.reopen_count,
            m.owner_approval_required, m.owner_approval_status,
            m.description, m.notes,
            u.id as reopened_by_user_id, u.display_name as reopened_by_user_display_name, u.email as reopened_by_user_email
     FROM maintenance_windows m
     JOIN maintenance_assets ma ON ma.maintenance_id=m.id
     JOIN service_assets sa ON sa.asset_id=ma.asset_id
     LEFT JOIN users u ON u.id=m.reopened_by
     WHERE sa.service_id=$1
     ORDER BY m.scheduled_start DESC
     LIMIT $2 OFFSET $3`,
    [req.params.id, limit, offset]
  );
  
  // Transform reopened_by_user data
  const data = rows.map(r => {
    const result = { ...r };
    if (r.reopened_by_user_id) {
      result.reopened_by_user = {
        id: r.reopened_by_user_id,
        display_name: r.reopened_by_user_display_name,
        email: r.reopened_by_user_email
      };
      delete result.reopened_by_user_id;
      delete result.reopened_by_user_display_name;
      delete result.reopened_by_user_email;
    }
    return result;
  });
  
  res.json({ data, total: totalRes.rows[0]?.total || 0, page, limit });
});

// ─── GET /api/services/:id/users ────────────────────────────────────────────
router.get('/:id/users', async (req, res) => {
  const rows = await getMany(
    `WITH target_entries AS (
       SELECT
         COALESCE(ut->>'type', '') AS target_type,
         CASE WHEN (ut->>'id') ~* '^[0-9a-f-]{36}$' THEN (ut->>'id')::uuid ELSE NULL END AS target_uuid,
         NULLIF(BTRIM(COALESCE(ut->>'dn', ut->>'id', '')), '') AS target_dn
       FROM services s
       JOIN LATERAL jsonb_array_elements(COALESCE(s.user_targets, '[]'::jsonb)) ut ON true
       WHERE s.id = $1
     ),
     resolved_users AS (
       SELECT DISTINCT
         u.id::text AS id,
         u.username,
         u.display_name,
         u.email,
         u.office,
         u.role,
         u.auth_type
       FROM target_entries t
       JOIN users u
         ON t.target_type = 'user'
        AND t.target_uuid IS NOT NULL
        AND u.id = t.target_uuid
       WHERE u.is_active = true

       UNION

       SELECT DISTINCT
         u.id::text AS id,
         u.username,
         u.display_name,
         u.email,
         u.office,
         u.role,
         u.auth_type
       FROM target_entries t
       JOIN user_group_members ugm
         ON t.target_type = 'local_group'
        AND t.target_uuid IS NOT NULL
        AND ugm.group_id = t.target_uuid
       JOIN users u ON u.id = ugm.user_id
       WHERE u.is_active = true

       UNION

       SELECT DISTINCT
         COALESCE(lc.dn, lc.username, lc.upn)::text AS id,
         lc.username,
         lc.display_name,
         lc.email,
         lc.office,
         'viewer'::text AS role,
         'ldap'::text AS auth_type
       FROM target_entries t
       JOIN ldap_users_cache lc
         ON t.target_type = 'ldap_user'
        AND t.target_dn IS NOT NULL
        AND (
          LOWER(COALESCE(lc.dn, '')) = LOWER(t.target_dn)
          OR LOWER(COALESCE(lc.username, '')) = LOWER(t.target_dn)
          OR LOWER(COALESCE(lc.upn, '')) = LOWER(t.target_dn)
        )

       UNION

       SELECT DISTINCT
         COALESCE(lc.dn, lc.username, lc.upn)::text AS id,
         lc.username,
         lc.display_name,
         lc.email,
         lc.office,
         'viewer'::text AS role,
         'ldap'::text AS auth_type
       FROM target_entries t
       JOIN ldap_users_cache lc
         ON t.target_type = 'ldap_group'
        AND t.target_dn IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(COALESCE(lc.source_payload->'memberOf', lc.source_payload->'memberof', '[]'::jsonb)) m(dn)
          WHERE LOWER(m.dn) = LOWER(t.target_dn)
             OR SPLIT_PART(LOWER(m.dn), ',', 1) = SPLIT_PART(LOWER(t.target_dn), ',', 1)
        )

       UNION

       SELECT DISTINCT
         COALESCE(lc.dn, lc.username, lc.upn)::text AS id,
         lc.username,
         lc.display_name,
         lc.email,
         lc.office,
         'viewer'::text AS role,
         'ldap'::text AS auth_type
       FROM target_entries t
       JOIN ldap_group_mappings lgm
         ON t.target_type = 'ldap_group'
        AND t.target_uuid IS NOT NULL
        AND (lgm.local_group_id = t.target_uuid OR lgm.id = t.target_uuid)
       JOIN ldap_users_cache lc
         ON EXISTS (
           SELECT 1
           FROM jsonb_array_elements_text(COALESCE(lc.source_payload->'memberOf', lc.source_payload->'memberof', '[]'::jsonb)) m(dn)
           WHERE LOWER(m.dn) = LOWER(lgm.ldap_group_dn)
              OR SPLIT_PART(LOWER(m.dn), ',', 1) = SPLIT_PART(LOWER(lgm.ldap_group_dn), ',', 1)
         )
       WHERE lgm.ldap_group_dn IS NOT NULL AND BTRIM(lgm.ldap_group_dn) <> ''

       UNION

       SELECT DISTINCT
         COALESCE(lc.dn, lc.username, lc.upn)::text AS id,
         lc.username,
         lc.display_name,
         lc.email,
         lc.office,
         'viewer'::text AS role,
         'ldap'::text AS auth_type
       FROM target_entries t
       JOIN ldap_group_mappings lgm
         ON t.target_type = 'local_group'
        AND t.target_uuid IS NOT NULL
        AND lgm.local_group_id = t.target_uuid
       JOIN ldap_users_cache lc
         ON EXISTS (
           SELECT 1
           FROM jsonb_array_elements_text(COALESCE(lc.source_payload->'memberOf', lc.source_payload->'memberof', '[]'::jsonb)) m(dn)
           WHERE LOWER(m.dn) = LOWER(lgm.ldap_group_dn)
              OR SPLIT_PART(LOWER(m.dn), ',', 1) = SPLIT_PART(LOWER(lgm.ldap_group_dn), ',', 1)
         )
       WHERE lgm.ldap_group_dn IS NOT NULL AND BTRIM(lgm.ldap_group_dn) <> ''
     )
     SELECT DISTINCT id, username, display_name, email, office, role, auth_type
     FROM resolved_users
     ORDER BY display_name NULLS LAST, username`,
    [req.params.id]
  );

  const ldapGroupRows = await getMany(
    `WITH target_entries AS (
       SELECT
         COALESCE(ut->>'type', '') AS target_type,
         CASE WHEN (ut->>'id') ~* '^[0-9a-f-]{36}$' THEN (ut->>'id')::uuid ELSE NULL END AS target_uuid,
         NULLIF(BTRIM(COALESCE(ut->>'dn', ut->>'id', '')), '') AS target_dn
       FROM services s
       JOIN LATERAL jsonb_array_elements(COALESCE(s.user_targets, '[]'::jsonb)) ut ON true
       WHERE s.id = $1
     )
     SELECT DISTINCT target_dn AS ldap_group_dn
     FROM target_entries
     WHERE target_type = 'ldap_group'
       AND target_dn IS NOT NULL
       AND target_dn !~* '^[0-9a-f-]{36}$'

     UNION

     SELECT DISTINCT lgm.ldap_group_dn
     FROM target_entries t
     JOIN ldap_group_mappings lgm
       ON t.target_type = 'ldap_group'
      AND t.target_uuid IS NOT NULL
      AND (lgm.local_group_id = t.target_uuid OR lgm.id = t.target_uuid)
     WHERE lgm.ldap_group_dn IS NOT NULL AND BTRIM(lgm.ldap_group_dn) <> ''

     UNION

     SELECT DISTINCT lgm.ldap_group_dn
     FROM target_entries t
     JOIN ldap_group_mappings lgm
       ON t.target_type = 'local_group'
      AND t.target_uuid IS NOT NULL
      AND lgm.local_group_id = t.target_uuid
     WHERE lgm.ldap_group_dn IS NOT NULL AND BTRIM(lgm.ldap_group_dn) <> ''`,
    [req.params.id]
  );

  let ldapExpanded = [];
  if (ldapGroupRows.length > 0) {
    try {
      const groupDns = ldapGroupRows.map((r) => r.ldap_group_dn).filter(Boolean);
      ldapExpanded = await ldapService.listUsersInGroups(groupDns, { maxResults: 3000 });
    } catch (_) {
      ldapExpanded = [];
    }
  }

  const byKey = new Map();
  const makeKey = (u = {}) => {
    const id = String(u.id || '').trim().toLowerCase();
    const email = String(u.email || '').trim().toLowerCase();
    const username = String(u.username || '').trim().toLowerCase();
    return id || email || username;
  };

  for (const user of [...rows, ...ldapExpanded]) {
    const key = makeKey(user);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, user);
  }

  const merged = [...byKey.values()].sort((a, b) =>
    String(a.display_name || '').localeCompare(String(b.display_name || ''), undefined, { sensitivity: 'base' })
    || String(a.username || '').localeCompare(String(b.username || ''), undefined, { sensitivity: 'base' })
  );

  res.json(merged);
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
  res.json(rows.map((row) => ({
    ...row,
    expiry_date: formatDateForPublicApi(row.expiry_date),
  })));
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

// ─── Service Probes Endpoints ─────────────────────────────────────────────────

const PROBE_TYPES = ['http', 'https', 'tcp', 'icmp', 'dns', 'tls'];
const probeService = require('../services/probeService');

// ─── GET /api/services/:id/probes ────────────────────────────────────────────
router.get('/:id/probes', async (req, res) => {
  const { limit = 100 } = req.query;
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const rows = await getMany(
    `SELECT * FROM service_probe_results WHERE service_id=$1 AND probed_at >= $3 ORDER BY probed_at DESC LIMIT $2`,
    [req.params.id, parseInt(limit), thirtyDaysAgo]
  );
  res.json(rows);
});

// ─── GET /api/services/:id/probe-configs ────────────────────────────────────
router.get('/:id/probe-configs', async (req, res) => {
  const rows = await getMany(
    `SELECT id, service_id, name, probe_enabled, probe_type, probe_target,
            probe_interval_seconds, probe_timeout_seconds, expected_status_code,
            failure_threshold, recovery_threshold, pause_during_maintenance,
            dns_record_type, dns_expected_value, ssl_expiry_warning_days,
            legacy_slot, last_probed_at, next_probe_at,
            consecutive_failures, consecutive_successes, current_state,
            created_at, updated_at
     FROM service_probes
     WHERE service_id = $1
     ORDER BY legacy_slot DESC, created_at ASC`,
    [req.params.id]
  );
  res.json(rows);
});

// ─── POST /api/services/:id/probe-configs ───────────────────────────────────
router.post('/:id/probe-configs', requireOperator, [
  body('name').optional({ nullable: true }).isString().isLength({ max: 200 }),
  body('probe_enabled').optional().isBoolean(),
  body('probe_type').isIn(PROBE_TYPES),
  body('probe_target').isString().trim().isLength({ min: 1 }),
  body('probe_interval_seconds').optional().toInt().isInt({ min: 15 }),
  body('probe_timeout_seconds').optional().toInt().isInt({ min: 1, max: 60 }),
  body('expected_status_code').optional({ nullable: true }).toInt().isInt({ min: 100, max: 599 }),
  body('failure_threshold').optional().toInt().isInt({ min: 1, max: 10 }),
  body('recovery_threshold').optional().toInt().isInt({ min: 1, max: 10 }),
  body('pause_during_maintenance').optional().isBoolean(),
  body('dns_record_type').optional().isIn(['A','AAAA','CNAME','MX','TXT','NS','PTR','SRV']),
  body('dns_expected_value').optional({ nullable: true }).isString(),
  body('ssl_expiry_warning_days').optional().toInt().isInt({ min: 1, max: 365 }),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array(), error: errors.array()[0]?.msg });
    }

    const service = await getOne('SELECT id FROM services WHERE id=$1 AND is_active=true', [req.params.id]);
    if (!service) return res.status(404).json({ error: 'Service non trovato' });

    const r = await query(
      `INSERT INTO service_probes (
         service_id, name, probe_enabled, probe_type, probe_target,
         probe_interval_seconds, probe_timeout_seconds, expected_status_code,
         failure_threshold, recovery_threshold, pause_during_maintenance,
         dns_record_type, dns_expected_value, ssl_expiry_warning_days,
         next_probe_at, current_state
       ) VALUES (
         $1,$2,$3,$4,$5,
         $6,$7,$8,
         $9,$10,$11,
         $12,$13,$14,
         NOW(),'unknown'
       )
       RETURNING id`,
      [
        req.params.id,
        req.body.name || null,
        req.body.probe_enabled !== false,
        req.body.probe_type,
        req.body.probe_target,
        req.body.probe_interval_seconds || 300,
        req.body.probe_timeout_seconds || 10,
        req.body.expected_status_code ?? 200,
        req.body.failure_threshold || 2,
        req.body.recovery_threshold || 2,
        req.body.pause_during_maintenance !== false,
        req.body.dns_record_type || 'A',
        req.body.dns_expected_value || null,
        req.body.ssl_expiry_warning_days || 30,
      ]
    );
    res.status(201).json({ id: r.rows[0].id });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error creating probe config' });
  }
});

// ─── PUT /api/services/:id/probe-configs/:probeId ────────────────────────────
router.put('/:id/probe-configs/:probeId', requireOperator, async (req, res) => {
  try {
    const probe = await getOne(
      `SELECT id, legacy_slot FROM service_probes WHERE id=$1 AND service_id=$2`,
      [req.params.probeId, req.params.id]
    );
    if (!probe) return res.status(404).json({ error: 'Probe non trovata' });

    const allowed = [
      'name', 'probe_enabled', 'probe_type', 'probe_target',
      'probe_interval_seconds', 'probe_timeout_seconds', 'expected_status_code',
      'failure_threshold', 'recovery_threshold', 'pause_during_maintenance',
      'dns_record_type', 'dns_expected_value', 'ssl_expiry_warning_days'
    ];
    const sets = [];
    const vals = [];
    let i = 1;
    for (const field of allowed) {
      if (req.body[field] === undefined) continue;
      sets.push(`${field} = $${i++}`);
      vals.push(req.body[field]);
    }
    if (sets.length === 0) return res.status(400).json({ error: 'Nessun campo da aggiornare' });
    sets.push(`updated_at = NOW()`);
    vals.push(req.params.probeId, req.params.id);

    await query(`UPDATE service_probes SET ${sets.join(', ')} WHERE id = $${i++} AND service_id = $${i}`, vals);

    res.json({ message: 'Probe aggiornata' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error updating probe config' });
  }
});

// ─── DELETE /api/services/:id/probe-configs/:probeId ──────────────────────────
router.delete('/:id/probe-configs/:probeId', requireOperator, async (req, res) => {
  try {
    const probe = await getOne(
      `SELECT id, legacy_slot FROM service_probes WHERE id=$1 AND service_id=$2`,
      [req.params.probeId, req.params.id]
    );
    if (!probe) return res.status(404).json({ error: 'Probe non trovata' });
    if (probe.legacy_slot) return res.status(400).json({ error: 'La probe principale legacy non può essere eliminata' });

    await query(`DELETE FROM service_probes WHERE id=$1 AND service_id=$2`, [req.params.probeId, req.params.id]);
    res.json({ message: 'Probe eliminata' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error deleting probe config' });
  }
});

// ─── POST /api/services/:id/probe ────────────────────────────────────────────
router.post('/:id/probe', requireOperator, async (req, res) => {
  try {
    const result = await probeService.probeNowService(req.params.id);
    res.json(result);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ─── POST /api/services/:id/probe-configs/:probeId/run ────────────────────────
router.post('/:id/probe-configs/:probeId/run', requireOperator, async (req, res) => {
  try {
    const result = await probeService.probeNowByIdService(req.params.id, req.params.probeId);
    res.json(result);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ─── GET /api/services/:id/graph ──────────────────────────────────────────────
router.get('/:id/graph', async (req, res) => {
  try {
    const { depth = 1 } = req.query;
    const d = Math.max(1, Math.min(3, parseInt(depth, 10)));
    const graph = await buildServiceGraph(req.params.id, d);
    if (!graph) return res.status(404).json({ error: 'Service not found' });
    console.log(`[GRAPH] Service ${req.params.id}: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);
    res.json(graph);
  } catch (err) {
    console.error('[GRAPH] Error building service graph:', err.message);
    res.status(500).json({ error: err.message || 'Error building graph' });
  }
});

function _slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

module.exports = router;
