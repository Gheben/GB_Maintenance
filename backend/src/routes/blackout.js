const { Router } = require('express');
const { body, validationResult } = require('express-validator');
const { requireAuthOrApiKey, requireChangeManager, requireAdmin } = require('../middleware/authMiddleware');
const { query, getOne, getMany } = require('../db/database');
const auditService = require('../services/auditService');
const { sendEmailNotification, sendInApp } = require('../services/notificationService');
const webpushService = require('../services/webpushService');
const logger = require('../utils/logger');
const { getAffectedAssets, getAffectedServices } = require('../utils/maintenanceScope');
const { getVisibleAffectedScope, PRIVILEGED_ROLES } = require('../utils/entityVisibility');

const router = Router();
router.use(requireAuthOrApiKey);

function affectedScopeTemplateVars(scope) {
  return {
    primary_assets: scope.assets.filter((asset) => asset.is_direct).map((asset) => asset.name).join(', ') || '-',
    affected_assets: scope.assets.map((asset) => asset.name).join(', ') || '-',
    primary_services: scope.services.filter((service) => service.is_direct).map((service) => service.name).join(', ') || '-',
    affected_services: scope.services.map((service) => service.name).join(', ') || '-',
  };
}

function visibleImpactedUsers(users, viewer) {
  if (PRIVILEGED_ROLES.has(viewer?.role)) return users;
  return users.filter((user) =>
    String(user.id || '') === String(viewer?.id || '')
    || (viewer?.email && String(user.email || '').toLowerCase() === String(viewer.email).toLowerCase())
  );
}

