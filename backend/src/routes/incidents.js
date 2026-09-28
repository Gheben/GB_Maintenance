const { Router } = require('express');
const { body, validationResult } = require('express-validator');
const { requireAuth, requireOperator, requireAdmin } = require('../middleware/authMiddleware');
const { query, getOne, getMany } = require('../db/database');
const auditService = require('../services/auditService');
const { notifyIncident } = require('../services/notificationService');
const wsService = require('../services/wsService');
const { getAffectedAssets, getAffectedServices } = require('../utils/maintenanceScope');
const { getVisibleAffectedScope } = require('../utils/entityVisibility');
const { parsePagination } = require('../utils/pagination');
const PDFDocument = require('pdfkit');

const router = Router();
router.use(requireAuth);

const SEVERITIES = ['critical','high','medium','low'];
const STATUSES = ['investigating','identified','monitoring','resolved'];

async function getAllowedSeverities() {
  const rows = await getMany(`SELECT slug FROM incident_severities ORDER BY sort_order, label`, []);
  const fromCatalog = rows.map((r) => r.slug).filter(Boolean);
  return fromCatalog.length > 0 ? fromCatalog : SEVERITIES;
}

// ─── GET /api/incidents ───────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const { status, severity, search } = req.query;
  const { page, limit, offset } = parsePagination(req.query);
  const params = []; let i = 1;
  const filters = [];

  if (status)   { filters.push(`i.status=$${i++}`); params.push(status); }
  if (severity) { filters.push(`i.severity=$${i++}`); params.push(severity); }
  if (search && String(search).trim()) {
    const q = `%${String(search).trim()}%`;
    filters.push(`(i.title ILIKE $${i} OR i.description ILIKE $${i + 1} OR i.ticket_ref ILIKE $${i + 2})`);
    params.push(q, q, q);
    i += 3;
  }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const countRes = await query(`SELECT COUNT(*) FROM incidents i ${where}`, params);
  const total = parseInt(countRes.rows[0].count);

  const rows = await getMany(
    `SELECT i.*, u.display_name as created_by_name,
       COALESCE(ia.asset_count, 0) as asset_count,
       COALESCE(isvc.service_count, 0) as service_count
     FROM incidents i
     LEFT JOIN users u ON u.id=i.created_by
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS asset_count
       FROM incident_assets ia
       WHERE ia.incident_id=i.id
     ) ia ON TRUE
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS service_count
       FROM incident_services is2
       WHERE is2.incident_id=i.id
     ) isvc ON TRUE
     ${where} ORDER BY i.started_at DESC LIMIT $${i++} OFFSET $${i}`,
    [...params, limit, offset]
  );
  res.json({ data: rows, total, page, limit });
});

// ─── GET /api/incidents/active ────────────────────────────────────────────────
router.get('/active', async (req, res) => {
  const rows = await getMany(
    `SELECT i.*, u.display_name as created_by_name FROM incidents i
     LEFT JOIN users u ON u.id=i.created_by
     WHERE i.status != 'resolved' ORDER BY i.started_at DESC LIMIT 20`
  );
  res.json(rows);
});

// ─── GET /api/incidents/:id ───────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  const incident = await getOne(
    `SELECT i.*, u.display_name as created_by_name FROM incidents i
     LEFT JOIN users u ON u.id=i.created_by WHERE i.id=$1`,
    [req.params.id]
  );
  if (!incident) return res.status(404).json({ error: 'Incident not found' });

  const assets = await getMany(
    `SELECT a.id, a.name, a.category, a.status, a.criticality, a.part_is_relevant
     FROM assets a JOIN incident_assets ia ON ia.asset_id=a.id WHERE ia.incident_id=$1`,
    [req.params.id]
  );
  const services = await getMany(
    `SELECT s.id, s.name, s.slug, s.status AS current_status,
            s.part_is_relevant
     FROM services s JOIN incident_services is2 ON is2.service_id=s.id WHERE is2.incident_id=$1`,
    [req.params.id]
  );
  const [affectedAssets, affectedServices] = await Promise.all([
    getAffectedAssets(assets.map((asset) => asset.id), services.map((service) => service.id)),
    getAffectedServices(assets.map((asset) => asset.id), services.map((service) => service.id)),
  ]);
  const visibleScope = await getVisibleAffectedScope(
    { userId: req.user.id, email: req.user.email, role: req.user.role },
    affectedAssets,
    affectedServices
  );
  const updates = await getMany(
    `SELECT iu.*, u.display_name as author FROM incident_updates iu
     LEFT JOIN users u ON u.id=iu.created_by WHERE iu.incident_id=$1 ORDER BY iu.created_at ASC`,
    [req.params.id]
  );
  res.json({
    ...incident,
    assets: visibleScope.assets.filter((asset) => asset.is_direct),
    affectedAssets: visibleScope.assets.filter((asset) => !asset.is_direct),
    services: visibleScope.services.filter((service) => service.is_direct),
    affectedServices: visibleScope.services.filter((service) => !service.is_direct),
    updates,
  });
});

