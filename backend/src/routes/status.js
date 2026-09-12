const { Router } = require('express');
const { getMany, getOne, query } = require('../db/database');
const { requireAuth } = require('../middleware/authMiddleware');

const router = Router();

async function computeInvolvedUsersRows(maintenanceIds) {
  if (!Array.isArray(maintenanceIds) || maintenanceIds.length === 0) return [];
  return getMany(
    `WITH related_services AS (
       SELECT maintenance_id, service_id
       FROM maintenance_services
       WHERE maintenance_id = ANY($1::uuid[])
       UNION
       SELECT ma.maintenance_id, sa.service_id
       FROM maintenance_assets ma
       JOIN service_assets sa ON sa.asset_id=ma.asset_id
       WHERE ma.maintenance_id = ANY($1::uuid[])
     ), scope_assets AS (
       SELECT maintenance_id, asset_id
       FROM maintenance_assets
       WHERE maintenance_id = ANY($1::uuid[])
       UNION
       SELECT rs.maintenance_id, sa.asset_id
       FROM related_services rs
       JOIN service_assets sa ON sa.service_id=rs.service_id
     )
     -- Users in directly selected and related asset user_targets
     SELECT DISTINCT mwa.maintenance_id,
            COALESCE(u.display_name, u.username) AS name, u.id AS user_id, u.office
     FROM scope_assets mwa
     JOIN assets a ON a.id = mwa.asset_id
     JOIN LATERAL jsonb_array_elements(COALESCE(a.user_targets, '[]'::jsonb)) ot ON true
         JOIN users u ON (ot->>'id') ~* '^[0-9a-f-]{36}$' AND u.id = (ot->>'id')::uuid
     WHERE mwa.maintenance_id = ANY($1::uuid[])
       AND ot->>'type' = 'user'
       AND u.is_active = true
     UNION
    -- Local group members in directly selected and related asset user_targets
     SELECT DISTINCT mwa.maintenance_id,
            COALESCE(u.display_name, u.username) AS name, u.id AS user_id, u.office
    FROM scope_assets mwa
     JOIN assets a ON a.id = mwa.asset_id
     JOIN LATERAL jsonb_array_elements(COALESCE(a.user_targets, '[]'::jsonb)) ot ON true
    JOIN user_group_members ugm ON (ot->>'id') ~* '^[0-9a-f-]{36}$' AND ugm.group_id = (ot->>'id')::uuid
     JOIN users u ON u.id = ugm.user_id
     WHERE mwa.maintenance_id = ANY($1::uuid[])
       AND ot->>'type' = 'local_group'
       AND (ot->>'id') ~* '^[0-9a-f-]{36}$'
       AND u.is_active = true
     UNION
     -- Direct users in service.user_targets linked via maintenance_assets → service_assets
     SELECT DISTINCT mwa.maintenance_id,
            COALESCE(u.display_name, u.username) AS name, u.id AS user_id, u.office
     FROM maintenance_assets mwa
     JOIN service_assets sa ON sa.asset_id = mwa.asset_id
     JOIN services sv ON sv.id = sa.service_id
     JOIN LATERAL jsonb_array_elements(COALESCE(sv.user_targets, '[]'::jsonb)) ot ON true
    JOIN users u ON (ot->>'id') ~* '^[0-9a-f-]{36}$' AND u.id = (ot->>'id')::uuid
     WHERE mwa.maintenance_id = ANY($1::uuid[])
       AND ot->>'type' = 'user'
       AND u.is_active = true
     UNION
     -- Local group members in service.user_targets linked via maintenance_assets → service_assets
     SELECT DISTINCT mwa.maintenance_id,
            COALESCE(u.display_name, u.username) AS name, u.id AS user_id, u.office
     FROM maintenance_assets mwa
     JOIN service_assets sa ON sa.asset_id = mwa.asset_id
     JOIN services sv ON sv.id = sa.service_id
     JOIN LATERAL jsonb_array_elements(COALESCE(sv.user_targets, '[]'::jsonb)) ot ON true
    JOIN user_group_members ugm ON (ot->>'id') ~* '^[0-9a-f-]{36}$' AND ugm.group_id = (ot->>'id')::uuid
     JOIN users u ON u.id = ugm.user_id
     WHERE mwa.maintenance_id = ANY($1::uuid[])
       AND ot->>'type' = 'local_group'
       AND (ot->>'id') ~* '^[0-9a-f-]{36}$'
       AND u.is_active = true
     UNION
     -- Direct users in service.user_targets linked via maintenance_services
     SELECT DISTINCT ms.maintenance_id,
            COALESCE(u.display_name, u.username) AS name, u.id AS user_id, u.office
     FROM maintenance_services ms
     JOIN services sv ON sv.id = ms.service_id
     JOIN LATERAL jsonb_array_elements(COALESCE(sv.user_targets, '[]'::jsonb)) ot ON true
    JOIN users u ON (ot->>'id') ~* '^[0-9a-f-]{36}$' AND u.id = (ot->>'id')::uuid
     WHERE ms.maintenance_id = ANY($1::uuid[])
       AND ot->>'type' = 'user'
       AND u.is_active = true
     UNION
     -- Local group members in service.user_targets linked via maintenance_services
     SELECT DISTINCT ms.maintenance_id,
            COALESCE(u.display_name, u.username) AS name, u.id AS user_id, u.office
     FROM maintenance_services ms
     JOIN services sv ON sv.id = ms.service_id
     JOIN LATERAL jsonb_array_elements(COALESCE(sv.user_targets, '[]'::jsonb)) ot ON true
    JOIN user_group_members ugm ON (ot->>'id') ~* '^[0-9a-f-]{36}$' AND ugm.group_id = (ot->>'id')::uuid
     JOIN users u ON u.id = ugm.user_id
     WHERE ms.maintenance_id = ANY($1::uuid[])
       AND ot->>'type' = 'local_group'
       AND (ot->>'id') ~* '^[0-9a-f-]{36}$'
       AND u.is_active = true`,
    [maintenanceIds]
  ).catch(() => []);
}