async function getImpactedUsersAndOffices(serviceIds = [], assetIds = []) {
  const directServiceIds = Array.isArray(serviceIds) ? serviceIds : [];
  const directAssetIds = Array.isArray(assetIds) ? assetIds : [];
  const [affectedAssets, affectedServices] = await Promise.all([
    getAffectedAssets(directAssetIds, directServiceIds),
    getAffectedServices(directAssetIds, directServiceIds),
  ]);
  const sids = affectedServices.map((service) => service.service_id);
  const aids = affectedAssets.map((asset) => asset.id);
  const users = await getMany(
    `WITH resolved_users AS (
       SELECT DISTINCT u.id::text AS id, u.username, u.display_name, u.email, u.office, u.role, u.auth_type
       FROM service_subscribers ss
       LEFT JOIN users u ON u.id = ss.user_id
       WHERE ss.service_id = ANY($1::uuid[]) AND u.id IS NOT NULL
       UNION
       SELECT DISTINCT u.id::text AS id, u.username, u.display_name, u.email, u.office, u.role, u.auth_type
       FROM assets a
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
       WHERE a.id = ANY($2::uuid[]) AND u.is_active = true
       UNION
       SELECT DISTINCT COALESCE(lc.dn, lc.username, lc.upn)::text AS id,
              lc.username,
              lc.display_name,
              lc.email,
              lc.office,
              'viewer'::text AS role,
              'ldap'::text AS auth_type
       FROM assets a
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
       WHERE a.id = ANY($2::uuid[])
       UNION
       SELECT DISTINCT COALESCE(lc.dn, lc.username, lc.upn)::text AS id,
              lc.username,
              lc.display_name,
              lc.email,
              lc.office,
              'viewer'::text AS role,
              'ldap'::text AS auth_type
       FROM assets a
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
       WHERE a.id = ANY($2::uuid[])
       UNION
       SELECT DISTINCT COALESCE(lc.dn, lc.username, lc.upn)::text AS id,
              lc.username,
              lc.display_name,
              lc.email,
              lc.office,
              'viewer'::text AS role,
              'ldap'::text AS auth_type
       FROM assets a
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
       WHERE a.id = ANY($2::uuid[]) AND lgm.ldap_group_dn IS NOT NULL AND BTRIM(lgm.ldap_group_dn) <> ''
       UNION
       SELECT DISTINCT u.id::text AS id, u.username, u.display_name, u.email, u.office, u.role, u.auth_type
       FROM services s
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
       WHERE s.id = ANY($1::uuid[]) AND u.is_active = true
       UNION
       SELECT DISTINCT COALESCE(lc.dn, lc.username, lc.upn)::text AS id,
              lc.username,
              lc.display_name,
              lc.email,
              lc.office,
              'viewer'::text AS role,
              'ldap'::text AS auth_type
       FROM services s
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
       WHERE s.id = ANY($1::uuid[])
       UNION
       SELECT DISTINCT COALESCE(lc.dn, lc.username, lc.upn)::text AS id,
              lc.username,
              lc.display_name,
              lc.email,
              lc.office,
              'viewer'::text AS role,
              'ldap'::text AS auth_type
       FROM services s
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
       WHERE s.id = ANY($1::uuid[])
       UNION
       SELECT DISTINCT COALESCE(lc.dn, lc.username, lc.upn)::text AS id,
              lc.username,
              lc.display_name,
              lc.email,
              lc.office,
              'viewer'::text AS role,
              'ldap'::text AS auth_type
       FROM services s
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
       WHERE s.id = ANY($1::uuid[]) AND lgm.ldap_group_dn IS NOT NULL AND BTRIM(lgm.ldap_group_dn) <> ''
     )
     SELECT DISTINCT id, username, display_name, email, office, role, auth_type
     FROM resolved_users
     ORDER BY display_name NULLS LAST, username`,
    [sids, aids]
  );
  const officesImpacted = [...new Set(users.map((u) => String(u.office || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return {
    users,
    affected_assets: affectedAssets,
    impacted_users_count: users.length,
    offices_impacted: officesImpacted,
    offices_impacted_count: officesImpacted.length,
  };
}

// ─── GET /api/blackout ────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const rows = await getMany(
    `SELECT bp.*, u.display_name as created_by_name FROM blackout_periods bp
     LEFT JOIN users u ON u.id=bp.created_by ORDER BY bp.start_date DESC`
  );
  for (const row of rows) {
    const sids = row.service_ids || [];
    const aids = row.asset_ids   || [];
    row.services = sids.length ? await getMany(`SELECT id, name FROM services WHERE id = ANY($1::uuid[])`, [sids]) : [];
    row.assets   = aids.length ? await getMany(`SELECT id, name, part_is_relevant FROM assets   WHERE id = ANY($1::uuid[])`, [aids]) : [];
    const impacted = await getImpactedUsersAndOffices(sids, aids);
    const affectedServices = await getAffectedServices(aids, sids);
    const visibleScope = await getVisibleAffectedScope(
      { userId: req.user.id, email: req.user.email, role: req.user.role },
      impacted.affected_assets,
      affectedServices
    );
    row.services = visibleScope.services.filter((service) => service.is_direct);
    row.assets = visibleScope.assets.filter((asset) => asset.is_direct);
    row.service_ids = row.services.map((service) => service.id);
    row.asset_ids = row.assets.map((asset) => asset.id);
    row.affected_assets = visibleScope.assets;
    row.affected_services = visibleScope.services;
    const visibleUsers = visibleImpactedUsers(impacted.users, req.user);
    row.impacted_users_count = visibleUsers.length;
    row.offices_impacted = [...new Set(visibleUsers.map((user) => String(user.office || '').trim()).filter(Boolean))];
    row.offices_impacted_count = row.offices_impacted.length;
  }
  res.json(rows);
});

// ─── GET /api/blackout/check ──────────────────────────────────────────────────
router.get('/check', async (req, res) => {
  const { start, end } = req.query;
  if (!start || !end) return res.status(400).json({ error: 'start and end are required' });
  const row = await getOne(
    `SELECT id, name FROM blackout_periods WHERE start_date <= $2 AND end_date >= $1`,
    [start, end]
  );
  res.json({ blocked: !!row, period: row || null });
});

// ─── GET /api/blackout/:id ────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  const row = await getOne(
    `SELECT bp.*, u.display_name as created_by_name FROM blackout_periods bp
     LEFT JOIN users u ON u.id=bp.created_by WHERE bp.id=$1`,
    [req.params.id]
  );
  if (!row) return res.status(404).json({ error: 'Period not found' });
  const impacted = await getImpactedUsersAndOffices(row.service_ids || [], row.asset_ids || []);
  const affectedServices = await getAffectedServices(row.asset_ids || [], row.service_ids || []);
  const visibleScope = await getVisibleAffectedScope(
    { userId: req.user.id, email: req.user.email, role: req.user.role },
    impacted.affected_assets,
    affectedServices
  );
  row.services = visibleScope.services.filter((service) => service.is_direct);
  row.assets = visibleScope.assets.filter((asset) => asset.is_direct);
  row.service_ids = row.services.map((service) => service.id);
  row.asset_ids = row.assets.map((asset) => asset.id);
  row.affected_assets = visibleScope.assets;
  row.affected_services = visibleScope.services;
  const visibleUsers = visibleImpactedUsers(impacted.users, req.user);
  row.impacted_users_count = visibleUsers.length;
  row.offices_impacted = [...new Set(visibleUsers.map((user) => String(user.office || '').trim()).filter(Boolean))];
  row.offices_impacted_count = row.offices_impacted.length;
  res.json(row);
});