// ─── POST /api/incidents ──────────────────────────────────────────────────────
router.post('/', requireOperator, [
  body('title').isString().trim().isLength({ min: 1, max: 300 }),
  body('severity').isString().trim().isLength({ min: 1, max: 50 }),
  body('description').optional().isString(),
  body('ticket_ref').optional().isString().isLength({ max: 100 }),
  body('asset_ids').optional().isArray(),
  body('service_ids').optional().isArray(),
  body('started_at').optional().isISO8601(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const allowedSeverities = await getAllowedSeverities();
  if (!allowedSeverities.includes(req.body.severity)) {
    return res.status(400).json({ error: 'Invalid severity' });
  }

  const result = await query(
    `INSERT INTO incidents (title, description, ticket_ref, severity, status, started_at, created_by)
     VALUES ($1,$2,$3,$4,'investigating',$5,$6) RETURNING id`,
    [req.body.title, req.body.description||null, req.body.ticket_ref||null, req.body.severity,
     req.body.started_at || new Date(), req.user.id]
  );
  const id = result.rows[0].id;

  if (Array.isArray(req.body.asset_ids)) {
    for (const aid of req.body.asset_ids) {
      await query(`INSERT INTO incident_assets (incident_id, asset_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, aid]);
      const newStatus = ['critical','high'].includes(req.body.severity) ? 'major_outage' : 'partial_outage';
      await query(`UPDATE assets SET status=$1, updated_at=NOW() WHERE id=$2`, [newStatus, aid]);
      await query(`INSERT INTO status_history (entity_type, entity_id, status, changed_by, reason) VALUES ('asset',$1,$2,$3,$4)`,
        [aid, newStatus, req.user.username, `Incident: ${req.body.title}`]);
    }
  }
  if (Array.isArray(req.body.service_ids)) {
    for (const sid of req.body.service_ids) {
      await query(`INSERT INTO incident_services (incident_id, service_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, sid]);
    }
  }

  // First update
  await query(
    `INSERT INTO incident_updates (incident_id, status, message, created_by) VALUES ($1,'investigating',$2,$3)`,
    [id, req.body.description || 'Incident opened.', req.user.id]
  );

  await notifyIncident(id, 'incident_created');
  wsService.broadcast({ type: 'incident_created', id, severity: req.body.severity });
  await auditService.log(req.user.id, req.user.username, 'incident:create', 'incident', id, req.body.title, req.ip, req.get('user-agent'));
  res.status(201).json({ id });
});

// ─── PUT /api/incidents/:id ───────────────────────────────────────────────────
router.put('/:id', requireOperator, async (req, res) => {
  const incident = await getOne('SELECT id FROM incidents WHERE id=$1', [req.params.id]);
  if (!incident) return res.status(404).json({ error: 'Not found' });

  if (req.body.severity !== undefined) {
    const allowedSeverities = await getAllowedSeverities();
    if (!allowedSeverities.includes(req.body.severity)) {
      return res.status(400).json({ error: 'Invalid severity' });
    }
  }

  const allowed = ['title','description','ticket_ref','severity'];
  const sets=[]; const vals=[]; let i=1;
  for (const f of allowed) {
    if (req.body[f] !== undefined) { sets.push(`${f}=$${i++}`); vals.push(req.body[f]); }
  }

  if (Array.isArray(req.body.asset_ids)) {
    await query('DELETE FROM incident_assets WHERE incident_id=$1', [req.params.id]);
    for (const aid of req.body.asset_ids) {
      await query(`INSERT INTO incident_assets (incident_id, asset_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [req.params.id, aid]);
    }
  }
  if (Array.isArray(req.body.service_ids)) {
    await query('DELETE FROM incident_services WHERE incident_id=$1', [req.params.id]);
    for (const sid of req.body.service_ids) {
      await query(`INSERT INTO incident_services (incident_id, service_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [req.params.id, sid]);
    }
  }

  if (sets.length > 0) {
    sets.push(`updated_at=$${i++}`); vals.push(new Date()); vals.push(req.params.id);
    await query(`UPDATE incidents SET ${sets.join(',')} WHERE id=$${i}`, vals);
  }
  res.json({ message: 'Incident updated' });
});

// ─── POST /api/incidents/:id/updates ─────────────────────────────────────────
router.post('/:id/updates', requireOperator, [
  body('status').isIn(STATUSES),
  body('message').isString().trim().isLength({ min: 1 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  await query(
    `INSERT INTO incident_updates (incident_id, status, message, created_by) VALUES ($1,$2,$3,$4)`,
    [req.params.id, req.body.status, req.body.message, req.user.id]
  );

  const wasResolved = req.body.status === 'resolved';
  await query(
    `UPDATE incidents SET status=$1${wasResolved ? ', resolved_at=NOW()' : ''}, updated_at=NOW() WHERE id=$2`,
    [req.body.status, req.params.id]
  );

  if (wasResolved) {
    // Restore asset statuses
    const assets = await getMany('SELECT asset_id FROM incident_assets WHERE incident_id=$1', [req.params.id]);
    for (const a of assets) {
      await query(`UPDATE assets SET status='operational', updated_at=NOW() WHERE id=$1`, [a.asset_id]);
      await query(`INSERT INTO status_history (entity_type, entity_id, status, changed_by, reason) VALUES ('asset',$1,'operational',$2,$3)`,
        [a.asset_id, req.user.username, `Incident resolved: ${req.params.id}`]);
    }
    await notifyIncident(req.params.id, 'incident_resolved');
  }

  wsService.broadcast({ type: 'incident_updated', id: req.params.id, status: req.body.status });
  res.status(201).json({ message: 'Update added' });
});

// ─── DELETE /api/incidents/:id ────────────────────────────────────────────────
router.delete('/:id', requireAdmin, async (req, res) => {
  await query('DELETE FROM incidents WHERE id=$1', [req.params.id]);
  res.json({ message: 'Incident deleted' });
});

// ─── PUT /api/incidents/:id/rca ───────────────────────────────────────────────
router.put('/:id/rca', requireOperator, [
  body('root_cause').optional({ nullable: true }).isString(),
  body('resolution_summary').optional({ nullable: true }).isString(),
  body('preventive_actions').optional({ nullable: true }).isString(),
  body('mark_completed').optional().isBoolean(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const incident = await getOne('SELECT id FROM incidents WHERE id=$1', [req.params.id]);
  if (!incident) return res.status(404).json({ error: 'Incident not found' });

  const sets = ['root_cause=$1', 'resolution_summary=$2', 'preventive_actions=$3', 'updated_at=NOW()'];
  const vals = [req.body.root_cause || null, req.body.resolution_summary || null, req.body.preventive_actions || null];
  let i = 4;
  if (req.body.mark_completed === true) {
    sets.push(`rca_completed_at=NOW()`, `rca_completed_by=$${i++}`);
    vals.push(req.user.id);
  }
  vals.push(req.params.id);
  await query(`UPDATE incidents SET ${sets.join(',')} WHERE id=$${i}`, vals);
  await auditService.log(req.user.id, req.user.username, 'incident:rca_updated', 'incident', req.params.id, null, req.ip, req.get('user-agent'));
  res.json({ message: 'Root cause analysis saved' });
});

// ─── GET /api/incidents/:id/rca/export ────────────────────────────────────────
router.get('/:id/rca/export', async (req, res) => {
  const incident = await getOne(
    `SELECT i.*, u.display_name AS completed_by_name FROM incidents i
     LEFT JOIN users u ON u.id=i.rca_completed_by WHERE i.id=$1`,
    [req.params.id]
  );
  if (!incident) return res.status(404).json({ error: 'Incident not found' });

  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=incident-rca-${req.params.id}.pdf`);
  doc.pipe(res);

  doc.fontSize(18).fillColor('#111827').font('Helvetica-Bold').text('Root Cause Analysis Report');
  doc.moveDown(0.3);
  doc.fontSize(11).font('Helvetica-Bold').fillColor('#374151').text(incident.title);
  doc.moveDown(0.5);

  const meta = [
    ['Severity', incident.severity],
    ['Status', incident.status],
    ['Ticket ref', incident.ticket_ref || '-'],
    ['Started at', new Date(incident.started_at).toLocaleString('en-GB')],
    ['Resolved at', incident.resolved_at ? new Date(incident.resolved_at).toLocaleString('en-GB') : '-'],
    ['RCA completed', incident.rca_completed_at ? `${new Date(incident.rca_completed_at).toLocaleString('en-GB')} by ${incident.completed_by_name || '-'}` : 'Not yet completed'],
  ];
  doc.fontSize(9).font('Helvetica').fillColor('#4b5563');
  meta.forEach(([label, value]) => doc.text(`${label}: ${value}`));
  doc.moveDown(1);

  const section = (heading, text) => {
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#1e40af').text(heading);
    doc.moveDown(0.2);
    doc.fontSize(10).font('Helvetica').fillColor('#111827').text(text || 'Not documented.', { align: 'left' });
    doc.moveDown(1);
  };

  section('Description', incident.description);
  section('Root Cause', incident.root_cause);
  section('Resolution Summary', incident.resolution_summary);
  section('Preventive Actions', incident.preventive_actions);

  doc.fontSize(8).fillColor('#9ca3af').text(`Generated on ${new Date().toLocaleString('en-GB')}`, { align: 'right' });
  doc.end();
});

// ─── GET /api/incidents/:id/users ────────────────────────────────────────────
router.get('/:id/users', async (req, res) => {
  const rows = await getMany(
    `WITH related_services AS (
       SELECT service_id FROM incident_services WHERE incident_id=$1
       UNION
       SELECT sa.service_id
       FROM incident_assets ia
       JOIN service_assets sa ON sa.asset_id=ia.asset_id
       WHERE ia.incident_id=$1
     ), scope_assets AS (
       SELECT asset_id FROM incident_assets WHERE incident_id=$1
       UNION
       SELECT sa.asset_id FROM service_assets sa
       WHERE sa.service_id IN (SELECT service_id FROM related_services)
     ), resolved_users AS (
       SELECT DISTINCT u.id::text AS id, u.username, u.display_name, u.email, u.office, u.role, u.auth_type
       FROM service_subscribers ss
       JOIN related_services is2 ON is2.service_id = ss.service_id
       LEFT JOIN users u ON u.id = ss.user_id
       WHERE u.id IS NOT NULL
       UNION
       SELECT DISTINCT u.id::text AS id, u.username, u.display_name, u.email, u.office, u.role, u.auth_type
      FROM scope_assets ia
       JOIN assets a ON a.id = ia.asset_id
       JOIN LATERAL jsonb_array_elements(COALESCE(a.user_targets, '[]'::jsonb)) ot ON true
       JOIN users u ON (
         (ot->>'type' = 'user' AND (ot->>'id') ~* '^[0-9a-f-]{36}$' AND u.id = (ot->>'id')::uuid)
         OR (
           ot->>'type' = 'local_group'
           AND (ot->>'id') ~* '^[0-9a-f-]{36}$'
           AND EXISTS (
             SELECT 1 FROM user_group_members ugm
             WHERE ugm.group_id = (ot->>'id')::uuid
               AND ugm.user_id = u.id
           )
         )
       )
      WHERE u.is_active = true
       UNION
       SELECT DISTINCT COALESCE(lc.dn, lc.username, lc.upn)::text AS id,
              lc.username,
              lc.display_name,
              lc.email,
              lc.office,
              'viewer'::text AS role,
              'ldap'::text AS auth_type
      FROM scope_assets ia
       JOIN assets a ON a.id = ia.asset_id
       JOIN LATERAL jsonb_array_elements(COALESCE(a.user_targets, '[]'::jsonb)) ot ON true
       JOIN ldap_users_cache lc ON (
         ot->>'type' = 'ldap_user'
         AND NULLIF(BTRIM(COALESCE(ot->>'dn', ot->>'id', '')), '') IS NOT NULL
         AND (
           LOWER(COALESCE(lc.dn, '')) = LOWER(NULLIF(BTRIM(COALESCE(ot->>'dn', ot->>'id', '')), ''))
           OR LOWER(COALESCE(lc.username, '')) = LOWER(NULLIF(BTRIM(COALESCE(ot->>'dn', ot->>'id', '')), ''))
           OR LOWER(COALESCE(lc.upn, '')) = LOWER(NULLIF(BTRIM(COALESCE(ot->>'dn', ot->>'id', '')), ''))
         )
       )
       UNION
       SELECT DISTINCT COALESCE(lc.dn, lc.username, lc.upn)::text AS id,
              lc.username,
              lc.display_name,
              lc.email,
              lc.office,
              'viewer'::text AS role,
              'ldap'::text AS auth_type
      FROM scope_assets ia
       JOIN assets a ON a.id = ia.asset_id
       JOIN LATERAL jsonb_array_elements(COALESCE(a.user_targets, '[]'::jsonb)) ot ON true
       JOIN ldap_users_cache lc ON (
         ot->>'type' = 'ldap_group'
         AND NULLIF(BTRIM(COALESCE(ot->>'dn', ot->>'id', '')), '') IS NOT NULL
         AND EXISTS (
           SELECT 1
           FROM jsonb_array_elements_text(COALESCE(lc.source_payload->'memberOf', lc.source_payload->'memberof', '[]'::jsonb)) m(dn)
           WHERE LOWER(m.dn) = LOWER(NULLIF(BTRIM(COALESCE(ot->>'dn', ot->>'id', '')), ''))
              OR SPLIT_PART(LOWER(m.dn), ',', 1) = SPLIT_PART(LOWER(NULLIF(BTRIM(COALESCE(ot->>'dn', ot->>'id', '')), '')), ',', 1)
         )
       )
       UNION
       SELECT DISTINCT COALESCE(lc.dn, lc.username, lc.upn)::text AS id,
              lc.username,
              lc.display_name,
              lc.email,
              lc.office,
              'viewer'::text AS role,
              'ldap'::text AS auth_type
      FROM scope_assets ia
       JOIN assets a ON a.id = ia.asset_id
       JOIN LATERAL jsonb_array_elements(COALESCE(a.user_targets, '[]'::jsonb)) ot ON true
       JOIN ldap_group_mappings lgm ON (
         ot->>'type' = 'local_group'
         AND (ot->>'id') ~* '^[0-9a-f-]{36}$'
         AND lgm.local_group_id = (ot->>'id')::uuid
       )
       JOIN ldap_users_cache lc ON EXISTS (
         SELECT 1
         FROM jsonb_array_elements_text(COALESCE(lc.source_payload->'memberOf', lc.source_payload->'memberof', '[]'::jsonb)) m(dn)
         WHERE LOWER(m.dn) = LOWER(lgm.ldap_group_dn)
            OR SPLIT_PART(LOWER(m.dn), ',', 1) = SPLIT_PART(LOWER(lgm.ldap_group_dn), ',', 1)
       )
      WHERE lgm.ldap_group_dn IS NOT NULL AND BTRIM(lgm.ldap_group_dn) <> ''
       UNION
       SELECT DISTINCT u.id::text AS id, u.username, u.display_name, u.email, u.office, u.role, u.auth_type
      FROM related_services is2
       JOIN services s ON s.id = is2.service_id
       JOIN LATERAL jsonb_array_elements(COALESCE(s.user_targets, '[]'::jsonb)) ot ON true
       JOIN users u ON (
         (ot->>'type' = 'user' AND (ot->>'id') ~* '^[0-9a-f-]{36}$' AND u.id = (ot->>'id')::uuid)
         OR (
           ot->>'type' = 'local_group'
           AND (ot->>'id') ~* '^[0-9a-f-]{36}$'
           AND EXISTS (
             SELECT 1 FROM user_group_members ugm
             WHERE ugm.group_id = (ot->>'id')::uuid
               AND ugm.user_id = u.id
           )
         )
       )
      WHERE u.is_active = true
       UNION
       SELECT DISTINCT COALESCE(lc.dn, lc.username, lc.upn)::text AS id,
              lc.username,
              lc.display_name,
              lc.email,
              lc.office,
              'viewer'::text AS role,
              'ldap'::text AS auth_type
      FROM related_services is2
       JOIN services s ON s.id = is2.service_id
       JOIN LATERAL jsonb_array_elements(COALESCE(s.user_targets, '[]'::jsonb)) ot ON true
       JOIN ldap_users_cache lc ON (
         ot->>'type' = 'ldap_user'
         AND NULLIF(BTRIM(COALESCE(ot->>'dn', ot->>'id', '')), '') IS NOT NULL
         AND (
           LOWER(COALESCE(lc.dn, '')) = LOWER(NULLIF(BTRIM(COALESCE(ot->>'dn', ot->>'id', '')), ''))
           OR LOWER(COALESCE(lc.username, '')) = LOWER(NULLIF(BTRIM(COALESCE(ot->>'dn', ot->>'id', '')), ''))
           OR LOWER(COALESCE(lc.upn, '')) = LOWER(NULLIF(BTRIM(COALESCE(ot->>'dn', ot->>'id', '')), ''))
         )
       )
       UNION
       SELECT DISTINCT COALESCE(lc.dn, lc.username, lc.upn)::text AS id,
              lc.username,
              lc.display_name,
              lc.email,
              lc.office,
              'viewer'::text AS role,
              'ldap'::text AS auth_type
      FROM related_services is2
       JOIN services s ON s.id = is2.service_id
       JOIN LATERAL jsonb_array_elements(COALESCE(s.user_targets, '[]'::jsonb)) ot ON true
       JOIN ldap_users_cache lc ON (
         ot->>'type' = 'ldap_group'
         AND NULLIF(BTRIM(COALESCE(ot->>'dn', ot->>'id', '')), '') IS NOT NULL
         AND EXISTS (
           SELECT 1
           FROM jsonb_array_elements_text(COALESCE(lc.source_payload->'memberOf', lc.source_payload->'memberof', '[]'::jsonb)) m(dn)
           WHERE LOWER(m.dn) = LOWER(NULLIF(BTRIM(COALESCE(ot->>'dn', ot->>'id', '')), ''))
              OR SPLIT_PART(LOWER(m.dn), ',', 1) = SPLIT_PART(LOWER(NULLIF(BTRIM(COALESCE(ot->>'dn', ot->>'id', '')), '')), ',', 1)
         )
       )
       UNION
       SELECT DISTINCT COALESCE(lc.dn, lc.username, lc.upn)::text AS id,
              lc.username,
              lc.display_name,
              lc.email,
              lc.office,
              'viewer'::text AS role,
              'ldap'::text AS auth_type
      FROM related_services is2
       JOIN services s ON s.id = is2.service_id
       JOIN LATERAL jsonb_array_elements(COALESCE(s.user_targets, '[]'::jsonb)) ot ON true
       JOIN ldap_group_mappings lgm ON (
         ot->>'type' = 'local_group'
         AND (ot->>'id') ~* '^[0-9a-f-]{36}$'
         AND lgm.local_group_id = (ot->>'id')::uuid
       )
       JOIN ldap_users_cache lc ON EXISTS (
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
  const officesImpacted = [...new Set(rows.map((u) => String(u.office || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  res.json({ users: rows, offices_impacted: officesImpacted, offices_impacted_count: officesImpacted.length });
});

module.exports = router;
