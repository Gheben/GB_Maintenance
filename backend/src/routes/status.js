const { Router } = require('express');
const { getMany, getOne, query } = require('../db/database');
const { requireAuth, optionalAuth } = require('../middleware/authMiddleware');
const { getVisibleAffectedScope } = require('../utils/entityVisibility');

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
router.get('/', optionalAuth, async (req, res) => {
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
              CASE WHEN $2::boolean THEN COALESCE(u.display_name, u.username) ELSE NULL END AS author
       FROM incident_updates iu
       LEFT JOIN users u ON u.id = iu.created_by
       WHERE iu.incident_id = ANY($1::uuid[])
       ORDER BY iu.created_at DESC`,
            [incidentIds, ['superadmin', 'admin', 'change_manager'].includes(req.user?.role)]
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
  const [incidentAssetRows, blackoutAssetRows, incidentServiceRows, blackoutServiceRows] = await Promise.all([
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
    allIncidentIds.length > 0 ? getMany(
      `WITH scoped_services AS (
         SELECT incident_id AS event_id, service_id, TRUE AS is_direct
         FROM incident_services WHERE incident_id = ANY($1::uuid[])
         UNION ALL
         SELECT ia.incident_id, sa.service_id, FALSE
         FROM incident_assets ia
         JOIN service_assets sa ON sa.asset_id=ia.asset_id
         WHERE ia.incident_id = ANY($1::uuid[])
       )
       SELECT scoped_services.event_id, s.id, s.name, s.status, s.criticality, s.is_public,
              BOOL_OR(scoped_services.is_direct) AS is_direct
       FROM scoped_services JOIN services s ON s.id=scoped_services.service_id
       GROUP BY scoped_services.event_id, s.id, s.name, s.status, s.criticality, s.is_public
       ORDER BY BOOL_OR(scoped_services.is_direct) DESC, s.name`,
      [allIncidentIds]
    ).catch(() => []) : [],
    allBlackoutIds.length > 0 ? getMany(
      `WITH scoped_services AS (
         SELECT bp.id AS event_id, direct_service.service_id, TRUE AS is_direct
         FROM blackout_periods bp
         CROSS JOIN LATERAL UNNEST(COALESCE(bp.service_ids, '{}'::uuid[])) direct_service(service_id)
         WHERE bp.id = ANY($1::uuid[])
         UNION ALL
         SELECT bp.id, sa.service_id, FALSE
         FROM blackout_periods bp
         CROSS JOIN LATERAL UNNEST(COALESCE(bp.asset_ids, '{}'::uuid[])) direct_asset(asset_id)
         JOIN service_assets sa ON sa.asset_id=direct_asset.asset_id
         WHERE bp.id = ANY($1::uuid[])
       )
       SELECT scoped_services.event_id, s.id, s.name, s.status, s.criticality, s.is_public,
              BOOL_OR(scoped_services.is_direct) AS is_direct
       FROM scoped_services JOIN services s ON s.id=scoped_services.service_id
       GROUP BY scoped_services.event_id, s.id, s.name, s.status, s.criticality, s.is_public
       ORDER BY BOOL_OR(scoped_services.is_direct) DESC, s.name`,
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
  const buildAffectedServicesMap = (rows) => rows.reduce((map, service) => {
    if (!map[service.event_id]) map[service.event_id] = [];
    map[service.event_id].push(service);
    return map;
  }, {});
  const incidentAffectedServices = buildAffectedServicesMap(incidentServiceRows);
  const blackoutAffectedServices = buildAffectedServicesMap(blackoutServiceRows);
  const eventVisibility = await getVisibleAffectedScope(
    { userId: req.user?.id, email: req.user?.email, role: req.user?.role },
    [...incidentAssetRows, ...blackoutAssetRows],
    [...incidentServiceRows, ...blackoutServiceRows]
  );
  const visibleEventAssetIds = new Set(eventVisibility.assets.map((asset) => String(asset.id)));
  const visibleEventServiceIds = new Set(eventVisibility.services.map((service) => String(service.id)));
  const attachAffectedScope = (items, affectedAssetMap, affectedServiceMap) => items.map((item) => ({
    ...item,
    affected_assets: (affectedAssetMap[item.id] || []).filter((asset) => visibleEventAssetIds.has(String(asset.id))),
    affected_services: (affectedServiceMap[item.id] || []).filter((service) => visibleEventServiceIds.has(String(service.id))),
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
  let affectedServicesMap = {};
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

    const affectedServiceRows = await getMany(
      `WITH scoped_services AS (
         SELECT maintenance_id, service_id, TRUE AS is_direct
         FROM maintenance_services WHERE maintenance_id = ANY($1::uuid[])
         UNION ALL
         SELECT ma.maintenance_id, sa.service_id, FALSE
         FROM maintenance_assets ma
         JOIN service_assets sa ON sa.asset_id=ma.asset_id
         WHERE ma.maintenance_id = ANY($1::uuid[])
       )
       SELECT scoped_services.maintenance_id, s.id, s.name, s.status, s.criticality, s.is_public,
              BOOL_OR(scoped_services.is_direct) AS is_direct
       FROM scoped_services JOIN services s ON s.id=scoped_services.service_id
       GROUP BY scoped_services.maintenance_id, s.id, s.name, s.status, s.criticality, s.is_public
       ORDER BY BOOL_OR(scoped_services.is_direct) DESC, s.name`,
      [allMaintIds]
    ).catch(() => []);
    for (const service of affectedServiceRows) {
      if (!affectedServicesMap[service.maintenance_id]) affectedServicesMap[service.maintenance_id] = [];
      affectedServicesMap[service.maintenance_id].push(service);
    }
  }

  const maintenanceVisibility = await getVisibleAffectedScope(
    { userId: req.user?.id, email: req.user?.email, role: req.user?.role },
    Object.values(affectedAssetsMap).flat(),
    Object.values(affectedServicesMap).flat()
  );
  const visibleMaintenanceAssetIds = new Set(maintenanceVisibility.assets.map((asset) => String(asset.id)));
  const visibleMaintenanceServiceIds = new Set(maintenanceVisibility.services.map((service) => String(service.id)));

  // Attach involved users to each maintenance item
  const canViewAllInvolvedUsers = ['superadmin', 'admin', 'change_manager'].includes(req.user?.role);
  function attachUsers(list) {
    return list.map(m => ({
      ...m,
      involved_users: canViewAllInvolvedUsers
        ? (involvedMap[m.id] || [])
        : (involvedMap[m.id] || []).filter((involved) => req.user && String(involved.user_id) === String(req.user.id)),
      affected_assets: (affectedAssetsMap[m.id] || []).filter((asset) => visibleMaintenanceAssetIds.has(String(asset.id))),
      affected_services: (affectedServicesMap[m.id] || []).filter((service) => visibleMaintenanceServiceIds.has(String(service.id))),
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
  if (req.user && allMaintIds.length > 0) {
    const myRows = await getMany(
      `SELECT maintenance_id FROM maintenance_status_subscribers
       WHERE user_id=$1 AND maintenance_id = ANY($2::uuid[])`,
      [req.user.id, allMaintIds]
    ).catch(() => []);
    for (const r of myRows) userSubSet.add(r.maintenance_id);
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
    blackout_periods: attachAffectedScope(blackout_periods, blackoutAffectedAssets, blackoutAffectedServices),
    services,
    active_incidents: attachAffectedScope(incidents, incidentAffectedAssets, incidentAffectedServices),
    incident_history: attachAffectedScope(incident_history, incidentAffectedAssets, incidentAffectedServices),
    in_progress_maintenance: attachMeta(in_progress_maintenance),
    upcoming_maintenance: attachMeta(upcoming_maintenance),
    recent_maintenance: attachMeta(recent_maintenance),
    maintenance_history: attachMeta(maintenance_history),
    blackout_history: attachAffectedScope(blackout_history, blackoutAffectedAssets, blackoutAffectedServices),
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