// ─── POST /api/blackout ───────────────────────────────────────────────────────
router.post('/', requireChangeManager, [
  body('name').isString().trim().isLength({ min: 1, max: 200 }),
  body('start_date').isISO8601(),
  body('end_date').isISO8601(),
  body('description').optional().isString(),
  body('ticket_ref').optional().isString().isLength({ max: 100 }),
  body('service_ids').optional().isArray(),
  body('asset_ids').optional().isArray(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  if (new Date(req.body.end_date) <= new Date(req.body.start_date)) {
    return res.status(400).json({ error: 'end_date must be after start_date' });
  }
  const sids = req.body.service_ids || [];
  const aids = req.body.asset_ids || [];
  const result = await query(
    `INSERT INTO blackout_periods (name, description, ticket_ref, start_date, end_date, created_by, service_ids, asset_ids)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [req.body.name, req.body.description||null, req.body.ticket_ref||null, req.body.start_date, req.body.end_date, req.user.id, sids, aids]
  );
  await auditService.log(req.user.id, req.user.username, 'blackout:create', 'blackout_period', result.rows[0].id, req.body.name, req.ip);

  // Notify affected users (owners/subscribers of the impacted assets/services), non-blocking.
  (async () => {
    try {
      const impacted = await getImpactedUsersAndOffices(sids, aids);
      const affectedServiceIds = (await getAffectedServices(aids, sids)).map((service) => service.service_id);
      const emailSubscribers = affectedServiceIds.length > 0 ? await getMany(
        `SELECT email FROM service_subscribers
         WHERE service_id = ANY($1::uuid[]) AND NULLIF(BTRIM(email), '') IS NOT NULL`,
        [affectedServiceIds]
      ) : [];
      const emails = [...new Set([
        ...impacted.users.map((user) => String(user.email || '').trim()),
        ...emailSubscribers.map((subscriber) => String(subscriber.email || '').trim()),
      ].filter(Boolean))];
      // Local users only (LDAP-only entries have no local users.id to notify in-app/push).
      const userIds = [...new Set(
        impacted.users
          .filter((user) => user.auth_type !== 'ldap' && /^[0-9a-f-]{36}$/i.test(String(user.id || '')))
          .map((user) => user.id)
      )];
      if (emails.length > 0) {
        const affectedServices = await getAffectedServices(aids, sids);
        const scope = { assets: impacted.affected_assets, services: affectedServices };
        await sendEmailNotification('blackout_scheduled', emails, {
          id: result.rows[0].id,
          name: req.body.name,
          description: req.body.description || '-',
          start_date: new Date(req.body.start_date).toLocaleDateString('it-IT'),
          end_date: new Date(req.body.end_date).toLocaleDateString('it-IT'),
          ...affectedScopeTemplateVars(scope),
        }, 'blackout_period', result.rows[0].id, {
          varsForRecipient: async (email) => affectedScopeTemplateVars(
            await getVisibleAffectedScope({ email }, scope.assets, scope.services)
          ),
        });
        await query(`UPDATE blackout_periods SET notified_at=NOW() WHERE id=$1`, [result.rows[0].id]);
      }
      if (userIds.length > 0) {
        // No privileged deep-link exists for a single blackout period, so everyone lands on the
        // status page item — same destination the maintenance/incident notifications fall back to.
        const url = `/status?blackout=${result.rows[0].id}`;
        await Promise.all(userIds.map((uid) =>
          sendInApp(uid, 'blackout_scheduled', `Blackout period: ${req.body.name}`, req.body.description || '', 'blackout_period', result.rows[0].id)
        ));
        await Promise.all(userIds.map((uid) =>
          webpushService.sendToUser(uid, { title: `Blackout period: ${req.body.name}`, body: req.body.description || '', url })
            .catch((err) => logger.warn(`[Notifications] Web push failed for user ${uid}: ${err.message}`))
        ));
      }
    } catch { /* notification failures should not affect the API response */ }
  })();

  res.status(201).json({ id: result.rows[0].id });
});

// ─── PUT /api/blackout/:id ────────────────────────────────────────────────────
router.put('/:id', requireChangeManager, async (req, res) => {
  const allowed = ['name','description','ticket_ref','start_date','end_date'];
  const sets=[]; const vals=[]; let i=1;
  for (const f of allowed) {
    if (req.body[f] !== undefined) { sets.push(`${f}=$${i++}`); vals.push(req.body[f]); }
  }
  if (req.body.service_ids !== undefined) { sets.push(`service_ids=$${i++}`); vals.push(req.body.service_ids || []); }
  if (req.body.asset_ids   !== undefined) { sets.push(`asset_ids=$${i++}`);   vals.push(req.body.asset_ids   || []); }
  if (sets.length===0) return res.status(400).json({ error: 'No fields to update' });
  vals.push(req.params.id);
  await query(`UPDATE blackout_periods SET ${sets.join(',')} WHERE id=$${i}`, vals);
  res.json({ message: 'Period updated' });
});

// ─── DELETE /api/blackout/:id ─────────────────────────────────────────────────
router.delete('/:id', requireAdmin, async (req, res) => {
  await query('DELETE FROM blackout_periods WHERE id=$1', [req.params.id]);
  await auditService.log(req.user.id, req.user.username, 'blackout:delete', 'blackout_period', req.params.id, null, req.ip);
  res.json({ message: 'Period deleted' });
});

module.exports = router;
