const { Router } = require('express');
const { body, validationResult } = require('express-validator');
const crypto = require('crypto');
const { requireAuth, requireOperator, requireAdmin, requireChangeManager } = require('../middleware/authMiddleware');
const { query, getOne, getMany } = require('../db/database');
const auditService = require('../services/auditService');
const { notifyMaintenance, sendEmailNotification, sendInApp } = require('../services/notificationService');
const wsService = require('../services/wsService');
const { getMaintenanceAffectedAssets, getMaintenanceAffectedServices } = require('../utils/maintenanceScope');
const { getVisibleAffectedScope } = require('../utils/entityVisibility');

const router = Router();

const OWNER_APPROVAL_TOKEN_TTL_HOURS = 168;

function hashOwnerApprovalToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

const TYPES = ['planned','emergency','upgrade','security_patch','infrastructure','other'];
const STATUSES = ['draft','pending_approval','scheduled','in_progress','completed','cancelled','extended'];
const IMPACTS = ['critical','high','medium','low'];
const OWNER_APPROVAL_OWNER_ACTIONS = ['approve', 'reject', 'reschedule'];
const OWNER_APPROVAL_CREATOR_ACTIONS = ['accept', 'reject', 'counter_propose'];

function formatItDate(v) {
  if (!v) return '-';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('it-IT');
}

function isPrivilegedRole(role) {
  return ['superadmin', 'admin', 'change_manager'].includes(role);
}

function isCreatorDecisionUser(user, maintenanceRow) {
  return user?.id === maintenanceRow?.created_by || ['superadmin', 'admin', 'change_manager'].includes(user?.role);
}

async function getAppBaseUrl() {
  const row = await getOne("SELECT value FROM settings WHERE key='general_config'").catch(() => null);
  const cfg = row?.value ? JSON.parse(row.value || '{}') : {};
  const configured = String(cfg?.app_url || '').trim();
  if (configured) return configured.replace(/\/$/, '');
  return String(process.env.APP_URL || process.env.FRONTEND_URL || 'http://localhost:4681').replace(/\/$/, '');
}

async function appendMaintenanceStatusHistory(maintenanceId, status, changedBy, reason = null) {
  await query(
    `INSERT INTO status_history (entity_type, entity_id, status, changed_by, reason)
     VALUES ('maintenance', $1, $2, $3, $4)`,
    [maintenanceId, status, changedBy || 'system', reason || null]
  ).catch(() => {});
}

async function userCanAccessMaintenance(user, maintenanceId) {
  if (isPrivilegedRole(user.role)) return true;
  const directAccess = await getOne(
    `SELECT 1
     FROM maintenance_windows mw
     WHERE mw.id=$1 AND (
       mw.created_by=$2
       OR EXISTS (SELECT 1 FROM maintenance_status_subscribers mss WHERE mss.maintenance_id=mw.id AND mss.user_id=$2)
       OR EXISTS (SELECT 1 FROM maintenance_owner_approvals moa WHERE moa.maintenance_id=mw.id AND moa.owner_user_id=$2)
     )`,
    [maintenanceId, user.id]
  );
  if (directAccess) return true;

  const [affectedAssets, affectedServices] = await Promise.all([
    getMaintenanceAffectedAssets(maintenanceId),
    getMaintenanceAffectedServices(maintenanceId),
  ]);
  const visibleScope = await getVisibleAffectedScope(
    { userId: user.id, email: user.email, role: user.role },
    affectedAssets,
    affectedServices
  );
  const hasPrivateEntityAccess = visibleScope.assets.length > 0
    || visibleScope.services.some((service) => !service.is_public);
  if (hasPrivateEntityAccess) return true;

  const subscribedPublicService = await getOne(
    `SELECT 1
     FROM service_subscribers ss
     WHERE ss.user_id=$2
       AND ss.service_id=ANY($1::uuid[])
     LIMIT 1`,
    [visibleScope.services.map((service) => service.id), user.id]
  );
  return !!subscribedPublicService;
}

async function assetsIncludePartIsRelevant(assetIds = []) {
  const ids = (Array.isArray(assetIds) ? assetIds : []).filter(Boolean);
  if (ids.length === 0) return false;
  const row = await getOne(
    `SELECT 1 FROM assets WHERE id = ANY($1::uuid[]) AND part_is_relevant = true LIMIT 1`,
    [ids]
  );
  return !!row;
}

async function servicesIncludePartIsRelevant(serviceIds = []) {
  const ids = (Array.isArray(serviceIds) ? serviceIds : []).filter(Boolean);
  if (ids.length === 0) return false;
  const row = await getOne(
    `SELECT 1 FROM services WHERE id = ANY($1::uuid[]) AND part_is_relevant = true LIMIT 1`,
    [ids]
  );
  return !!row;
}

function normalizeMaintenanceLinks(assetIds = [], serviceIds = []) {
  return {
    asset_ids: [...new Set((Array.isArray(assetIds) ? assetIds : []).filter(Boolean))],
    service_ids: [...new Set((Array.isArray(serviceIds) ? serviceIds : []).filter(Boolean))],
  };
}

async function resolveMaintenanceOwnerApprovalTargets(maintenanceId) {
  return getMany(
    `SELECT DISTINCT t.owner_user_id, t.owner_email, t.owner_name, t.owner_source_type, t.owner_source_id, t.owner_source_name
     FROM (
       SELECT u.id AS owner_user_id, u.email AS owner_email, COALESCE(u.display_name, u.username) AS owner_name,
              'asset'::text AS owner_source_type, a.id AS owner_source_id, a.name AS owner_source_name
       FROM maintenance_assets ma
       JOIN assets a ON a.id=ma.asset_id
       JOIN users u ON u.id=a.owner_id
       WHERE ma.maintenance_id=$1 AND a.owner_type='user' AND a.owner_id IS NOT NULL AND u.is_active=true

       UNION

       SELECT u.id AS owner_user_id, u.email AS owner_email, COALESCE(u.display_name, u.username) AS owner_name,
              'asset'::text AS owner_source_type, a.id AS owner_source_id, a.name AS owner_source_name
       FROM maintenance_assets ma
       JOIN assets a ON a.id=ma.asset_id
       JOIN user_group_members ugm ON ugm.group_id=a.owner_group_id
       JOIN users u ON u.id=ugm.user_id
       WHERE ma.maintenance_id=$1 AND a.owner_type='local_group' AND a.owner_group_id IS NOT NULL AND u.is_active=true

       UNION

       SELECT u.id AS owner_user_id, u.email AS owner_email, COALESCE(u.display_name, u.username) AS owner_name,
              'asset'::text AS owner_source_type, a.id AS owner_source_id, a.name AS owner_source_name
       FROM maintenance_assets ma
       JOIN assets a ON a.id=ma.asset_id
       JOIN LATERAL jsonb_array_elements(COALESCE(a.owner_targets, '[]'::jsonb)) ot ON true
       JOIN users u ON (ot->>'type'='user' AND (ot->>'id') ~* '^[0-9a-f-]{36}$' AND u.id=(ot->>'id')::uuid)
       WHERE ma.maintenance_id=$1 AND u.is_active=true

       UNION

       SELECT u.id AS owner_user_id, u.email AS owner_email, COALESCE(u.display_name, u.username) AS owner_name,
              'service'::text AS owner_source_type, s.id AS owner_source_id, s.name AS owner_source_name
       FROM maintenance_services ms
       JOIN services s ON s.id=ms.service_id
       JOIN users u ON u.id=s.owner_id
       WHERE ms.maintenance_id=$1 AND s.owner_type='user' AND s.owner_id IS NOT NULL AND u.is_active=true

       UNION

       SELECT u.id AS owner_user_id, u.email AS owner_email, COALESCE(u.display_name, u.username) AS owner_name,
              'service'::text AS owner_source_type, s.id AS owner_source_id, s.name AS owner_source_name
       FROM maintenance_services ms
       JOIN services s ON s.id=ms.service_id
       JOIN user_group_members ugm ON ugm.group_id=s.owner_group_id
       JOIN users u ON u.id=ugm.user_id
       WHERE ms.maintenance_id=$1 AND s.owner_type='local_group' AND s.owner_group_id IS NOT NULL AND u.is_active=true

     ) t
     ORDER BY t.owner_name, t.owner_source_type, t.owner_source_name`,
    [maintenanceId]
  );
}