// ─── GET /api/status ── Public status page ────────────────────────────────────
router.get('/', async (req, res) => {
  // Always expose only public services on status endpoints.
  const services = await getMany(
    `SELECT s.id, s.name, s.slug, s.status, s.description, s.criticality
     FROM services s WHERE s.is_active=true AND s.is_public=true
     ORDER BY s.criticality, s.name`
  );

  // Active incidents with updates
  const incidentRows = await getMany(
    `SELECT i.id, i.title, i.severity, i.status, i.started_at, i.description, i.resolved_at
     FROM incidents i WHERE i.status != 'resolved' ORDER BY i.started_at DESC LIMIT 10`
  );
  const incidentIds = incidentRows.map(i => i.id);
  let incidentUpdatesMap = {};
  if (incidentIds.length > 0) {
    const updRows = await getMany(
      `SELECT iu.incident_id, iu.id, iu.status, iu.message, iu.created_at,
              COALESCE(u.display_name, u.username) AS author
       FROM incident_updates iu
       LEFT JOIN users u ON u.id = iu.created_by
       WHERE iu.incident_id = ANY($1::uuid[])
       ORDER BY iu.created_at DESC`,
      [incidentIds]
    );
    for (const u of updRows) {
      if (!incidentUpdatesMap[u.incident_id]) incidentUpdatesMap[u.incident_id] = [];
      incidentUpdatesMap[u.incident_id].push(u);
    }
  }
  const incidents = incidentRows.map(i => ({
    ...i,
    updates: incidentUpdatesMap[i.id] || [],
  }));

  // Active and upcoming blackout periods (end_date treated as inclusive end-of-day)
  const blackout_periods = await getMany(
    `SELECT id, name, description, start_date, end_date
     FROM blackout_periods
     WHERE end_date >= NOW()::date
     ORDER BY start_date ASC
     LIMIT 20`
  ).catch(() => []);

  // In-progress maintenance (currently running)
  const in_progress_maintenance = await getMany(
    `SELECT mw.id, mw.title, mw.type, mw.status, mw.impact_level,
            mw.scheduled_start, mw.scheduled_end, mw.actual_start, mw.reopened_at, mw.reopen_reason, mw.reopen_count, mw.description,
            mw.created_at, mw.approved_at
     FROM maintenance_windows mw
     WHERE mw.status = 'in_progress'
     ORDER BY mw.actual_start DESC NULLS LAST LIMIT 100`
  );

  // Upcoming maintenance (scheduled, not yet started)
  const upcoming_maintenance = await getMany(
    `SELECT mw.id, mw.title, mw.type, mw.status, mw.impact_level,
            mw.scheduled_start, mw.scheduled_end, mw.reopened_at, mw.reopen_reason, mw.reopen_count, mw.description,
            mw.created_at, mw.approved_at
     FROM maintenance_windows mw
     WHERE mw.status = 'scheduled'
       AND mw.scheduled_start > NOW() - INTERVAL '1 hour'
     ORDER BY mw.scheduled_start ASC LIMIT 100`
  );

  // Recently completed maintenance (last 7 days)
  const recent_maintenance = await getMany(
    `SELECT mw.id, mw.title, mw.type, mw.status, mw.impact_level,
            mw.scheduled_start, mw.scheduled_end, mw.actual_start, mw.actual_end, mw.reopened_at, mw.reopen_reason, mw.reopen_count, mw.notes, mw.description,
            mw.created_at, mw.approved_at
     FROM maintenance_windows mw
     WHERE mw.status = 'completed'
       AND mw.actual_end > NOW() - INTERVAL '7 days'
     ORDER BY mw.actual_end DESC LIMIT 100`
  );

  const maintenance_history = await getMany(
    `SELECT mw.id, mw.title, mw.type, mw.status, mw.impact_level,
            mw.scheduled_start, mw.scheduled_end, mw.actual_start, mw.actual_end, mw.reopened_at, mw.reopen_reason, mw.reopen_count, mw.notes, mw.description,
            mw.created_at, mw.approved_at
     FROM maintenance_windows mw
     WHERE mw.status != 'draft'
     ORDER BY COALESCE(mw.actual_end, mw.actual_start, mw.scheduled_start, mw.created_at) DESC
     LIMIT 200`
  );

  const incident_history = await getMany(
    `SELECT i.id, i.title, i.severity, i.status, i.started_at, i.description, i.resolved_at
     FROM incidents i
     ORDER BY i.started_at DESC
     LIMIT 100`
  );

  const blackout_history = await getMany(
    `SELECT id, name, description, start_date, end_date
     FROM blackout_periods
     ORDER BY start_date DESC
     LIMIT 100`
  ).catch(() => []);

  const allIncidentIds = [...new Set([...incidentRows, ...incident_history].map((incident) => incident.id))];
  const allBlackoutIds = [...new Set([...blackout_periods, ...blackout_history].map((blackout) => blackout.id))];
  const [incidentAssetRows, blackoutAssetRows] = await Promise.all([
    allIncidentIds.length > 0 ? getMany(
      `WITH related_services AS (
         SELECT incident_id, service_id FROM incident_services WHERE incident_id = ANY($1::uuid[])
         UNION
         SELECT ia.incident_id, sa.service_id
         FROM incident_assets ia
         JOIN service_assets sa ON sa.asset_id=ia.asset_id
         WHERE ia.incident_id = ANY($1::uuid[])
       ), scope_assets AS (
         SELECT incident_id AS event_id, asset_id, TRUE AS is_direct
         FROM incident_assets WHERE incident_id = ANY($1::uuid[])
         UNION ALL
         SELECT rs.incident_id, sa.asset_id, FALSE
         FROM related_services rs
         JOIN service_assets sa ON sa.service_id=rs.service_id
       )
       SELECT scope_assets.event_id, a.id, a.name, a.part_is_relevant,
              BOOL_OR(scope_assets.is_direct) AS is_direct
       FROM scope_assets JOIN assets a ON a.id=scope_assets.asset_id
       GROUP BY scope_assets.event_id, a.id, a.name, a.part_is_relevant
       ORDER BY BOOL_OR(scope_assets.is_direct) DESC, a.name`,
      [allIncidentIds]
    ).catch(() => []) : [],
    allBlackoutIds.length > 0 ? getMany(
      `WITH related_services AS (
         SELECT bp.id AS event_id, UNNEST(COALESCE(bp.service_ids, '{}'::uuid[])) AS service_id
         FROM blackout_periods bp WHERE bp.id = ANY($1::uuid[])
         UNION
         SELECT bp.id, sa.service_id
         FROM blackout_periods bp
         CROSS JOIN LATERAL UNNEST(COALESCE(bp.asset_ids, '{}'::uuid[])) direct_asset(asset_id)
         JOIN service_assets sa ON sa.asset_id=direct_asset.asset_id
         WHERE bp.id = ANY($1::uuid[])
       ), scope_assets AS (
         SELECT bp.id AS event_id, direct_asset.asset_id, TRUE AS is_direct
         FROM blackout_periods bp
         CROSS JOIN LATERAL UNNEST(COALESCE(bp.asset_ids, '{}'::uuid[])) direct_asset(asset_id)
         WHERE bp.id = ANY($1::uuid[])
         UNION ALL
         SELECT rs.event_id, sa.asset_id, FALSE
         FROM related_services rs
         JOIN service_assets sa ON sa.service_id=rs.service_id
       )
       SELECT scope_assets.event_id, a.id, a.name, a.part_is_relevant,
              BOOL_OR(scope_assets.is_direct) AS is_direct
       FROM scope_assets JOIN assets a ON a.id=scope_assets.asset_id
       GROUP BY scope_assets.event_id, a.id, a.name, a.part_is_relevant
       ORDER BY BOOL_OR(scope_assets.is_direct) DESC, a.name`,
      [allBlackoutIds]
    ).catch(() => []) : [],
  ]);

  function buildAffectedAssetsMap(rows) {
    return rows.reduce((map, asset) => {
      if (!map[asset.event_id]) map[asset.event_id] = [];
      map[asset.event_id].push({
        id: asset.id,
        name: asset.name,
        part_is_relevant: asset.part_is_relevant,
        is_direct: asset.is_direct,
      });
      return map;
    }, {});
  }

  const incidentAffectedAssets = buildAffectedAssetsMap(incidentAssetRows);
  const blackoutAffectedAssets = buildAffectedAssetsMap(blackoutAssetRows);
  const attachAffectedAssets = (items, affectedMap) => items.map((item) => ({
    ...item,
    affected_assets: affectedMap[item.id] || [],
  }));

  // For each maintenance (in_progress + upcoming + recent), get involved users count
  const allMaintIds = [...new Set([
    ...in_progress_maintenance,
    ...upcoming_maintenance,
    ...recent_maintenance,
    ...maintenance_history,
  ].map(m => m.id))];

  let involvedMap = {};
  let affectedAssetsMap = {};
  if (allMaintIds.length > 0) {
    const involvedRows = await computeInvolvedUsersRows(allMaintIds);

    for (const row of involvedRows) {
      if (!involvedMap[row.maintenance_id]) involvedMap[row.maintenance_id] = [];
      involvedMap[row.maintenance_id].push({ name: row.name, user_id: row.user_id, office: row.office || '' });
    }

    const affectedAssetRows = await getMany(
      `WITH related_services AS (
         SELECT maintenance_id, service_id
         FROM maintenance_services
         WHERE maintenance_id = ANY($1::uuid[])
         UNION
         SELECT ma.maintenance_id, sa.service_id
         FROM maintenance_assets ma
         JOIN service_assets sa ON sa.asset_id=ma.asset_id
         WHERE ma.maintenance_id = ANY($1::uuid[])
       ), scope_assets AS (
         SELECT maintenance_id, asset_id, TRUE AS is_direct
         FROM maintenance_assets
         WHERE maintenance_id = ANY($1::uuid[])
         UNION ALL
         SELECT rs.maintenance_id, sa.asset_id, FALSE AS is_direct
         FROM related_services rs
         JOIN service_assets sa ON sa.service_id=rs.service_id
       )
       SELECT scope_assets.maintenance_id, a.id, a.name, a.part_is_relevant,
              BOOL_OR(scope_assets.is_direct) AS is_direct
       FROM scope_assets
       JOIN assets a ON a.id=scope_assets.asset_id
       GROUP BY scope_assets.maintenance_id, a.id, a.name, a.part_is_relevant
       ORDER BY BOOL_OR(scope_assets.is_direct) DESC, a.name`,
      [allMaintIds]
    ).catch(() => []);

    for (const asset of affectedAssetRows) {
      if (!affectedAssetsMap[asset.maintenance_id]) affectedAssetsMap[asset.maintenance_id] = [];
      affectedAssetsMap[asset.maintenance_id].push({
        id: asset.id,
        name: asset.name,
        part_is_relevant: asset.part_is_relevant,
        is_direct: asset.is_direct,
      });
    }
  }

  // Attach involved users to each maintenance item
  function attachUsers(list) {
    return list.map(m => ({
      ...m,
      involved_users: involvedMap[m.id] || [],
      affected_assets: affectedAssetsMap[m.id] || [],
    }));
  }

  // Subscriber counts per maintenance
  const subCountRows = allMaintIds.length > 0
    ? await getMany(
        `SELECT maintenance_id, COUNT(*) AS cnt FROM maintenance_status_subscribers
         WHERE maintenance_id = ANY($1::uuid[]) GROUP BY maintenance_id`,
        [allMaintIds]
      ).catch(() => [])
    : [];
  const subCountMap = {};
  for (const r of subCountRows) subCountMap[r.maintenance_id] = parseInt(r.cnt);

  // Check if current user is subscribed (if authenticated)
  let userSubSet = new Set();
  const authHeader = req.headers['authorization'];
  if (authHeader && allMaintIds.length > 0) {
    try {
      const jwt = require('jsonwebtoken');
      const token = authHeader.replace('Bearer ', '');
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'changeme-insecure-default');
      const myRows = await getMany(
        `SELECT maintenance_id FROM maintenance_status_subscribers
         WHERE user_id=$1 AND maintenance_id = ANY($2::uuid[])`,
        [decoded.sub || decoded.id, allMaintIds]
      ).catch(() => []);
      for (const r of myRows) userSubSet.add(r.maintenance_id);
    } catch { /* token invalid or expired — ignore */ }
  }

  function attachMeta(list) {
    return attachUsers(list).map(m => ({
      ...m,
      subscriber_count: subCountMap[m.id] || 0,
      is_subscribed: userSubSet.has(m.id),
    }));
  }

  const maintenance = await getMany(
    `SELECT mw.id, mw.title, mw.type, mw.status, mw.impact_level,
            mw.scheduled_start, mw.scheduled_end, mw.description
     FROM maintenance_windows mw
     WHERE mw.status IN ('scheduled','in_progress')
       AND mw.scheduled_end > NOW()
     ORDER BY mw.scheduled_start ASC LIMIT 20`
  );

  // Overall status
  const criticalIncident = incidents.some(i => ['critical','high'].includes(i.severity));
  const majorOutage = services.some(s => s.status === 'major_outage');
  const degraded = services.some(s => ['degraded','partial_outage'].includes(s.status));
  const underMaintenance = services.some(s => s.status === 'under_maintenance');

  let overallStatus = 'operational';
  if (criticalIncident || majorOutage) overallStatus = 'major_outage';
  else if (degraded) overallStatus = 'degraded';
  else if (underMaintenance) overallStatus = 'under_maintenance';

  const { value: generalCfg } = await getOne("SELECT value FROM settings WHERE key='general_config'") || { value: '{}' };
  const general = JSON.parse(generalCfg || '{}');

  res.json({
    app_name: general.app_name || 'GB Maintenance',
    app_brand_image_url: general.app_brand_image_url || '',
    overall_status: overallStatus,
    blackout_periods: attachAffectedAssets(blackout_periods, blackoutAffectedAssets),
    services,
    active_incidents: attachAffectedAssets(incidents, incidentAffectedAssets),
    incident_history: attachAffectedAssets(incident_history, incidentAffectedAssets),
    in_progress_maintenance: attachMeta(in_progress_maintenance),
    upcoming_maintenance: attachMeta(upcoming_maintenance),
    recent_maintenance: attachMeta(recent_maintenance),
    maintenance_history: attachMeta(maintenance_history),
    blackout_history: attachAffectedAssets(blackout_history, blackoutAffectedAssets),
    // Legacy field kept for backward compat
    maintenance_summary: maintenance,
    last_updated: new Date().toISOString(),
  });
});

