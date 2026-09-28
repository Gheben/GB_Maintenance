const { Router } = require('express');
const { body, param, query: qv, validationResult } = require('express-validator');
const { requireAuth, requireOperator, requireAdmin } = require('../middleware/authMiddleware');
const { query, getOne, getMany, transaction } = require('../db/database');
const auditService = require('../services/auditService');
const probeService = require('../services/probeService');
const wsService = require('../services/wsService');
const ldapService = require('../services/ldapService');
const { buildAssetGraph } = require('../utils/correlationGraph');

const router = Router();
router.use(requireAuth);

const CATEGORIES = ['application','infrastructure','database','network','hardware','api','other'];
const CRITICALITIES = ['critical','high','medium','low'];
const STATUSES = ['operational','degraded','partial_outage','major_outage','under_maintenance'];

const PROBE_TYPES = ['http','https','tcp','icmp','dns','tls'];

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

async function _syncLegacyProbeConfig(assetId) {
  const asset = await getOne(
    `SELECT probe_enabled, probe_type, probe_url, probe_interval_seconds,
            probe_timeout_seconds, expected_status_code,
            failure_threshold, recovery_threshold, pause_during_maintenance,
            dns_record_type, dns_expected_value, ssl_expiry_warning_days, status
     FROM assets
     WHERE id = $1`,
    [assetId]
  );
  if (!asset) return;

  const hasConfig = !!(asset.probe_type && asset.probe_url && String(asset.probe_url).trim().length > 0);
  if (!hasConfig) {
    await query(
      `UPDATE asset_probes
       SET probe_enabled = false,
           updated_at = NOW()
       WHERE asset_id = $1 AND legacy_slot = true`,
      [assetId]
    );
    return;
  }

  const state = asset.status === 'major_outage' ? 'major_outage' : (asset.status === 'operational' ? 'operational' : 'unknown');
  await query(
    `INSERT INTO asset_probes (
       asset_id, name, probe_enabled, probe_type, probe_target,
       probe_interval_seconds, probe_timeout_seconds, expected_status_code,
       failure_threshold, recovery_threshold, pause_during_maintenance,
       dns_record_type, dns_expected_value, ssl_expiry_warning_days,
       legacy_slot, next_probe_at, current_state, updated_at
     )
     VALUES (
       $1, 'Default probe', $2, $3, $4,
       $5, $6, $7,
       $8, $9, $10,
       $11, $12, $13,
       true, NOW(), $14, NOW()
     )
     ON CONFLICT (asset_id) WHERE legacy_slot = true
     DO UPDATE SET
       probe_enabled = EXCLUDED.probe_enabled,
       probe_type = EXCLUDED.probe_type,
       probe_target = EXCLUDED.probe_target,
       probe_interval_seconds = EXCLUDED.probe_interval_seconds,
       probe_timeout_seconds = EXCLUDED.probe_timeout_seconds,
       expected_status_code = EXCLUDED.expected_status_code,
       failure_threshold = EXCLUDED.failure_threshold,
       recovery_threshold = EXCLUDED.recovery_threshold,
       pause_during_maintenance = EXCLUDED.pause_during_maintenance,
       dns_record_type = EXCLUDED.dns_record_type,
       dns_expected_value = EXCLUDED.dns_expected_value,
       ssl_expiry_warning_days = EXCLUDED.ssl_expiry_warning_days,
       updated_at = NOW()`,
    [
      assetId,
      !!asset.probe_enabled,
      asset.probe_type,
      asset.probe_url,
      asset.probe_interval_seconds || 300,
      asset.probe_timeout_seconds || 10,
      asset.expected_status_code || 200,
      asset.failure_threshold || 2,
      asset.recovery_threshold || 2,
      asset.pause_during_maintenance !== false,
      asset.dns_record_type || 'A',
      asset.dns_expected_value || null,
      asset.ssl_expiry_warning_days || 30,
      state,
    ]
  );
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
       COALESCE(lic.license_count, 0) as license_count,
       COALESCE(lic.expired_license_count, 0) as expired_license_count,
       lic.next_license_expiry,
       prim.primary_license_name,
       prim.primary_supplier_name,
       COALESCE(NULLIF(a.owner_targets->0->>'name',''),
         CASE a.owner_type
           WHEN 'local_group' THEN lg.name
           WHEN 'ldap_user'   THEN a.owner_ldap_name
           WHEN 'ldap_group'  THEN a.owner_ldap_name
           ELSE u.display_name
         END, '') as owner_label,
       COALESCE(jsonb_array_length(a.owner_targets), 0)::int as owner_count,
       COALESCE(jsonb_array_length(a.user_targets), 0)::int as user_count,
       lp.latest_probe_success,
       lp.latest_probe_status_code,
       lp.latest_probe_error_message,
       lp.latest_probe_probed_at,
       lp.latest_probe_ssl_cert_expiry,
       lp.latest_probe_dns_response,
       lp.latest_probe_type,
       lp.latest_probe_state,
       lp.latest_probe_name,
       COALESCE(aps.probe_enabled_count, 0) AS probe_enabled_count,
       COALESCE(aps.failing_probe_count, 0) AS failing_probe_count,
       COALESCE(aps.primary_probe_name, lp.latest_probe_name) AS primary_probe_name
     FROM assets a
     LEFT JOIN users u ON u.id=a.owner_id
     LEFT JOIN local_groups lg ON lg.id=a.owner_group_id
     LEFT JOIN LATERAL (
       SELECT
         COUNT(*)::int AS license_count,
         COUNT(*) FILTER (WHERE l.expiry_date IS NOT NULL AND l.expiry_date < CURRENT_DATE)::int AS expired_license_count,
         MIN(l.expiry_date) FILTER (WHERE l.expiry_date IS NOT NULL AND l.expiry_date >= CURRENT_DATE) AS next_license_expiry
       FROM license_assets la
       JOIN licenses l ON l.id = la.license_id
       WHERE la.asset_id = a.id AND l.is_active = true
     ) lic ON TRUE
     LEFT JOIN LATERAL (
       SELECT
         l.name AS primary_license_name,
         s.company AS primary_supplier_name
       FROM license_assets la
       JOIN licenses l ON l.id = la.license_id
       LEFT JOIN suppliers s ON s.id = l.supplier_id
       WHERE la.asset_id = a.id AND l.is_active = true
       ORDER BY l.expiry_date NULLS LAST, l.name
       LIMIT 1
     ) prim ON TRUE
     LEFT JOIN LATERAL (
      SELECT pr.success AS latest_probe_success,
        pr.status_code AS latest_probe_status_code,
        pr.error_message AS latest_probe_error_message,
        pr.probed_at AS latest_probe_probed_at,
        pr.ssl_cert_expiry AS latest_probe_ssl_cert_expiry,
        pr.dns_response AS latest_probe_dns_response,
        ap.probe_type AS latest_probe_type,
        ap.current_state AS latest_probe_state,
        ap.name AS latest_probe_name
       FROM probe_results pr
      LEFT JOIN asset_probes ap ON ap.id = pr.probe_id
       WHERE pr.asset_id = a.id
       ORDER BY pr.probed_at DESC
       LIMIT 1
         ) lp ON TRUE
         LEFT JOIN LATERAL (
      SELECT COUNT(*) FILTER (WHERE ap.probe_enabled = true)::int AS probe_enabled_count,
        COUNT(*) FILTER (WHERE ap.probe_enabled = true AND ap.current_state = 'major_outage')::int AS failing_probe_count,
        (ARRAY_AGG(ap.name ORDER BY ap.legacy_slot DESC) FILTER (WHERE ap.probe_enabled = true))[1] AS primary_probe_name
      FROM asset_probes ap
      WHERE ap.asset_id = a.id
         ) aps ON TRUE
     ${where} ORDER BY a.name LIMIT $${i++} OFFSET $${i}`,
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
           WHEN 'ldap_user'   THEN a.owner_ldap_name
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
  if (!asset) return res.status(404).json({ error: 'Asset not found' });

  // Dependencies (what this asset depends on)
  const dependsOn = await getMany(
    `SELECT a2.id, a2.name, a2.category, a2.status, a2.criticality, a2.part_is_relevant
     FROM asset_dependencies ad JOIN assets a2 ON a2.id=ad.depends_on_id
     WHERE ad.asset_id=$1`,
    [req.params.id]
  );
  // Required by (who depends on this asset)
  const requiredBy = await getMany(
    `SELECT a2.id, a2.name, a2.category, a2.status, a2.criticality, a2.part_is_relevant
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
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const rows = await getMany(
    `SELECT * FROM probe_results WHERE asset_id=$1 AND probed_at >= $3 ORDER BY probed_at DESC LIMIT $2`,
    [req.params.id, parseInt(limit), thirtyDaysAgo]
  );
  res.json(rows);
});