async function createOwnerApprovalRequests(maintenanceId) {
  const targets = await resolveMaintenanceOwnerApprovalTargets(maintenanceId);
  for (const t of targets) {
    await query(
      `INSERT INTO maintenance_owner_approvals
        (maintenance_id, owner_user_id, owner_email, owner_name, owner_source_type, owner_source_id, owner_source_name, status, requested_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',NOW(),NOW())
       ON CONFLICT (maintenance_id, owner_user_id, owner_source_type, owner_source_id)
       DO NOTHING`,
      [
        maintenanceId,
        t.owner_user_id,
        t.owner_email || null,
        t.owner_name || null,
        t.owner_source_type,
        t.owner_source_id,
        t.owner_source_name || null,
      ]
    );
  }
  return targets;
}

async function recomputeOwnerApprovalStatus(maintenanceId) {
  const maint = await getOne('SELECT owner_approval_required FROM maintenance_windows WHERE id=$1', [maintenanceId]);
  if (!maint) return 'not_required';

  if (!maint.owner_approval_required) {
    await query(
      `UPDATE maintenance_windows SET owner_approval_status='not_required', owner_approval_updated_at=NOW(), updated_at=NOW() WHERE id=$1`,
      [maintenanceId]
    );
    return 'not_required';
  }

  const agg = await getOne(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status IN ('pending','reschedule_proposed','counter_proposed'))::int AS waiting,
            COUNT(*) FILTER (WHERE status IN ('rejected','creator_rejected'))::int AS rejected
     FROM maintenance_owner_approvals
     WHERE maintenance_id=$1`,
    [maintenanceId]
  );

  let status = 'approved';
  if ((agg?.total || 0) === 0) status = 'approved';
  else if ((agg?.rejected || 0) > 0) status = 'rejected';
  else if ((agg?.waiting || 0) > 0) status = 'pending';

  await query(
    `UPDATE maintenance_windows SET owner_approval_status=$1, owner_approval_updated_at=NOW(), updated_at=NOW() WHERE id=$2`,
    [status, maintenanceId]
  );
  return status;
}

async function notifyOwnerApprovalRequested(maintenance, approvalRows, actorName) {
  if (!Array.isArray(approvalRows) || approvalRows.length === 0) return;
  const appUrl = await getAppBaseUrl();
  for (const row of approvalRows) {
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashOwnerApprovalToken(token);
    const expiresAt = new Date(Date.now() + OWNER_APPROVAL_TOKEN_TTL_HOURS * 60 * 60 * 1000);
    await query(
      `UPDATE maintenance_owner_approvals SET approval_token_hash=$1, approval_token_expires_at=$2, updated_at=NOW() WHERE id=$3`,
      [tokenHash, expiresAt.toISOString(), row.id]
    );
    const approvalUrl = `${appUrl}/maintenance/approval?token=${token}`;
    const msg = `Approval required for maintenance "${maintenance.title}" (${row.owner_source_type}: ${row.owner_source_name})`;
    const jobs = [
      sendInApp(row.owner_user_id, 'maintenance_owner_approval_requested', 'Maintenance approval requested', msg, 'maintenance', maintenance.id),
    ];
    if (row.owner_email) {
      jobs.push(sendEmailNotification(
        'maintenance_owner_approval_requested',
        [row.owner_email],
        {
          id: maintenance.id,
          title: maintenance.title,
          type: maintenance.type,
          impact_level: maintenance.impact_level,
          description: maintenance.description || '-',
          scheduled_start: formatItDate(maintenance.scheduled_start),
          scheduled_end: formatItDate(maintenance.scheduled_end),
          created_by_name: actorName || '-',
          owner_source_type: row.owner_source_type,
          owner_source_name: row.owner_source_name || '-',
          approval_url: approvalUrl,
          app_url: appUrl,
        },
        'maintenance',
        maintenance.id
      ).catch(() => {}));
    }
    await Promise.allSettled(jobs);
  }
}

async function getOwnerApprovalsForMaintenance(maintenanceId, user, creatorId) {
  const rows = await getMany(
    `SELECT moa.*, u.display_name AS owner_display_name, u.username AS owner_username
     FROM maintenance_owner_approvals moa
     LEFT JOIN users u ON u.id=moa.owner_user_id
     WHERE moa.maintenance_id=$1
     ORDER BY moa.created_at ASC`,
    [maintenanceId]
  );

  const canCreatorDecide = user.id === creatorId || ['superadmin', 'admin', 'change_manager'].includes(user.role);

  return rows.map(r => ({
    ...r,
    owner_label: r.owner_display_name || r.owner_name || r.owner_username || 'Owner',
    can_owner_respond: user.id === r.owner_user_id && ['pending', 'counter_proposed'].includes(r.status),
    can_creator_decide: canCreatorDecide && r.status === 'reschedule_proposed',
  }));
}

async function findOwnerApprovalByToken(token) {
  const tokenHash = hashOwnerApprovalToken(token);
  const row = await getOne(
    `SELECT moa.*, mw.title, mw.type, mw.impact_level, mw.description, mw.scheduled_start, mw.scheduled_end, mw.status AS maintenance_status
     FROM maintenance_owner_approvals moa
     JOIN maintenance_windows mw ON mw.id = moa.maintenance_id
     WHERE moa.approval_token_hash=$1`,
    [tokenHash]
  );
  if (!row) return { error: 'Approval link not found', status: 404 };
  if (!row.approval_token_expires_at || new Date(row.approval_token_expires_at).getTime() < Date.now()) {
    return { error: 'Approval link expired', status: 410 };
  }
  return { row };
}

// ─── Shared owner-response logic (used by both the authenticated and public token routes) ───
async function recordOwnerResponse({ approval, action, note, proposedStart, proposedEnd, actorName }) {
  if (!['pending', 'counter_proposed'].includes(approval.status)) {
    return { error: 'This request is not awaiting owner response', status: 400 };
  }
  if (action === 'reschedule') {
    if (!proposedStart || !proposedEnd) return { error: 'Proposed start/end are required', status: 400 };
    if (new Date(proposedEnd) <= new Date(proposedStart)) return { error: 'Proposed end must be after proposed start', status: 400 };
  }

  const nextStatus = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'reschedule_proposed';

  await query(
    `UPDATE maintenance_owner_approvals
     SET status=$1, response_note=$2, proposed_start=$3, proposed_end=$4, responded_at=NOW(), updated_at=NOW()
     WHERE id=$5`,
    [nextStatus, note, action === 'reschedule' ? proposedStart : null, action === 'reschedule' ? proposedEnd : null, approval.id]
  );

  const newOwnerStatus = await recomputeOwnerApprovalStatus(approval.maintenance_id);
  const maintenance = await getOne('SELECT * FROM maintenance_windows WHERE id=$1', [approval.maintenance_id]);
  const creator = maintenance?.created_by ? await getOne('SELECT id, email FROM users WHERE id=$1', [maintenance.created_by]) : null;

  if (creator?.id) {
    const inAppTitle = action === 'approve'
      ? `Owner approved maintenance: ${maintenance.title}`
      : action === 'reject'
        ? `Owner rejected maintenance: ${maintenance.title}`
        : `Owner proposed a new date: ${maintenance.title}`;
    const inAppMsg = action === 'reschedule'
      ? `${actorName} proposed ${formatItDate(proposedStart)} - ${formatItDate(proposedEnd)}`
      : (note || '');
    const jobs = [
      sendInApp(creator.id, `maintenance_owner_${action}`, inAppTitle, inAppMsg, 'maintenance', maintenance.id),
    ];
    if (action === 'reschedule' && creator.email) {
      jobs.push(sendEmailNotification(
        'maintenance_owner_reschedule_proposed',
        [creator.email],
        {
          id: maintenance.id,
          title: maintenance.title,
          owner_name: actorName,
          proposed_start: formatItDate(proposedStart),
          proposed_end: formatItDate(proposedEnd),
          response_note: note || '-',
        },
        'maintenance',
        maintenance.id
      ).catch(() => {}));
    }
    await Promise.allSettled(jobs);
  }

  return { newOwnerStatus };
}

// ─── PUBLIC (no login) owner approval routes — reached from the email link, mirrors licenses ───
router.get('/public/owner-approval', async (req, res) => {
  const token = String(req.query.token || '').trim();
  if (!token) return res.status(400).json({ error: 'Missing token' });
  const result = await findOwnerApprovalByToken(token);
  if (result.error) return res.status(result.status).json({ error: result.error });
  const row = result.row;
  res.json({
    id: row.id,
    maintenance_id: row.maintenance_id,
    title: row.title,
    type: row.type,
    impact_level: row.impact_level,
    description: row.description,
    scheduled_start: row.scheduled_start,
    scheduled_end: row.scheduled_end,
    owner_name: row.owner_name,
    owner_source_type: row.owner_source_type,
    owner_source_name: row.owner_source_name,
    status: row.status,
    proposed_start: row.proposed_start,
    proposed_end: row.proposed_end,
    creator_proposed_start: row.creator_proposed_start,
    creator_proposed_end: row.creator_proposed_end,
  });
});

router.post('/public/owner-approval/respond', [
  body('token').isString().trim().isLength({ min: 10 }),
  body('action').isIn(OWNER_APPROVAL_OWNER_ACTIONS),
  body('note').optional().isString().isLength({ max: 3000 }),
  body('proposed_start').optional().isISO8601(),
  body('proposed_end').optional().isISO8601(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const result = await findOwnerApprovalByToken(req.body.token);
  if (result.error) return res.status(result.status).json({ error: result.error });
  const approval = result.row;

  const outcome = await recordOwnerResponse({
    approval,
    action: req.body.action,
    note: req.body.note || null,
    proposedStart: req.body.proposed_start,
    proposedEnd: req.body.proposed_end,
    actorName: approval.owner_name || 'Owner',
  });
  if (outcome.error) return res.status(outcome.status).json({ error: outcome.error });

  await auditService.log(null, approval.owner_email || approval.owner_name || 'owner', `maintenance:owner_approval:${req.body.action}:public_token`, 'maintenance', approval.maintenance_id, req.body.note || null, req.ip);
  res.json({ message: 'Owner response recorded', owner_approval_status: outcome.newOwnerStatus });
});

router.use(requireAuth);

// ─── GET /api/maintenance ─────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const { status, type, impact_level, asset_id, from, to, page = 1, limit = 50, upcoming } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const params = []; let i = 1;
  const filters = [];

  if (status)       { filters.push(`mw.status=$${i++}`); params.push(status); }
  if (type)         { filters.push(`mw.type=$${i++}`); params.push(type); }
  if (impact_level) { filters.push(`mw.impact_level=$${i++}`); params.push(impact_level); }
  if (from)         { filters.push(`mw.scheduled_start >= $${i++}`); params.push(from); }
  if (to)           { filters.push(`mw.scheduled_end <= $${i++}`); params.push(to); }
  if (upcoming === 'true') { filters.push(`mw.scheduled_start > NOW() AND mw.status IN ('scheduled','draft','pending_approval')`); }
  if (asset_id) {
    filters.push(`mw.id IN (SELECT maintenance_id FROM maintenance_assets WHERE asset_id=$${i++})`);
    params.push(asset_id);
  }

  // Non-privileged users only see maintenances linked to their assets/services
  const privilegedRoles = ['superadmin', 'admin', 'change_manager'];
  if (!privilegedRoles.includes(req.user.role)) {
    filters.push(`mw.id IN (
      SELECT ma.maintenance_id FROM maintenance_assets ma
        INNER JOIN assets a ON a.id = ma.asset_id WHERE a.owner_id = $${i}
      UNION
      SELECT ma.maintenance_id FROM maintenance_assets ma
        INNER JOIN assets a ON a.id = ma.asset_id
        INNER JOIN LATERAL jsonb_array_elements(COALESCE(a.user_targets, '[]'::jsonb)) ot ON true
        WHERE (ot->>'type'='user' AND ot->>'id' = $${i}::text)
           OR (
            ot->>'type'='local_group'
            AND (ot->>'id') ~* '^[0-9a-f-]{36}$'
            AND EXISTS (SELECT 1 FROM user_group_members ugm WHERE ugm.group_id=(ot->>'id')::uuid AND ugm.user_id=$${i})
           )
      UNION
      SELECT ms.maintenance_id FROM maintenance_services ms
        INNER JOIN services s ON s.id = ms.service_id WHERE s.owner_id = $${i}
      UNION
      SELECT ms.maintenance_id FROM maintenance_services ms
        INNER JOIN services s ON s.id = ms.service_id
        INNER JOIN LATERAL jsonb_array_elements(COALESCE(s.user_targets, '[]'::jsonb)) ot ON true
        WHERE (ot->>'type'='user' AND ot->>'id' = $${i}::text)
           OR (
            ot->>'type'='local_group'
            AND (ot->>'id') ~* '^[0-9a-f-]{36}$'
            AND EXISTS (SELECT 1 FROM user_group_members ugm WHERE ugm.group_id=(ot->>'id')::uuid AND ugm.user_id=$${i})
           )
      UNION
      SELECT ms.maintenance_id FROM maintenance_services ms
        INNER JOIN service_subscribers ss ON ss.service_id = ms.service_id WHERE ss.user_id = $${i}
    )`);
    params.push(req.user.id); i++;
  }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const countRes = await query(`SELECT COUNT(*) FROM maintenance_windows mw ${where}`, params);
  const total = parseInt(countRes.rows[0].count);

  const rows = await getMany(
    `SELECT mw.*,
       u1.display_name as created_by_name,
       u2.display_name as approved_by_name,
       COALESCE(scope.asset_count, 0) as asset_count
     FROM maintenance_windows mw
     LEFT JOIN users u1 ON u1.id=mw.created_by
     LEFT JOIN users u2 ON u2.id=mw.approved_by
     LEFT JOIN LATERAL (
       SELECT COUNT(DISTINCT x.asset_id)::int AS asset_count
       FROM (
         SELECT ma.asset_id
         FROM maintenance_assets ma
         WHERE ma.maintenance_id=mw.id
         UNION
         SELECT sa.asset_id
         FROM maintenance_services ms
         JOIN service_assets sa ON sa.service_id=ms.service_id
         WHERE ms.maintenance_id=mw.id
       ) x
     ) scope ON TRUE
     ${where} ORDER BY mw.scheduled_start DESC LIMIT $${i++} OFFSET $${i}`,
    [...params, parseInt(limit), offset]
  );
  res.json({ data: rows, total, page: parseInt(page), limit: parseInt(limit) });
});

// ─── GET /api/maintenance/calendar ───────────────────────────────────────────
router.get('/calendar', async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'Parametri from e to richiesti' });

  const privilegedRoles = ['superadmin', 'admin', 'change_manager'];
  const params = [to, from];
  let visibilityClause = '';
  if (!privilegedRoles.includes(req.user.role)) {
    params.push(req.user.id);
    visibilityClause = `AND id IN (
      SELECT ma.maintenance_id FROM maintenance_assets ma
        INNER JOIN assets a ON a.id = ma.asset_id WHERE a.owner_id = $3
      UNION
      SELECT ma.maintenance_id FROM maintenance_assets ma
        INNER JOIN assets a ON a.id = ma.asset_id
        INNER JOIN LATERAL jsonb_array_elements(COALESCE(a.user_targets, '[]'::jsonb)) ot ON true
        WHERE (ot->>'type'='user' AND ot->>'id' = $3::text)
           OR (
            ot->>'type'='local_group'
            AND (ot->>'id') ~* '^[0-9a-f-]{36}$'
            AND EXISTS (SELECT 1 FROM user_group_members ugm WHERE ugm.group_id=(ot->>'id')::uuid AND ugm.user_id=$3)
           )
      UNION
      SELECT ms.maintenance_id FROM maintenance_services ms
        INNER JOIN services s ON s.id = ms.service_id WHERE s.owner_id = $3
      UNION
      SELECT ms.maintenance_id FROM maintenance_services ms
        INNER JOIN services s ON s.id = ms.service_id
        INNER JOIN LATERAL jsonb_array_elements(COALESCE(s.user_targets, '[]'::jsonb)) ot ON true
        WHERE (ot->>'type'='user' AND ot->>'id' = $3::text)
           OR (
            ot->>'type'='local_group'
            AND (ot->>'id') ~* '^[0-9a-f-]{36}$'
            AND EXISTS (SELECT 1 FROM user_group_members ugm WHERE ugm.group_id=(ot->>'id')::uuid AND ugm.user_id=$3)
           )
      UNION
      SELECT ms.maintenance_id FROM maintenance_services ms
        INNER JOIN service_subscribers ss ON ss.service_id = ms.service_id WHERE ss.user_id = $3
    )`;
  }

  const rows = await getMany(
    `SELECT id, title, type, status, impact_level, scheduled_start, scheduled_end
     FROM maintenance_windows
     WHERE scheduled_start < $1 AND scheduled_end > $2
       AND status NOT IN ('cancelled')
       ${visibilityClause}
     ORDER BY scheduled_start`,
    params
  );
  res.json(rows);
});

// ─── GET /api/maintenance/:id ─────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  const maint = await getOne(
    `SELECT mw.*,
       u1.display_name as created_by_name, u1.email as created_by_email,
       u2.display_name as approved_by_name,
       u3.id as reopened_by_user_id, u3.display_name as reopened_by_user_display_name, u3.email as reopened_by_user_email
     FROM maintenance_windows mw
     LEFT JOIN users u1 ON u1.id=mw.created_by
     LEFT JOIN users u2 ON u2.id=mw.approved_by
     LEFT JOIN users u3 ON u3.id=mw.reopened_by
     WHERE mw.id=$1`,
    [req.params.id]
  );
  if (!maint) return res.status(404).json({ error: 'Maintenance not found' });

  // Access control for non-privileged users
  if (!(await userCanAccessMaintenance(req.user, req.params.id))) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const [allAffectedAssets, allAffectedServices] = await Promise.all([
    getMaintenanceAffectedAssets(req.params.id),
    getMaintenanceAffectedServices(req.params.id),
  ]);
  const visibleScope = await getVisibleAffectedScope(
    { userId: req.user.id, email: req.user.email, role: req.user.role },
    allAffectedAssets,
    allAffectedServices
  );
  const assets = visibleScope.assets.filter((asset) => asset.is_direct);
  const affectedAssets = visibleScope.assets.filter((asset) => !asset.is_direct);
  const directServices = visibleScope.services.filter((service) => service.is_direct);
  const assetDerivedServices = visibleScope.services.filter((service) => !service.is_direct);

  const statusHistory = await getMany(
    `SELECT sh.id, sh.status, sh.changed_by, sh.reason, sh.created_at
     FROM status_history sh
     WHERE sh.entity_type='maintenance' AND sh.entity_id=$1
     ORDER BY sh.created_at ASC`,
    [req.params.id]
  ).catch(() => []);

  const response = { ...maint, assets, services: directServices, affectedServices: assetDerivedServices, affectedAssets, statusHistory };
  
  // Transform reopened_by_user data if exists
  if (maint.reopened_by_user_id) {
    response.reopened_by_user = {
      id: maint.reopened_by_user_id,
      display_name: maint.reopened_by_user_display_name,
      email: maint.reopened_by_user_email
    };
    delete response.reopened_by_user_id;
    delete response.reopened_by_user_display_name;
    delete response.reopened_by_user_email;
  }
  
  res.json(response);
});

// ─── GET /api/maintenance/:id/approval-status ───────────────────────────────
router.get('/:id/approval-status', async (req, res) => {
  const maint = await getOne(
    `SELECT mw.id, mw.title, mw.created_by, mw.owner_approval_required, mw.owner_approval_status, mw.owner_approval_updated_at,
            mw.scheduled_start, mw.scheduled_end,
            COALESCE(u.display_name, u.username) AS created_by_name
     FROM maintenance_windows mw
     LEFT JOIN users u ON u.id = mw.created_by
     WHERE mw.id=$1`,
    [req.params.id]
  );
  if (!maint) return res.status(404).json({ error: 'Maintenance not found' });
  if (!(await userCanAccessMaintenance(req.user, req.params.id))) return res.status(403).json({ error: 'Access denied' });

  const requests = await getOwnerApprovalsForMaintenance(req.params.id, req.user, maint.created_by);
  const summary = {
    total: requests.length,
    pending: requests.filter(r => ['pending', 'reschedule_proposed', 'counter_proposed'].includes(r.status)).length,
    approved: requests.filter(r => ['approved', 'creator_accepted'].includes(r.status)).length,
    rejected: requests.filter(r => ['rejected', 'creator_rejected'].includes(r.status)).length,
  };

  res.json({
    maintenance: maint,
    summary,
    requests,
    viewer: {
      is_creator: req.user.id === maint.created_by,
      role: req.user.role,
    }
  });
});

// ─── POST /api/maintenance ────────────────────────────────────────────────────
router.post('/', requireOperator, [
  body('title').isString().trim().isLength({ min: 1, max: 300 }),
  body('type').isIn(TYPES),
  body('impact_level').optional().isIn(IMPACTS),
  body('scheduled_start').isISO8601(),
  body('scheduled_end').isISO8601(),
  body('description').optional().isString(),
  body('asset_ids').optional().isArray(),
  body('service_ids').optional().isArray(),
  body('owner_approval_required').optional().isBoolean(),
  body('ticket_ref').optional().isString().isLength({ max: 100 }),
  body('recurrence_type').optional().isIn(['none','daily','weekly','monthly','custom']),
  body('recurrence_cron').optional().isString(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  if (new Date(req.body.scheduled_end) <= new Date(req.body.scheduled_start)) {
    return res.status(400).json({ error: 'La data di fine deve essere successiva a quella di inizio' });
  }

  // Check blackout periods
  const blackout = await getOne(
    `SELECT id, name FROM blackout_periods
     WHERE NOT (end_date < $1::date OR start_date > $2::date)`,
    [req.body.scheduled_start, req.body.scheduled_end]
  );
  if (blackout) {
    return res.status(400).json({ error: `Conflitto con periodo di blackout: ${blackout.name}` });
  }

  // Auto-set status: if high/critical impact or emergency → pending_approval, else → scheduled
  const needsApproval = ['critical','high'].includes(req.body.impact_level) || req.body.type === 'emergency';
  const status = needsApproval ? 'pending_approval' : 'scheduled';

  // Any Part-IS relevant asset in scope forces the owner approval flow, regardless of the request flag.
  const selectedLinks = normalizeMaintenanceLinks(req.body.asset_ids || [], req.body.service_ids || []);
  const partIsInvolved = await assetsIncludePartIsRelevant(selectedLinks.asset_ids)
    || await servicesIncludePartIsRelevant(selectedLinks.service_ids);
  const ownerApprovalRequired = req.body.owner_approval_required === true || partIsInvolved;
  const ownerApprovalStatus = ownerApprovalRequired ? 'pending' : 'not_required';

  const result = await query(
    `INSERT INTO maintenance_windows
       (title, description, ticket_ref, type, status, impact_level, scheduled_start, scheduled_end,
        recurrence_type, recurrence_cron, recurrence_end_date, created_by,
        owner_approval_required, owner_approval_status, owner_approval_updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
    [
      req.body.title, req.body.description || null, req.body.ticket_ref || null,
      req.body.type, status, req.body.impact_level || 'medium',
      req.body.scheduled_start, req.body.scheduled_end,
      req.body.recurrence_type || 'none',
      req.body.recurrence_cron || null,
      req.body.recurrence_end_date || null,
      req.user.id,
      ownerApprovalRequired,
      ownerApprovalStatus,
      ownerApprovalRequired ? new Date() : null,
    ]
  );
  const id = result.rows[0].id;

  // Persist only entities explicitly selected by the user.
  for (const aid of selectedLinks.asset_ids) {
    await query(`INSERT INTO maintenance_assets (maintenance_id, asset_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, aid]);
  }
  for (const sid of selectedLinks.service_ids) {
    await query(`INSERT INTO maintenance_services (maintenance_id, service_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, sid]);
  }

  await appendMaintenanceStatusHistory(id, status, req.user.username || req.user.id || 'system', 'Maintenance created');

  await auditService.log(req.user.id, req.user.username, 'maintenance:create', 'maintenance', id, req.body.title, req.ip, req.get('user-agent'));

  if (ownerApprovalRequired) {
    const maintenanceRow = await getOne('SELECT * FROM maintenance_windows WHERE id=$1', [id]);
    await createOwnerApprovalRequests(id);
    await recomputeOwnerApprovalStatus(id);
    const approvalRows = await getMany(`SELECT * FROM maintenance_owner_approvals WHERE maintenance_id=$1`, [id]);
    await notifyOwnerApprovalRequested(maintenanceRow, approvalRows, req.user.display_name || req.user.username || 'User').catch(() => {});
  }

  // Notify if scheduled
  if (status === 'scheduled') {
    await notifyMaintenance(id, 'maintenance_scheduled');
  }

  wsService.broadcast({ type: 'maintenance_created', id, status });
  res.status(201).json({ id, status });
});