// ─── POST /api/status/maintenance/:id/subscribe ──────────────────────────────
router.post('/maintenance/:id/subscribe', requireAuth, async (req, res) => {
  const mw = await getOne('SELECT id FROM maintenance_windows WHERE id=$1', [req.params.id]);
  if (!mw) return res.status(404).json({ error: 'Maintenance not found' });
  try {
    await query(
      `INSERT INTO maintenance_status_subscribers (maintenance_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [req.params.id, req.user.id]
    );
    res.json({ subscribed: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/status/maintenance/:id/subscribe ────────────────────────────
router.delete('/maintenance/:id/subscribe', requireAuth, async (req, res) => {
  await query(
    `DELETE FROM maintenance_status_subscribers WHERE maintenance_id=$1 AND user_id=$2`,
    [req.params.id, req.user.id]
  );
  res.json({ subscribed: false });
});

// ─── GET /api/status/services/:slug ──────────────────────────────────────────
router.get('/services/:slug', async (req, res) => {
  const service = await getOne(
    `SELECT id, name, slug, status, description, criticality, sla_uptime_percent
     FROM services WHERE slug=$1 AND is_active=true AND is_public=true`,
    [req.params.slug]
  );
  if (!service) return res.status(404).json({ error: 'Servizio non trovato' });

  // 90-day uptime data
  const history = await getMany(
    `SELECT sh.status, sh.created_at FROM status_history sh
     JOIN service_assets sa ON sa.asset_id=sh.entity_id
     WHERE sh.entity_type='asset' AND sa.service_id=$1 AND sh.created_at > NOW() - INTERVAL '90 days'
     ORDER BY sh.created_at ASC`,
    [service.id]
  );

  // Past incidents (30 days)
  const incidents = await getMany(
    `SELECT i.id, i.title, i.severity, i.status, i.started_at, i.resolved_at
     FROM incidents i
     JOIN incident_assets ia ON ia.incident_id=i.id
     JOIN service_assets sa ON sa.asset_id=ia.asset_id
     WHERE sa.service_id=$1 AND i.started_at > NOW() - INTERVAL '30 days'
     ORDER BY i.started_at DESC`,
    [service.id]
  );

  res.json({ ...service, history, incidents });
});

module.exports = router;
