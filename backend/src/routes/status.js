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

  // Ongoing/upcoming maintenance
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
    upcoming_maintenance: maintenance,
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
