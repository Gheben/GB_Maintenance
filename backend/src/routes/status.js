const { Router } = require('express');
const { getMany, getOne } = require('../db/database');

const router = Router();

// ─── GET /api/status ── Public status page ────────────────────────────────────
router.get('/', async (req, res) => {
  // Public services (or all if authenticated)
  const isPublic = !req.headers['authorization'];
  const services = await getMany(
    `SELECT s.id, s.name, s.slug, s.status, s.description, s.criticality
     FROM services s WHERE s.is_active=true ${isPublic ? 'AND s.is_public=true' : ''}
     ORDER BY s.criticality, s.name`
  );

  // Active incidents
  const incidents = await getMany(
    `SELECT i.id, i.title, i.severity, i.status, i.started_at, i.description
     FROM incidents i WHERE i.status != 'resolved' ORDER BY i.started_at DESC LIMIT 10`
  );

  // In-progress maintenance (currently running)
  const in_progress_maintenance = await getMany(
    `SELECT mw.id, mw.title, mw.type, mw.status, mw.impact_level,
            mw.scheduled_start, mw.scheduled_end, mw.actual_start, mw.description
     FROM maintenance_windows mw
     WHERE mw.status = 'in_progress'
     ORDER BY mw.actual_start DESC NULLS LAST LIMIT 10`
  );

  // Upcoming maintenance (scheduled, not yet started)
  const upcoming_maintenance = await getMany(
    `SELECT mw.id, mw.title, mw.type, mw.status, mw.impact_level,
            mw.scheduled_start, mw.scheduled_end, mw.description
     FROM maintenance_windows mw
     WHERE mw.status = 'scheduled'
       AND mw.scheduled_start > NOW() - INTERVAL '1 hour'
     ORDER BY mw.scheduled_start ASC LIMIT 20`
  );

  // Recently completed maintenance (last 7 days)
  const recent_maintenance = await getMany(
    `SELECT mw.id, mw.title, mw.type, mw.status, mw.impact_level,
            mw.scheduled_start, mw.scheduled_end, mw.actual_start, mw.actual_end, mw.notes, mw.description
     FROM maintenance_windows mw
     WHERE mw.status = 'completed'
       AND mw.actual_end > NOW() - INTERVAL '7 days'
     ORDER BY mw.actual_end DESC LIMIT 10`
  );

  // For each maintenance (in_progress + upcoming + recent), get involved users count
  const allMaintIds = [
    ...in_progress_maintenance,
    ...upcoming_maintenance,
    ...recent_maintenance,
  ].map(m => m.id);

  let involvedMap = {};
  if (allMaintIds.length > 0) {
    const involvedRows = await getMany(
      `SELECT DISTINCT mwa.maintenance_id,
              COALESCE(u.display_name, u.username) AS name, u.id AS user_id
       FROM maintenance_assets mwa
       JOIN service_assets sa ON sa.asset_id = mwa.asset_id
       LEFT JOIN service_subscribers ss ON ss.service_id = sa.service_id
       LEFT JOIN users u ON u.id = ss.user_id
       WHERE mwa.maintenance_id = ANY($1::uuid[])
         AND u.id IS NOT NULL
       UNION
       SELECT DISTINCT mwa.maintenance_id,
              COALESCE(u.display_name, u.username) AS name, u.id AS user_id
       FROM maintenance_assets mwa
       JOIN service_assets sa ON sa.asset_id = mwa.asset_id
       JOIN services sv ON sv.id = sa.service_id
       LEFT JOIN users u ON u.id = sv.owner_id
       WHERE mwa.maintenance_id = ANY($1::uuid[])
         AND u.id IS NOT NULL
       UNION
       SELECT DISTINCT ms.maintenance_id,
              COALESCE(u.display_name, u.username) AS name, u.id AS user_id
       FROM maintenance_services ms
       LEFT JOIN service_subscribers ss ON ss.service_id = ms.service_id
       LEFT JOIN users u ON u.id = ss.user_id
       WHERE ms.maintenance_id = ANY($1::uuid[])
         AND u.id IS NOT NULL
       UNION
       SELECT DISTINCT ms.maintenance_id,
              COALESCE(u.display_name, u.username) AS name, u.id AS user_id
       FROM maintenance_services ms
       JOIN services sv ON sv.id = ms.service_id
       LEFT JOIN users u ON u.id = sv.owner_id
       WHERE ms.maintenance_id = ANY($1::uuid[])
         AND u.id IS NOT NULL`,
      [allMaintIds]
    ).catch(() => []);

    for (const row of involvedRows) {
      if (!involvedMap[row.maintenance_id]) involvedMap[row.maintenance_id] = [];
      if (!involvedMap[row.maintenance_id].find(x => x.user_id === row.user_id)) {
        involvedMap[row.maintenance_id].push({ name: row.name, user_id: row.user_id });
      }
    }
  }

  // Attach involved users to each maintenance item
  function attachUsers(list) {
    return list.map(m => ({ ...m, involved_users: involvedMap[m.id] || [] }));
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
    overall_status: overallStatus,
    services,
    active_incidents: incidents,
    in_progress_maintenance: attachUsers(in_progress_maintenance),
    upcoming_maintenance: attachUsers(upcoming_maintenance),
    recent_maintenance: attachUsers(recent_maintenance),
    // Legacy field kept for backward compat
    maintenance_summary: maintenance,
    last_updated: new Date().toISOString(),
  });
});

// ─── GET /api/status/services/:slug ──────────────────────────────────────────
router.get('/services/:slug', async (req, res) => {
  const service = await getOne(
    `SELECT id, name, slug, status, description, criticality, sla_uptime_percent
     FROM services WHERE slug=$1 AND is_active=true`,
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