// ─── GET /api/assets/:id/probe-configs ───────────────────────────────────────
router.get('/:id/probe-configs', async (req, res) => {
  const rows = await getMany(
    `SELECT id, asset_id, name, probe_enabled, probe_type, probe_target,
            probe_interval_seconds, probe_timeout_seconds, expected_status_code,
            failure_threshold, recovery_threshold, pause_during_maintenance,
            dns_record_type, dns_expected_value, ssl_expiry_warning_days,
            legacy_slot, last_probed_at, next_probe_at,
            consecutive_failures, consecutive_successes, current_state,
            created_at, updated_at
     FROM asset_probes
     WHERE asset_id = $1
     ORDER BY legacy_slot DESC, created_at ASC`,
    [req.params.id]
  );
  res.json(rows);
});

// ─── POST /api/assets/:id/probe-configs ──────────────────────────────────────
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
      console.error('[PROBE] Validation errors for body:', JSON.stringify(req.body), 'errors:', JSON.stringify(errors.array()));
      return res.status(400).json({ errors: errors.array(), error: errors.array()[0]?.msg });
    }

    const asset = await getOne('SELECT id FROM assets WHERE id=$1 AND is_active=true', [req.params.id]);
    if (!asset) return res.status(404).json({ error: 'Asset not found' });

    const r = await query(
      `INSERT INTO asset_probes (
         asset_id, name, probe_enabled, probe_type, probe_target,
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
    console.error('[PROBE] Error creating probe:', err.message);
    res.status(500).json({ error: err.message || 'Error creating probe config' });
  }
});

// ─── PUT /api/assets/:id/probe-configs/:probeId ──────────────────────────────
router.put('/:id/probe-configs/:probeId', requireOperator, async (req, res) => {
  try {
    const probe = await getOne(
      `SELECT id, legacy_slot FROM asset_probes WHERE id=$1 AND asset_id=$2`,
      [req.params.probeId, req.params.id]
    );
    if (!probe) return res.status(404).json({ error: 'Probe not found' });

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
    if (sets.length === 0) return res.status(400).json({ error: 'No fields to update' });
    sets.push(`updated_at = NOW()`);
    vals.push(req.params.probeId, req.params.id);

    await query(`UPDATE asset_probes SET ${sets.join(', ')} WHERE id = $${i++} AND asset_id = $${i}`, vals);

    if (probe.legacy_slot) {
      // Keep old asset-level probe fields in sync for frontend/API compatibility.
      const p = await getOne(
        `SELECT probe_enabled, probe_type, probe_target, probe_interval_seconds,
                probe_timeout_seconds, expected_status_code,
                failure_threshold, recovery_threshold, pause_during_maintenance,
                dns_record_type, dns_expected_value, ssl_expiry_warning_days
         FROM asset_probes
         WHERE id = $1`,
        [req.params.probeId]
      );
      await query(
        `UPDATE assets
         SET probe_enabled = $1,
             probe_type = $2,
             probe_url = $3,
             probe_interval_seconds = $4,
             probe_timeout_seconds = $5,
             expected_status_code = $6,
             failure_threshold = $7,
             recovery_threshold = $8,
             pause_during_maintenance = $9,
             dns_record_type = $10,
             dns_expected_value = $11,
             ssl_expiry_warning_days = $12,
             updated_at = NOW()
         WHERE id = $13`,
        [
          p.probe_enabled,
          p.probe_type,
          p.probe_target,
          p.probe_interval_seconds,
          p.probe_timeout_seconds,
          p.expected_status_code,
          p.failure_threshold,
          p.recovery_threshold,
          p.pause_during_maintenance,
          p.dns_record_type,
          p.dns_expected_value,
          p.ssl_expiry_warning_days,
          req.params.id,
        ]
      );
    }

    res.json({ message: 'Probe updated' });
  } catch (err) {
    console.error('[PROBE] Error updating probe:', err.message);
    res.status(500).json({ error: err.message || 'Error updating probe config' });
  }
});

// ─── DELETE /api/assets/:id/probe-configs/:probeId ───────────────────────────
router.delete('/:id/probe-configs/:probeId', requireOperator, async (req, res) => {
  try {
    const probe = await getOne(
      `SELECT id, legacy_slot FROM asset_probes WHERE id=$1 AND asset_id=$2`,
      [req.params.probeId, req.params.id]
    );
    if (!probe) return res.status(404).json({ error: 'Probe not found' });
    if (probe.legacy_slot) return res.status(400).json({ error: 'The legacy primary probe cannot be deleted' });

    await query(`DELETE FROM asset_probes WHERE id=$1 AND asset_id=$2`, [req.params.probeId, req.params.id]);
    res.json({ message: 'Probe deleted' });
  } catch (err) {
    console.error('[PROBE] Error deleting probe:', err.message);
    res.status(500).json({ error: err.message || 'Error deleting probe config' });
  }
});

// ─── POST /api/assets/:id/probe ───────────────────────────────────────────────
router.post('/:id/probe', requireOperator, async (req, res) => {
  try {
    const result = await probeService.probeNow(req.params.id);
    res.json(result);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ─── POST /api/assets/:id/probe-configs/:probeId/run ───────────────────────────
router.post('/:id/probe-configs/:probeId/run', requireOperator, async (req, res) => {
  try {
    const result = await probeService.probeNowById(req.params.id, req.params.probeId);
    res.json(result);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ─── GET /api/assets/:id/maintenance ─────────────────────────────────────────
router.get('/:id/maintenance', async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '25', 10)));
  const offset = (page - 1) * limit;

  const totalRes = await query(
    `SELECT COUNT(*)::int AS total
     FROM maintenance_windows mw
     JOIN maintenance_assets ma ON ma.maintenance_id = mw.id
     WHERE ma.asset_id = $1`,
    [req.params.id]
  );

  const rows = await getMany(
    `SELECT mw.id, mw.title, mw.type, mw.status, mw.scheduled_start, mw.scheduled_end,
            mw.actual_start, mw.actual_end,
            mw.impact_level, mw.ticket_ref,
            mw.reopened_at, mw.reopen_reason, mw.reopen_count,
            mw.owner_approval_required, mw.owner_approval_status,
            mw.description, mw.notes,
            u.id as reopened_by_user_id, u.display_name as reopened_by_user_display_name, u.email as reopened_by_user_email
     FROM maintenance_windows mw
     JOIN maintenance_assets ma ON ma.maintenance_id=mw.id
     LEFT JOIN users u ON u.id=mw.reopened_by
     WHERE ma.asset_id=$1
     ORDER BY mw.scheduled_start DESC
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

// ─── GET /api/assets/:id/users ───────────────────────────────────────────────
router.get('/:id/users', async (req, res) => {
  const rows = await getMany(
    `WITH target_entries AS (
       SELECT
         COALESCE(ut->>'type', '') AS target_type,
         CASE WHEN (ut->>'id') ~* '^[0-9a-f-]{36}$' THEN (ut->>'id')::uuid ELSE NULL END AS target_uuid,
         NULLIF(BTRIM(COALESCE(ut->>'dn', ut->>'id', '')), '') AS target_dn
       FROM assets a
       JOIN LATERAL jsonb_array_elements(COALESCE(a.user_targets, '[]'::jsonb)) ut ON true
       WHERE a.id = $1
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
       FROM assets a
       JOIN LATERAL jsonb_array_elements(COALESCE(a.user_targets, '[]'::jsonb)) ut ON true
       WHERE a.id = $1
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

// ─── GET /api/assets/:id/licenses ───────────────────────────────────────────
router.get('/:id/licenses', async (req, res) => {
  const rows = await getMany(
    `SELECT l.id, l.name, l.expiry_date, l.approval_status,
            s.id as supplier_id, s.company as supplier_name,
            CASE WHEN la.asset_id IS NULL THEN false ELSE true END AS assigned
     FROM licenses l
     LEFT JOIN suppliers s ON s.id=l.supplier_id
     LEFT JOIN license_assets la ON la.license_id=l.id AND la.asset_id=$1
     WHERE l.is_active=true
     ORDER BY l.name`,
    [req.params.id]
  );
  res.json(rows.map((row) => ({
    ...row,
    expiry_date: formatDateForPublicApi(row.expiry_date),
  })));
});

// ─── PUT /api/assets/:id/licenses ───────────────────────────────────────────
router.put('/:id/licenses', requireOperator, [
  body('license_ids').isArray(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const asset = await getOne('SELECT id FROM assets WHERE id=$1', [req.params.id]);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });

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
  body('owner_type').optional().isIn(['user','local_group','ldap_user','ldap_group']),
  body('owner_group_id').optional({ nullable: true }).isUUID(),
  body('owner_ldap_dn').optional({ nullable: true }).isString(),
  body('owner_ldap_name').optional({ nullable: true }).isString().trim(),
  body('owner_targets').optional().isArray(),
  body('user_targets').optional().isArray(),
  body('probe_enabled').optional().isBoolean(),
  body('probe_type').optional().isIn(PROBE_TYPES),
  body('probe_url').optional().isString(),
  body('probe_interval_seconds').optional().isInt({ min: 30 }),
  body('probe_timeout_seconds').optional().isInt({ min: 1, max: 60 }),
  body('expected_status_code').optional().isInt({ min: 100, max: 599 }),
  body('failure_threshold').optional().isInt({ min: 1, max: 10 }),
  body('recovery_threshold').optional().isInt({ min: 1, max: 10 }),
  body('pause_during_maintenance').optional().isBoolean(),
  body('dns_record_type').optional().isIn(['A','AAAA','CNAME','MX','TXT','NS','PTR','SRV']),
  body('dns_expected_value').optional({ nullable: true }).isString(),
  body('ssl_expiry_warning_days').optional().isInt({ min: 1, max: 365 }),
  body('tags').optional().isArray(),
  body('metadata').optional().isObject(),
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
      `INSERT INTO assets (name, slug, category, criticality, description, owner_id, owner_type, owner_group_id, owner_ldap_dn, owner_ldap_name,
         owner_targets, user_targets, probe_enabled, probe_type, probe_url, probe_interval_seconds, probe_timeout_seconds,
         expected_status_code, failure_threshold, recovery_threshold, pause_during_maintenance,
         dns_record_type, dns_expected_value, ssl_expiry_warning_days, tags, metadata, part_is_relevant)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27) RETURNING id`,
      [
        req.body.name, slug,
        req.body.category, req.body.criticality || 'medium',
        req.body.description || null,
        ownerFields.owner_id, ownerFields.owner_type, ownerFields.owner_group_id,
        ownerFields.owner_ldap_dn, ownerFields.owner_ldap_name,
        JSON.stringify(ownerTargets), JSON.stringify(userTargets),
        req.body.probe_enabled || false, req.body.probe_type || null,
        req.body.probe_url || null, req.body.probe_interval_seconds || 300,
        req.body.probe_timeout_seconds || 10, req.body.expected_status_code || 200,
        req.body.failure_threshold || 2, req.body.recovery_threshold || 2,
        req.body.pause_during_maintenance !== undefined ? req.body.pause_during_maintenance : true,
        req.body.dns_record_type || 'A', req.body.dns_expected_value || null,
        req.body.ssl_expiry_warning_days || 30,
        JSON.stringify(req.body.tags || []), JSON.stringify(req.body.metadata || {}),
        req.body.part_is_relevant === true
      ]
    );
    const id = result.rows[0].id;
    // Record initial status
    await query(`INSERT INTO status_history (entity_type, entity_id, status, changed_by) VALUES ('asset',$1,'operational',$2)`,
      [id, req.user.username]);
    await _syncLegacyProbeConfig(id);
    await auditService.log(req.user.id, req.user.username, 'asset:create', 'asset', id, `name=${req.body.name}`, req.ip, req.get('user-agent'));
    res.status(201).json({ id });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Slug already in use, change the name' });
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/assets/:id ──────────────────────────────────────────────────────
router.put('/:id', requireOperator, async (req, res) => {
  const asset = await getOne(
    `SELECT id, owner_id, owner_group_id, owner_ldap_dn, owner_targets
     FROM assets
     WHERE id=$1`,
    [req.params.id]
  );
  if (!asset) return res.status(404).json({ error: 'Asset not found' });

  const allowed = ['name','category','criticality','description','owner_id','owner_type',
    'owner_group_id','owner_ldap_dn','owner_ldap_name','probe_enabled',
    'owner_targets','user_targets','probe_type','probe_url','probe_interval_seconds','probe_timeout_seconds',
    'expected_status_code','failure_threshold','recovery_threshold','pause_during_maintenance',
    'dns_record_type','dns_expected_value','ssl_expiry_warning_days',
    'tags','metadata','is_active','part_is_relevant'];
  const sets = []; const vals = []; let i = 1;
  const ownerManagedFields = new Set(['owner_id', 'owner_type', 'owner_group_id', 'owner_ldap_dn', 'owner_ldap_name']);
  for (const field of allowed) {
    if (req.body.owner_targets !== undefined && ownerManagedFields.has(field)) continue;
    if (req.body[field] !== undefined) {
      sets.push(`${field}=$${i++}`);
      if (['tags','metadata','owner_targets','user_targets'].includes(field)) vals.push(JSON.stringify(req.body[field]));
      else vals.push(req.body[field]);
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
    const currentTargets = Array.isArray(asset.owner_targets) ? asset.owner_targets : [];
    const hasOwner = currentTargets.length > 0 || !!(asset.owner_id || asset.owner_group_id || asset.owner_ldap_dn);
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
  if (sets.length === 0) return res.status(400).json({ error: 'No fields to update' });
  sets.push(`updated_at=$${i++}`); vals.push(new Date()); vals.push(req.params.id);
  await query(`UPDATE assets SET ${sets.join(',')} WHERE id=$${i}`, vals);
  await _syncLegacyProbeConfig(req.params.id);
  await auditService.log(req.user.id, req.user.username, 'asset:update', 'asset', req.params.id, null, req.ip, req.get('user-agent'));
  res.json({ message: 'Asset updated' });
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
  res.json({ message: 'Status updated' });
});

// ─── DELETE /api/assets/:id ───────────────────────────────────────────────────
router.delete('/:id', requireAdmin, async (req, res) => {
  await query('UPDATE assets SET is_active=false, updated_at=NOW() WHERE id=$1', [req.params.id]);
  await auditService.log(req.user.id, req.user.username, 'asset:delete', 'asset', req.params.id, null, req.ip, req.get('user-agent'));
  res.json({ message: 'Asset deactivated' });
});

// ─── POST /api/assets/:id/dependencies ───────────────────────────────────────
router.post('/:id/dependencies', requireOperator, [
  body('depends_on_id').isUUID(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  if (req.params.id === req.body.depends_on_id) return res.status(400).json({ error: 'An asset cannot depend on itself' });

  await query(
    `INSERT INTO asset_dependencies (asset_id, depends_on_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
    [req.params.id, req.body.depends_on_id]
  );
  res.status(201).json({ message: 'Dependency added' });
});

// ─── DELETE /api/assets/:id/dependencies/:depId ───────────────────────────────
router.delete('/:id/dependencies/:depId', requireOperator, async (req, res) => {
  await query('DELETE FROM asset_dependencies WHERE asset_id=$1 AND depends_on_id=$2', [req.params.id, req.params.depId]);
  res.json({ message: 'Dependency removed' });
});

// ─── GET /api/assets/:id/graph ───────────────────────────────────────────────
router.get('/:id/graph', async (req, res) => {
  try {
    const { depth = 1 } = req.query;
    const d = Math.max(1, Math.min(3, parseInt(depth, 10)));
    const graph = await buildAssetGraph(req.params.id, d);
    if (!graph) return res.status(404).json({ error: 'Asset not found' });
    console.log(`[GRAPH] Asset ${req.params.id}: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);
    res.json(graph);
  } catch (err) {
    console.error('[GRAPH] Error building asset graph:', err.message);
    res.status(500).json({ error: err.message || 'Error building graph' });
  }
});

function _slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

module.exports = router;