// ─── POST /api/maintenance/:id/owner-approvals/:approvalId/respond ─────────
router.post('/:id/owner-approvals/:approvalId/respond', [
  body('action').isIn(OWNER_APPROVAL_OWNER_ACTIONS),
  body('note').optional().isString().isLength({ max: 3000 }),
  body('proposed_start').optional().isISO8601(),
  body('proposed_end').optional().isISO8601(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const maintenance = await getOne('SELECT * FROM maintenance_windows WHERE id=$1', [req.params.id]);
  if (!maintenance) return res.status(404).json({ error: 'Maintenance not found' });

  const approval = await getOne(
    `SELECT * FROM maintenance_owner_approvals WHERE id=$1 AND maintenance_id=$2`,
    [req.params.approvalId, req.params.id]
  );
  if (!approval) return res.status(404).json({ error: 'Approval request not found' });

  if (approval.owner_user_id !== req.user.id && !isPrivilegedRole(req.user.role)) {
    return res.status(403).json({ error: 'Only the owner can respond to this request' });
  }

  const outcome = await recordOwnerResponse({
    approval,
    action: req.body.action,
    note: req.body.note || null,
    proposedStart: req.body.proposed_start,
    proposedEnd: req.body.proposed_end,
    actorName: req.user.display_name || req.user.username || 'Owner',
  });
  if (outcome.error) return res.status(outcome.status).json({ error: outcome.error });

  await auditService.log(req.user.id, req.user.username, `maintenance:owner_approval:${req.body.action}`, 'maintenance', req.params.id, req.body.note || null, req.ip);
  res.json({ message: 'Owner response recorded', owner_approval_status: outcome.newOwnerStatus });
});

// ─── POST /api/maintenance/:id/owner-approvals/:approvalId/creator-decision ─
router.post('/:id/owner-approvals/:approvalId/creator-decision', [
  body('action').isIn(OWNER_APPROVAL_CREATOR_ACTIONS),
  body('note').optional().isString().isLength({ max: 3000 }),
  body('counter_start').optional().isISO8601(),
  body('counter_end').optional().isISO8601(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const maintenance = await getOne('SELECT * FROM maintenance_windows WHERE id=$1', [req.params.id]);
  if (!maintenance) return res.status(404).json({ error: 'Maintenance not found' });
  if (!isCreatorDecisionUser(req.user, maintenance)) {
    return res.status(403).json({ error: 'Only maintenance creator can decide this proposal' });
  }

  const approval = await getOne(
    `SELECT * FROM maintenance_owner_approvals WHERE id=$1 AND maintenance_id=$2`,
    [req.params.approvalId, req.params.id]
  );
  if (!approval) return res.status(404).json({ error: 'Approval request not found' });
  if (approval.status !== 'reschedule_proposed') {
    return res.status(400).json({ error: 'No owner reschedule proposal pending for this request' });
  }

  const action = req.body.action;
  const note = req.body.note || null;

  if (action === 'counter_propose') {
    if (!req.body.counter_start || !req.body.counter_end) {
      return res.status(400).json({ error: 'Counter proposal start/end are required' });
    }
    if (new Date(req.body.counter_end) <= new Date(req.body.counter_start)) {
      return res.status(400).json({ error: 'Counter proposal end must be after start' });
    }
  }

  const nextStatus = action === 'accept'
    ? 'creator_accepted'
    : action === 'reject'
      ? 'creator_rejected'
      : 'counter_proposed';

  await query(
    `UPDATE maintenance_owner_approvals
     SET status=$1,
         creator_response_note=$2,
         creator_proposed_start=$3,
         creator_proposed_end=$4,
         creator_responded_at=NOW(),
         updated_at=NOW()
     WHERE id=$5`,
    [
      nextStatus,
      note,
      action === 'counter_propose' ? req.body.counter_start : null,
      action === 'counter_propose' ? req.body.counter_end : null,
      approval.id,
    ]
  );

  if (action === 'accept') {
    await query(
      `UPDATE maintenance_windows
       SET scheduled_start=$1, scheduled_end=$2, updated_at=NOW()
       WHERE id=$3`,
      [approval.proposed_start, approval.proposed_end, req.params.id]
    );

    // A new date was agreed: every owner must sign off again, so reset all approval rows.
    await query(
      `UPDATE maintenance_owner_approvals
       SET status='pending', response_note=NULL, proposed_start=NULL, proposed_end=NULL,
           creator_response_note=NULL, creator_proposed_start=NULL, creator_proposed_end=NULL,
           responded_at=NULL, creator_responded_at=NULL, requested_at=NOW(), updated_at=NOW()
       WHERE maintenance_id=$1`,
      [req.params.id]
    );
  }

  const newOwnerStatus = await recomputeOwnerApprovalStatus(req.params.id);
  const owner = await getOne('SELECT id, email FROM users WHERE id=$1', [approval.owner_user_id]);

  if (action === 'accept') {
    const refreshedMaintenance = await getOne('SELECT * FROM maintenance_windows WHERE id=$1', [req.params.id]);
    const allApprovalRows = await getMany('SELECT * FROM maintenance_owner_approvals WHERE maintenance_id=$1', [req.params.id]);
    await notifyOwnerApprovalRequested(refreshedMaintenance, allApprovalRows, req.user.display_name || req.user.username || 'Creator').catch(() => {});
    await auditService.log(req.user.id, req.user.username, `maintenance:creator_decision:${action}`, 'maintenance', req.params.id, note, req.ip);
    return res.json({ message: 'Creator decision saved, all owners re-notified for the new date', owner_approval_status: newOwnerStatus });
  }

  if (owner?.id) {
    const title = action === 'reject'
      ? `Reschedule rejected by creator: ${maintenance.title}`
      : `Creator sent a counter proposal: ${maintenance.title}`;
    const jobs = [
      sendInApp(owner.id, `maintenance_creator_${action}`, title, note || '', 'maintenance', maintenance.id),
    ];
    if (action === 'counter_propose' && owner.email) {
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = hashOwnerApprovalToken(token);
      const expiresAt = new Date(Date.now() + OWNER_APPROVAL_TOKEN_TTL_HOURS * 60 * 60 * 1000);
      await query(
        `UPDATE maintenance_owner_approvals SET approval_token_hash=$1, approval_token_expires_at=$2, updated_at=NOW() WHERE id=$3`,
        [tokenHash, expiresAt.toISOString(), approval.id]
      );
      const appUrl = await getAppBaseUrl();
      jobs.push(sendEmailNotification(
        'maintenance_owner_reschedule_countered',
        [owner.email],
        {
          id: maintenance.id,
          title: maintenance.title,
          creator_proposed_start: formatItDate(req.body.counter_start),
          creator_proposed_end: formatItDate(req.body.counter_end),
          creator_response_note: note || '-',
          approval_url: `${appUrl}/maintenance/approval?token=${token}`,
        },
        'maintenance',
        maintenance.id
      ).catch(() => {}));
    }
    await Promise.allSettled(jobs);
  }

  await auditService.log(req.user.id, req.user.username, `maintenance:creator_decision:${action}`, 'maintenance', req.params.id, note, req.ip);
  res.json({ message: 'Creator decision saved', owner_approval_status: newOwnerStatus });
});

// ─── PUT /api/maintenance/:id ─────────────────────────────────────────────────
router.put('/:id', requireOperator, async (req, res) => {
  const maint = await getOne('SELECT * FROM maintenance_windows WHERE id=$1', [req.params.id]);
  if (!maint) return res.status(404).json({ error: 'Maintenance not found' });
  if (['completed','cancelled'].includes(maint.status)) {
    return res.status(400).json({ error: 'Non puoi modificare una manutenzione completata o annullata' });
  }

  const allowed = ['title','description','ticket_ref','type','impact_level','scheduled_start','scheduled_end',
    'recurrence_type','recurrence_cron','recurrence_end_date','notes'];
  const sets=[]; const vals=[]; let i=1;
  for (const f of allowed) {
    if (req.body[f] !== undefined) { sets.push(`${f}=$${i++}`); vals.push(req.body[f]); }
  }

  // Update linked assets/services with bidirectional correlation expansion.
  let partIsNewlyRequired = false;
  if (Array.isArray(req.body.asset_ids) || Array.isArray(req.body.service_ids)) {
    const currentAssetRows = await getMany('SELECT asset_id FROM maintenance_assets WHERE maintenance_id=$1', [req.params.id]);
    const currentServiceRows = await getMany('SELECT service_id FROM maintenance_services WHERE maintenance_id=$1', [req.params.id]);
    const nextAssetIds = Array.isArray(req.body.asset_ids) ? req.body.asset_ids : currentAssetRows.map(r => r.asset_id);
    const nextServiceIds = Array.isArray(req.body.service_ids) ? req.body.service_ids : currentServiceRows.map(r => r.service_id);
    const selectedLinks = normalizeMaintenanceLinks(nextAssetIds, nextServiceIds);

    await query('DELETE FROM maintenance_assets WHERE maintenance_id=$1', [req.params.id]);
    await query('DELETE FROM maintenance_services WHERE maintenance_id=$1', [req.params.id]);

    for (const aid of selectedLinks.asset_ids) {
      await query(`INSERT INTO maintenance_assets (maintenance_id, asset_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [req.params.id, aid]);
    }
    for (const sid of selectedLinks.service_ids) {
      await query(`INSERT INTO maintenance_services (maintenance_id, service_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [req.params.id, sid]);
    }

    // Adding a Part-IS relevant asset always forces the owner approval flow (never auto-disabled).
    if (!maint.owner_approval_required && (
      await assetsIncludePartIsRelevant(selectedLinks.asset_ids)
      || await servicesIncludePartIsRelevant(selectedLinks.service_ids)
    )) {
      partIsNewlyRequired = true;
      sets.push(`owner_approval_required=$${i++}`); vals.push(true);
      sets.push(`owner_approval_status=$${i++}`); vals.push('pending');
      sets.push(`owner_approval_updated_at=$${i++}`); vals.push(new Date());
    }
  }

  if (sets.length > 0) {
    sets.push(`updated_at=$${i++}`); vals.push(new Date()); vals.push(req.params.id);
    await query(`UPDATE maintenance_windows SET ${sets.join(',')} WHERE id=$${i}`, vals);
  }

  if (partIsNewlyRequired) {
    const maintenanceRow = await getOne('SELECT * FROM maintenance_windows WHERE id=$1', [req.params.id]);
    await createOwnerApprovalRequests(req.params.id);
    await recomputeOwnerApprovalStatus(req.params.id);
    const approvalRows = await getMany(`SELECT * FROM maintenance_owner_approvals WHERE maintenance_id=$1`, [req.params.id]);
    await notifyOwnerApprovalRequested(maintenanceRow, approvalRows, req.user.display_name || req.user.username || 'User').catch(() => {});
  }

  await auditService.log(req.user.id, req.user.username, 'maintenance:update', 'maintenance', req.params.id, null, req.ip, req.get('user-agent'));
  res.json({ message: 'Manutenzione aggiornata' });
});

// ─── POST /api/maintenance/:id/approve ───────────────────────────────────────
router.post('/:id/approve', requireChangeManager, async (req, res) => {
  const maint = await getOne('SELECT status FROM maintenance_windows WHERE id=$1', [req.params.id]);
  if (!maint) return res.status(404).json({ error: 'Non trovata' });
  if (maint.status !== 'pending_approval') return res.status(400).json({ error: 'Stato non valido per l\'approvazione' });

  await query(
    `UPDATE maintenance_windows SET status='scheduled', approved_by=$1, approved_at=NOW(), updated_at=NOW() WHERE id=$2`,
    [req.user.id, req.params.id]
  );
  await appendMaintenanceStatusHistory(req.params.id, 'scheduled', req.user.username || req.user.id || 'system', 'Approved and scheduled');
  await auditService.log(req.user.id, req.user.username, 'maintenance:approve', 'maintenance', req.params.id, null, req.ip);
  await notifyMaintenance(req.params.id, 'maintenance_scheduled');
  wsService.broadcast({ type: 'maintenance_approved', id: req.params.id });
  res.json({ message: 'Manutenzione approvata' });
});

// ─── POST /api/maintenance/:id/reject ────────────────────────────────────────
router.post('/:id/reject', requireChangeManager, [
  body('reason').isString().trim().isLength({ min: 1 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  await query(
    `UPDATE maintenance_windows SET status='cancelled', rejection_reason=$1, updated_at=NOW() WHERE id=$2`,
    [req.body.reason, req.params.id]
  );
  await appendMaintenanceStatusHistory(req.params.id, 'cancelled', req.user.username || req.user.id || 'system', req.body.reason || 'Rejected');
  await auditService.log(req.user.id, req.user.username, 'maintenance:reject', 'maintenance', req.params.id, req.body.reason, req.ip);
  await notifyMaintenance(req.params.id, 'maintenance_rejected', { reason: req.body.reason });
  wsService.broadcast({ type: 'maintenance_rejected', id: req.params.id });
  res.json({ message: 'Manutenzione rifiutata' });
});

// ─── POST /api/maintenance/:id/start ─────────────────────────────────────────
router.post('/:id/start', requireOperator, async (req, res) => {
  const maint = await getOne('SELECT status, owner_approval_required, owner_approval_status FROM maintenance_windows WHERE id=$1', [req.params.id]);
  if (!maint) return res.status(404).json({ error: 'Non trovata' });
  if (!['scheduled'].includes(maint.status)) return res.status(400).json({ error: 'Stato non valido' });
  if (maint.owner_approval_required && maint.owner_approval_status !== 'approved') {
    return res.status(400).json({ error: 'Owner approval flow is not completed yet' });
  }

  await query(`UPDATE maintenance_windows SET status='in_progress', actual_start=NOW(), updated_at=NOW() WHERE id=$1`, [req.params.id]);
  await appendMaintenanceStatusHistory(req.params.id, 'in_progress', req.user.username || req.user.id || 'system', 'Maintenance started');
  await notifyMaintenance(req.params.id, 'maintenance_started');
  wsService.broadcast({ type: 'maintenance_started', id: req.params.id });
  await auditService.log(req.user.id, req.user.username, 'maintenance:start', 'maintenance', req.params.id, null, req.ip);
  res.json({ message: 'Manutenzione avviata' });
});

// ─── POST /api/maintenance/:id/complete ───────────────────────────────────────
router.post('/:id/complete', requireOperator, [
  body('notes').optional().isString(),
], async (req, res) => {
  const maint = await getOne('SELECT id, title, status FROM maintenance_windows WHERE id=$1', [req.params.id]);
  if (!maint || !['in_progress','extended'].includes(maint.status)) {
    return res.status(400).json({ error: 'Stato non valido' });
  }
  await query(
    `UPDATE maintenance_windows SET status='completed', actual_end=NOW(), notes=$1, updated_at=NOW() WHERE id=$2`,
    [req.body.notes || null, req.params.id]
  );
  await appendMaintenanceStatusHistory(req.params.id, 'completed', req.user.username || req.user.id || 'system', req.body.notes || 'Maintenance completed');
  await sendInApp(
    req.user.id,
    'maintenance_completed',
    `Maintenance Completed: ${maint.title}`,
    req.body.notes || 'Maintenance completed',
    'maintenance',
    req.params.id
  ).catch(() => {});
  wsService.broadcast({ type: 'maintenance_completed', id: req.params.id });
  await auditService.log(req.user.id, req.user.username, 'maintenance:complete', 'maintenance', req.params.id, null, req.ip);
  res.json({ message: 'Manutenzione completata' });

  // Do not block API response on email delivery.
  notifyMaintenance(req.params.id, 'maintenance_completed').catch(() => {});
});

// ─── POST /api/maintenance/:id/reopen ───────────────────────────────────────
router.post('/:id/reopen', requireOperator, [
  body('reason').trim().isLength({ min: 10 }).withMessage('Reopen reason must be at least 10 characters'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const maint = await getOne('SELECT id, title, status, reopen_count FROM maintenance_windows WHERE id=$1', [req.params.id]);
  if (!maint) return res.status(404).json({ error: 'Maintenance not found' });
  if (maint.status !== 'completed') {
    return res.status(400).json({ error: 'Only completed maintenance can be reopened' });
  }

  await query(
    `UPDATE maintenance_windows
     SET status='in_progress',
         actual_end=NULL,
         actual_start=NOW(),
         reopened_at=NOW(),
         reopened_by=$1,
         reopen_reason=$2,
         reopen_count=COALESCE(reopen_count, 0) + 1,
         updated_at=NOW()
     WHERE id=$3`,
    [req.user.id, req.body.reason, req.params.id]
  );

  await appendMaintenanceStatusHistory(req.params.id, 'reopened', req.user.username || req.user.id || 'system', req.body.reason);
  await appendMaintenanceStatusHistory(req.params.id, 'in_progress', req.user.username || req.user.id || 'system', 'Maintenance reopened');
  await sendInApp(
    req.user.id,
    'maintenance_reopened',
    `Maintenance Reopened: ${maint.title}`,
    req.body.reason,
    'maintenance',
    req.params.id
  ).catch(() => {});
  wsService.broadcast({ type: 'maintenance_reopened', id: req.params.id });
  await auditService.log(req.user.id, req.user.username, 'maintenance:reopen', 'maintenance', req.params.id, req.body.reason, req.ip);
  res.json({ message: 'Maintenance reopened' });

  // Do not block API response on email delivery.
  notifyMaintenance(req.params.id, 'maintenance_reopened', {
    reopen_reason: req.body.reason,
    reopened_at: formatItDate(new Date()),
  }).catch(() => {});
});

// ─── POST /api/maintenance/:id/cancel ────────────────────────────────────────
router.post('/:id/cancel', requireOperator, [
  body('reason').trim().isLength({ min: 10 }).withMessage('Cancellation reason must be at least 10 characters'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const maint = await getOne('SELECT id, title, status FROM maintenance_windows WHERE id=$1', [req.params.id]);
  if (!maint) return res.status(404).json({ error: 'Maintenance not found' });
  if (!['scheduled','in_progress','pending_approval'].includes(maint.status)) {
    return res.status(400).json({ error: 'Can only cancel scheduled, pending approval, or in-progress maintenance' });
  }

  // Store cancellation reason in rejection_reason field
  await query(
    `UPDATE maintenance_windows SET status='cancelled', rejection_reason=$1, updated_at=NOW() WHERE id=$2`,
    [req.body.reason, req.params.id]
  );
  await appendMaintenanceStatusHistory(req.params.id, 'cancelled', req.user.username || req.user.id || 'system', req.body.reason);

  // Notify maintenance creator and subscribers about cancellation
  await notifyMaintenance(req.params.id, 'maintenance_cancelled', { reason: req.body.reason });
  wsService.broadcast({ type: 'maintenance_cancelled', id: req.params.id });
  
  // Audit log with reason
  await auditService.log(req.user.id, req.user.username, 'maintenance:cancelled_with_reason', 'maintenance', req.params.id, req.body.reason, req.ip);
  res.json({ message: 'Manutenzione annullata' });
});

// ─── DELETE /api/maintenance/:id ─────────────────────────────────────────────
router.delete('/:id', requireAdmin, [
  body('cancellation_reason').optional().trim(),
], async (req, res) => {
  const maint = await getOne(
    'SELECT id, title, status FROM maintenance_windows WHERE id=$1',
    [req.params.id]
  );
  if (!maint) return res.status(404).json({ error: 'Maintenance not found' });

  // If in_progress or scheduled, require cancellation reason and notify subscribers
  if (['in_progress', 'scheduled'].includes(maint.status)) {
    if (!req.body.cancellation_reason || !req.body.cancellation_reason.trim()) {
      return res.status(400).json({ error: 'Cancellation reason is required when deleting in-progress or scheduled maintenance' });
    }
    
    // Notify subscribers about cancellation
    await notifyMaintenance(req.params.id, 'maintenance_cancelled', { 
      reason: req.body.cancellation_reason,
      deleted: true 
    });
  }

  // Delete the maintenance record
  await query('DELETE FROM maintenance_windows WHERE id=$1', [req.params.id]);
  
  // Audit log
  const auditReason = maint.status === 'in_progress' || maint.status === 'scheduled' 
    ? `Deleted with reason: ${req.body.cancellation_reason}`
    : 'Deleted';
  await auditService.log(req.user.id, req.user.username, 'maintenance:deleted', 'maintenance', req.params.id, auditReason, req.ip);
  
  res.json({ message: 'Manutenzione eliminata' });
});

// ─── GET /api/maintenance/:id/users ──────────────────────────────────────────
router.get('/:id/users', async (req, res) => {
  const rows = await getMany(
    `WITH related_services AS (
       SELECT service_id FROM maintenance_services WHERE maintenance_id=$1
       UNION
       SELECT sa.service_id
       FROM maintenance_assets ma
       JOIN service_assets sa ON sa.asset_id=ma.asset_id
       WHERE ma.maintenance_id=$1
     ), scope_assets AS (
       SELECT asset_id FROM maintenance_assets WHERE maintenance_id=$1
       UNION
       SELECT sa.asset_id FROM service_assets sa
       WHERE sa.service_id IN (SELECT service_id FROM related_services)
     ), resolved_users AS (
       SELECT DISTINCT u.id::text AS id, u.username, u.display_name, u.email, u.office, u.role, u.auth_type
       FROM service_subscribers ss
       JOIN maintenance_services ms ON ms.service_id = ss.service_id
       LEFT JOIN users u ON u.id = ss.user_id
       WHERE ms.maintenance_id = $1 AND u.id IS NOT NULL
       UNION
       SELECT DISTINCT u.id::text AS id, u.username, u.display_name, u.email, u.office, u.role, u.auth_type
       FROM service_subscribers ss
       JOIN service_assets sa ON sa.service_id = ss.service_id
       JOIN maintenance_assets ma ON ma.asset_id = sa.asset_id
       LEFT JOIN users u ON u.id = ss.user_id
       WHERE ma.maintenance_id = $1 AND u.id IS NOT NULL
       UNION
       SELECT DISTINCT u.id::text AS id, u.username, u.display_name, u.email, u.office, u.role, u.auth_type
      FROM scope_assets ma
       JOIN assets a ON a.id = ma.asset_id
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
      FROM scope_assets ma
       JOIN assets a ON a.id = ma.asset_id
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
      WHERE TRUE
       UNION
       SELECT DISTINCT COALESCE(lc.dn, lc.username, lc.upn)::text AS id,
              lc.username,
              lc.display_name,
              lc.email,
              lc.office,
              'viewer'::text AS role,
              'ldap'::text AS auth_type
      FROM scope_assets ma
       JOIN assets a ON a.id = ma.asset_id
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
      WHERE TRUE
       UNION
       SELECT DISTINCT COALESCE(lc.dn, lc.username, lc.upn)::text AS id,
              lc.username,
              lc.display_name,
              lc.email,
              lc.office,
              'viewer'::text AS role,
              'ldap'::text AS auth_type
      FROM scope_assets ma
       JOIN assets a ON a.id = ma.asset_id
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
       FROM maintenance_services ms
       JOIN services s ON s.id = ms.service_id
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
       WHERE ms.maintenance_id = $1 AND u.is_active = true
       UNION
       SELECT DISTINCT COALESCE(lc.dn, lc.username, lc.upn)::text AS id,
              lc.username,
              lc.display_name,
              lc.email,
              lc.office,
              'viewer'::text AS role,
              'ldap'::text AS auth_type
       FROM maintenance_services ms
       JOIN services s ON s.id = ms.service_id
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
       WHERE ms.maintenance_id = $1
       UNION
       SELECT DISTINCT COALESCE(lc.dn, lc.username, lc.upn)::text AS id,
              lc.username,
              lc.display_name,
              lc.email,
              lc.office,
              'viewer'::text AS role,
              'ldap'::text AS auth_type
       FROM maintenance_services ms
       JOIN services s ON s.id = ms.service_id
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
       WHERE ms.maintenance_id = $1
       UNION
       SELECT DISTINCT COALESCE(lc.dn, lc.username, lc.upn)::text AS id,
              lc.username,
              lc.display_name,
              lc.email,
              lc.office,
              'viewer'::text AS role,
              'ldap'::text AS auth_type
       FROM maintenance_services ms
       JOIN services s ON s.id = ms.service_id
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
       WHERE ms.maintenance_id = $1 AND lgm.ldap_group_dn IS NOT NULL AND BTRIM(lgm.ldap_group_dn) <> ''
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
