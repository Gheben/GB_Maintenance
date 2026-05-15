const { Router } = require('express');
const { body, validationResult } = require('express-validator');
const { requireAuth, requireOperator, requireAdmin, requireChangeManager } = require('../middleware/authMiddleware');
const { query, getOne, getMany } = require('../db/database');
const auditService = require('../services/auditService');
const { notifyMaintenance, sendEmailNotification, sendInApp } = require('../services/notificationService');
const wsService = require('../services/wsService');

const router = Router();
router.use(requireAuth);

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

async function userCanAccessMaintenance(user, maintenanceId) {
  if (isPrivilegedRole(user.role)) return true;
  const accessible = await getOne(
    `SELECT 1 FROM maintenance_windows mw WHERE mw.id=$1 AND (
      EXISTS(SELECT 1 FROM maintenance_assets ma JOIN assets a ON a.id=ma.asset_id WHERE ma.maintenance_id=mw.id AND a.owner_id=$2)
      OR EXISTS(SELECT 1 FROM maintenance_assets ma JOIN assets a ON a.id=ma.asset_id JOIN user_group_members ugm ON ugm.group_id=a.owner_group_id WHERE ma.maintenance_id=mw.id AND ugm.user_id=$2)
      OR EXISTS(SELECT 1 FROM maintenance_services ms JOIN services s ON s.id=ms.service_id WHERE ms.maintenance_id=mw.id AND s.owner_id=$2)
      OR EXISTS(SELECT 1 FROM maintenance_services ms JOIN services s ON s.id=ms.service_id JOIN user_group_members ugm ON ugm.group_id=s.owner_group_id WHERE ms.maintenance_id=mw.id AND ugm.user_id=$2)
      OR EXISTS(SELECT 1 FROM maintenance_services ms JOIN service_subscribers ss ON ss.service_id=ms.service_id WHERE ms.maintenance_id=mw.id AND ss.user_id=$2)
      OR EXISTS(SELECT 1 FROM maintenance_owner_approvals moa WHERE moa.maintenance_id=mw.id AND moa.owner_user_id=$2)
    )`,
    [maintenanceId, user.id]
  );
  return !!accessible;
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

async function notifyOwnerApprovalRequested(maintenance, targets, actorName) {
  if (!Array.isArray(targets) || targets.length === 0) return;
  const appUrl = await getAppBaseUrl();
  for (const t of targets) {
    const msg = `Approval required for maintenance "${maintenance.title}" (${t.owner_source_type}: ${t.owner_source_name})`;
    await sendInApp(t.owner_user_id, 'maintenance_owner_approval_requested', 'Maintenance approval requested', msg, 'maintenance', maintenance.id);
    if (t.owner_email) {
      await sendEmailNotification(
        'maintenance_owner_approval_requested',
        [t.owner_email],
        {
          id: maintenance.id,
          title: maintenance.title,
          type: maintenance.type,
          impact_level: maintenance.impact_level,
          description: maintenance.description || '-',
          scheduled_start: formatItDate(maintenance.scheduled_start),
          scheduled_end: formatItDate(maintenance.scheduled_end),
          created_by_name: actorName || '-',
          owner_source_type: t.owner_source_type,
          owner_source_name: t.owner_source_name || '-',
          app_url: appUrl,
        },
        'maintenance',
        maintenance.id
      ).catch(() => {});
    }
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
      SELECT ms.maintenance_id FROM maintenance_services ms
        INNER JOIN services s ON s.id = ms.service_id WHERE s.owner_id = $${i}
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
       (SELECT COUNT(*)::int FROM maintenance_assets ma WHERE ma.maintenance_id=mw.id) as asset_count
     FROM maintenance_windows mw
     LEFT JOIN users u1 ON u1.id=mw.created_by
     LEFT JOIN users u2 ON u2.id=mw.approved_by
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
      SELECT ms.maintenance_id FROM maintenance_services ms
        INNER JOIN services s ON s.id = ms.service_id WHERE s.owner_id = $3
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
       u2.display_name as approved_by_name
     FROM maintenance_windows mw
     LEFT JOIN users u1 ON u1.id=mw.created_by
     LEFT JOIN users u2 ON u2.id=mw.approved_by
     WHERE mw.id=$1`,
    [req.params.id]
  );
  if (!maint) return res.status(404).json({ error: 'Manutenzione non trovata' });

  // Access control for non-privileged users
  if (!(await userCanAccessMaintenance(req.user, req.params.id))) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const assets = await getMany(
    `SELECT a.id, a.name, a.category, a.status, a.criticality
     FROM assets a JOIN maintenance_assets ma ON ma.asset_id=a.id WHERE ma.maintenance_id=$1`,
    [req.params.id]
  );

  // Directly linked services
  const directServices = await getMany(
    `SELECT s.id, s.name, s.status, s.criticality
     FROM services s JOIN maintenance_services ms ON ms.service_id=s.id WHERE ms.maintenance_id=$1`,
    [req.params.id]
  );

  // Also derive affected services via asset links
  const assetIds = assets.map(a => a.id);
  let assetDerivedServices = [];
  if (assetIds.length > 0) {
    assetDerivedServices = await getMany(
      `SELECT DISTINCT s.id, s.name, s.status, s.criticality
       FROM services s JOIN service_assets sa ON sa.service_id=s.id
       WHERE sa.asset_id=ANY($1::uuid[])
         AND s.id NOT IN (SELECT service_id FROM maintenance_services WHERE maintenance_id=$2)`,
      [assetIds, req.params.id]
    );
  }

  res.json({ ...maint, assets, services: directServices, affectedServices: assetDerivedServices });
});

// ─── GET /api/maintenance/:id/approval-status ───────────────────────────────
router.get('/:id/approval-status', async (req, res) => {
  const maint = await getOne(
    `SELECT id, title, created_by, owner_approval_required, owner_approval_status, owner_approval_updated_at,
            scheduled_start, scheduled_end
     FROM maintenance_windows WHERE id=$1`,
    [req.params.id]
  );
  if (!maint) return res.status(404).json({ error: 'Manutenzione non trovata' });
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
  const ownerApprovalRequired = req.body.owner_approval_required === true;
  const ownerApprovalStatus = ownerApprovalRequired ? 'pending' : 'not_required';

  const result = await query(
    `INSERT INTO maintenance_windows
       (title, description, type, status, impact_level, scheduled_start, scheduled_end,
        recurrence_type, recurrence_cron, recurrence_end_date, created_by,
        owner_approval_required, owner_approval_status, owner_approval_updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [
      req.body.title, req.body.description || null,
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

  // Link assets
  if (Array.isArray(req.body.asset_ids)) {
    for (const aid of req.body.asset_ids) {
      await query(`INSERT INTO maintenance_assets (maintenance_id, asset_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, aid]);
    }
  }

  // Link services directly
  if (Array.isArray(req.body.service_ids)) {
    for (const sid of req.body.service_ids) {
      await query(`INSERT INTO maintenance_services (maintenance_id, service_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, sid]);
    }
  }

  await auditService.log(req.user.id, req.user.username, 'maintenance:create', 'maintenance', id, req.body.title, req.ip, req.get('user-agent'));

  if (ownerApprovalRequired) {
    const maintenanceRow = await getOne('SELECT * FROM maintenance_windows WHERE id=$1', [id]);
    const targets = await createOwnerApprovalRequests(id);
    await recomputeOwnerApprovalStatus(id);
    await notifyOwnerApprovalRequested(maintenanceRow, targets, req.user.display_name || req.user.username || 'User').catch(() => {});
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
  if (!maintenance) return res.status(404).json({ error: 'Manutenzione non trovata' });

  const approval = await getOne(
    `SELECT * FROM maintenance_owner_approvals WHERE id=$1 AND maintenance_id=$2`,
    [req.params.approvalId, req.params.id]
  );
  if (!approval) return res.status(404).json({ error: 'Approval request not found' });

  if (approval.owner_user_id !== req.user.id && !isPrivilegedRole(req.user.role)) {
    return res.status(403).json({ error: 'Only the owner can respond to this request' });
  }

  if (!['pending', 'counter_proposed'].includes(approval.status)) {
    return res.status(400).json({ error: 'This request is not awaiting owner response' });
  }

  const action = req.body.action;
  const note = req.body.note || null;

  if (action === 'reschedule') {
    if (!req.body.proposed_start || !req.body.proposed_end) {
      return res.status(400).json({ error: 'Proposed start/end are required' });
    }
    if (new Date(req.body.proposed_end) <= new Date(req.body.proposed_start)) {
      return res.status(400).json({ error: 'Proposed end must be after proposed start' });
    }
  }

  const nextStatus = action === 'approve'
    ? 'approved'
    : action === 'reject'
      ? 'rejected'
      : 'reschedule_proposed';

  await query(
    `UPDATE maintenance_owner_approvals
     SET status=$1,
         response_note=$2,
         proposed_start=$3,
         proposed_end=$4,
         responded_at=NOW(),
         updated_at=NOW()
     WHERE id=$5`,
    [
      nextStatus,
      note,
      action === 'reschedule' ? req.body.proposed_start : null,
      action === 'reschedule' ? req.body.proposed_end : null,
      approval.id,
    ]
  );

  const newOwnerStatus = await recomputeOwnerApprovalStatus(req.params.id);

  const creator = maintenance.created_by ? await getOne('SELECT id, email, display_name, username FROM users WHERE id=$1', [maintenance.created_by]) : null;
  const actorName = req.user.display_name || req.user.username || 'Owner';

  if (creator?.id) {
    const inAppTitle = action === 'approve'
      ? `Owner approved maintenance: ${maintenance.title}`
      : action === 'reject'
        ? `Owner rejected maintenance: ${maintenance.title}`
        : `Owner proposed a new date: ${maintenance.title}`;
    const inAppMsg = action === 'reschedule'
      ? `${actorName} proposed ${formatItDate(req.body.proposed_start)} - ${formatItDate(req.body.proposed_end)}`
      : (note || '');
    await sendInApp(creator.id, `maintenance_owner_${action}`, inAppTitle, inAppMsg, 'maintenance', maintenance.id);

    if (creator.email) {
      if (action === 'reschedule') {
        await sendEmailNotification(
          'maintenance_owner_reschedule_proposed',
          [creator.email],
          {
            id: maintenance.id,
            title: maintenance.title,
            owner_name: actorName,
            proposed_start: formatItDate(req.body.proposed_start),
            proposed_end: formatItDate(req.body.proposed_end),
            response_note: note || '-',
          },
          'maintenance',
          maintenance.id
        ).catch(() => {});
      }
    }
  }

  await auditService.log(req.user.id, req.user.username, `maintenance:owner_approval:${action}`, 'maintenance', req.params.id, note, req.ip);
  res.json({ message: 'Owner response recorded', owner_approval_status: newOwnerStatus });
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
  if (!maintenance) return res.status(404).json({ error: 'Manutenzione non trovata' });
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
  }

  const newOwnerStatus = await recomputeOwnerApprovalStatus(req.params.id);
  const owner = await getOne('SELECT id, email FROM users WHERE id=$1', [approval.owner_user_id]);
  if (owner?.id) {
    const title = action === 'accept'
      ? `Reschedule approved by creator: ${maintenance.title}`
      : action === 'reject'
        ? `Reschedule rejected by creator: ${maintenance.title}`
        : `Creator sent a counter proposal: ${maintenance.title}`;
    await sendInApp(owner.id, `maintenance_creator_${action}`, title, note || '', 'maintenance', maintenance.id);

    if (action === 'counter_propose' && owner.email) {
      await sendEmailNotification(
        'maintenance_owner_reschedule_countered',
        [owner.email],
        {
          id: maintenance.id,
          title: maintenance.title,
          creator_proposed_start: formatItDate(req.body.counter_start),
          creator_proposed_end: formatItDate(req.body.counter_end),
          creator_response_note: note || '-',
        },
        'maintenance',
        maintenance.id
      ).catch(() => {});
    }
  }

  await auditService.log(req.user.id, req.user.username, `maintenance:creator_decision:${action}`, 'maintenance', req.params.id, note, req.ip);
  res.json({ message: 'Creator decision saved', owner_approval_status: newOwnerStatus });
});

// ─── PUT /api/maintenance/:id ─────────────────────────────────────────────────
router.put('/:id', requireOperator, async (req, res) => {
  const maint = await getOne('SELECT * FROM maintenance_windows WHERE id=$1', [req.params.id]);
  if (!maint) return res.status(404).json({ error: 'Manutenzione non trovata' });
  if (['completed','cancelled'].includes(maint.status)) {
    return res.status(400).json({ error: 'Non puoi modificare una manutenzione completata o annullata' });
  }

  const allowed = ['title','description','type','impact_level','scheduled_start','scheduled_end',
    'recurrence_type','recurrence_cron','recurrence_end_date','notes'];
  const sets=[]; const vals=[]; let i=1;
  for (const f of allowed) {
    if (req.body[f] !== undefined) { sets.push(`${f}=$${i++}`); vals.push(req.body[f]); }
  }

  // Update linked assets
  if (Array.isArray(req.body.asset_ids)) {
    await query('DELETE FROM maintenance_assets WHERE maintenance_id=$1', [req.params.id]);
    for (const aid of req.body.asset_ids) {
      await query(`INSERT INTO maintenance_assets (maintenance_id, asset_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [req.params.id, aid]);
    }
  }

  // Update linked services
  if (Array.isArray(req.body.service_ids)) {
    await query('DELETE FROM maintenance_services WHERE maintenance_id=$1', [req.params.id]);
    for (const sid of req.body.service_ids) {
      await query(`INSERT INTO maintenance_services (maintenance_id, service_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [req.params.id, sid]);
    }
  }

  if (sets.length > 0) {
    sets.push(`updated_at=$${i++}`); vals.push(new Date()); vals.push(req.params.id);
    await query(`UPDATE maintenance_windows SET ${sets.join(',')} WHERE id=$${i}`, vals);
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
  await notifyMaintenance(req.params.id, 'maintenance_started');
  wsService.broadcast({ type: 'maintenance_started', id: req.params.id });
  await auditService.log(req.user.id, req.user.username, 'maintenance:start', 'maintenance', req.params.id, null, req.ip);
  res.json({ message: 'Manutenzione avviata' });
});

// ─── POST /api/maintenance/:id/complete ───────────────────────────────────────
router.post('/:id/complete', requireOperator, [
  body('notes').optional().isString(),
], async (req, res) => {
  const maint = await getOne('SELECT status FROM maintenance_windows WHERE id=$1', [req.params.id]);
  if (!maint || !['in_progress','extended'].includes(maint.status)) {
    return res.status(400).json({ error: 'Stato non valido' });
  }
  await query(
    `UPDATE maintenance_windows SET status='completed', actual_end=NOW(), notes=$1, updated_at=NOW() WHERE id=$2`,
    [req.body.notes || null, req.params.id]
  );
  await notifyMaintenance(req.params.id, 'maintenance_completed');
  wsService.broadcast({ type: 'maintenance_completed', id: req.params.id });
  await auditService.log(req.user.id, req.user.username, 'maintenance:complete', 'maintenance', req.params.id, null, req.ip);
  res.json({ message: 'Manutenzione completata' });
});

// ─── POST /api/maintenance/:id/cancel ────────────────────────────────────────
router.post('/:id/cancel', requireOperator, [
  body('reason').optional().isString(),
], async (req, res) => {
  const maint = await getOne('SELECT status FROM maintenance_windows WHERE id=$1', [req.params.id]);
  if (!maint || ['completed','cancelled'].includes(maint.status)) {
    return res.status(400).json({ error: 'Stato non valido' });
  }
  await query(
    `UPDATE maintenance_windows SET status='cancelled', rejection_reason=$1, updated_at=NOW() WHERE id=$2`,
    [req.body.reason || null, req.params.id]
  );
  await notifyMaintenance(req.params.id, 'maintenance_cancelled', { reason: req.body.reason || '' });
  wsService.broadcast({ type: 'maintenance_cancelled', id: req.params.id });
  await auditService.log(req.user.id, req.user.username, 'maintenance:cancel', 'maintenance', req.params.id, req.body.reason||null, req.ip);
  res.json({ message: 'Manutenzione annullata' });
});

// ─── DELETE /api/maintenance/:id ─────────────────────────────────────────────
router.delete('/:id', requireAdmin, async (req, res) => {
  await query('DELETE FROM maintenance_windows WHERE id=$1', [req.params.id]);
  await auditService.log(req.user.id, req.user.username, 'maintenance:delete', 'maintenance', req.params.id, null, req.ip);
  res.json({ message: 'Manutenzione eliminata' });
});

// ─── GET /api/maintenance/:id/users ──────────────────────────────────────────
router.get('/:id/users', async (req, res) => {
  const rows = await getMany(
    `SELECT DISTINCT u.id, u.username, u.display_name, u.email, u.role, u.auth_type
     FROM service_subscribers ss
     JOIN maintenance_services ms ON ms.service_id = ss.service_id
     LEFT JOIN users u ON u.id = ss.user_id
     WHERE ms.maintenance_id = $1 AND u.id IS NOT NULL
     UNION
     SELECT DISTINCT u.id, u.username, u.display_name, u.email, u.role, u.auth_type
     FROM service_subscribers ss
     JOIN service_assets sa ON sa.service_id = ss.service_id
     JOIN maintenance_assets ma ON ma.asset_id = sa.asset_id
     LEFT JOIN users u ON u.id = ss.user_id
     WHERE ma.maintenance_id = $1 AND u.id IS NOT NULL
     ORDER BY display_name`,
    [req.params.id]
  );
  res.json(rows);
});

module.exports = router;
