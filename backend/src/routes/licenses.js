const { Router } = require('express');
const { body, param, query: qv, validationResult } = require('express-validator');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');
const { query, getOne, getMany } = require('../db/database');
const crypto = require('crypto');
const { sendEmailNotification } = require('../services/notificationService');

const router = Router();

function hashApprovalToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function extractApproverIdentity(row) {
  if (!row || typeof row !== 'object') return { approverUserId: null, approverEmail: '' };
  const contact = row.approver_contact && typeof row.approver_contact === 'object' ? row.approver_contact : null;
  const approverEmail = String(contact?.email || '').trim().toLowerCase();
  return {
    approverUserId: row.approver_user_id || null,
    approverEmail,
  };
}

async function findApprovalScopeByTokenHash(tokenHash) {
  const row = await getOne(
    `SELECT id, approver_user_id, approver_contact, approval_status, approval_required, approval_token_expires_at
     FROM licenses
     WHERE approval_token_hash=$1`,
    [tokenHash]
  );
  if (!row) return null;

  if (!row.approval_required) return { error: 'Approval is not required for this license', status: 400 };
  if (!row.approval_token_expires_at || new Date(row.approval_token_expires_at).getTime() < Date.now()) {
    return { error: 'Approval link expired', status: 410 };
  }

  const identity = extractApproverIdentity(row);
  if (!identity.approverUserId && !identity.approverEmail) {
    return { error: 'Approver is not configured for this license', status: 400 };
  }

  return {
    sourceLicenseId: row.id,
    approverUserId: identity.approverUserId,
    approverEmail: identity.approverEmail,
  };
}

async function listPendingApprovalsByScope(scope) {
  const where = [
    `l.approval_required=TRUE`,
    `l.approval_status='pending'`,
    `l.approval_token_hash IS NOT NULL`,
    `l.approval_token_expires_at IS NOT NULL`,
    `l.approval_token_expires_at >= NOW()`,
  ];
  const params = [];
  let idx = 1;

  const identityClauses = [];
  if (scope.approverUserId) {
    identityClauses.push(`l.approver_user_id=$${idx++}`);
    params.push(scope.approverUserId);
  }
  if (scope.approverEmail) {
    identityClauses.push(`LOWER(l.approver_contact->>'email')=$${idx++}`);
    params.push(scope.approverEmail);
  }
  if (!identityClauses.length) return [];
  where.push(`(${identityClauses.join(' OR ')})`);

  return getMany(
    `SELECT l.id, l.name, l.description, l.approval_status, l.expiry_date, l.renewal_date,
            l.approval_token_expires_at AS expires_at,
            s.company AS supplier_company
     FROM licenses l
     LEFT JOIN suppliers s ON s.id=l.supplier_id
     WHERE ${where.join(' AND ')}
     ORDER BY l.expiry_date NULLS LAST, l.updated_at DESC, l.name`,
    params
  );
}

async function getApprovalInfoByScope(scope, requestId) {
  const where = [
    `l.id=$1`,
    `l.approval_required=TRUE`,
    `l.approval_status='pending'`,
    `l.approval_token_hash IS NOT NULL`,
    `l.approval_token_expires_at IS NOT NULL`,
    `l.approval_token_expires_at >= NOW()`,
  ];
  const params = [requestId];
  let idx = 2;

  const identityClauses = [];
  if (scope.approverUserId) {
    identityClauses.push(`l.approver_user_id=$${idx++}`);
    params.push(scope.approverUserId);
  }
  if (scope.approverEmail) {
    identityClauses.push(`LOWER(l.approver_contact->>'email')=$${idx++}`);
    params.push(scope.approverEmail);
  }
  if (!identityClauses.length) return null;
  where.push(`(${identityClauses.join(' OR ')})`);

  return getOne(
    `SELECT l.id, l.name, l.description, l.approval_status, l.expiry_date, l.renewal_date,
            l.approval_token_expires_at AS expires_at,
            s.company AS supplier_company
     FROM licenses l
     LEFT JOIN suppliers s ON s.id=l.supplier_id
     WHERE ${where.join(' AND ')}`,
    params
  );
}

async function getAppBaseUrl() {
  const row = await getOne("SELECT value FROM settings WHERE key='general_config'");
  const cfg = row ? JSON.parse(row.value || '{}') : {};
  const configured = String(cfg?.app_url || '').trim();
  if (configured) return configured.replace(/\/$/, '');
  return (process.env.APP_URL || process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
}

function getContactEmail(contact) {
  if (!contact || typeof contact !== 'object') return null;
  const email = String(contact.email || '').trim();
  return email || null;
}

function buildLicenseTemplateVars(license, extraVars = {}) {
  return {
    license_id: license.id,
    license_name: license.name,
    license_description: license.description || '-',
    supplier_company: license.supplier_company || '-',
    approval_status: license.approval_status || '-',
    expiry_date: license.expiry_date ? String(license.expiry_date).slice(0, 10) : '-',
    renewal_date: license.renewal_date ? String(license.renewal_date).slice(0, 10) : '-',
    ...extraVars,
  };
}

async function getLicenseNotificationContext(licenseId) {
  return getOne(
    `SELECT l.id, l.name, l.description, l.approval_status, l.expiry_date, l.renewal_date,
            l.owner_contact, l.maintainer_contact, l.approver_contact,
            s.company AS supplier_company,
            uo.email AS owner_user_email,
            um.email AS maintainer_user_email,
            ua.email AS approver_user_email,
            uc.email AS created_by_email
     FROM licenses l
     LEFT JOIN suppliers s ON s.id=l.supplier_id
     LEFT JOIN users uo ON uo.id=l.owner_user_id
     LEFT JOIN users um ON um.id=l.maintainer_user_id
     LEFT JOIN users ua ON ua.id=l.approver_user_id
     LEFT JOIN users uc ON uc.id=l.created_by
     WHERE l.id=$1`,
    [licenseId]
  );
}

function collectLicenseRecipientEmails(license, includeApprover = false) {
  const recipients = new Set();
  const add = (value) => {
    const email = String(value || '').trim();
    if (email) recipients.add(email);
  };

  add(license.owner_user_email);
  add(license.maintainer_user_email);
  add(license.created_by_email);
  add(getContactEmail(license.owner_contact));
  add(getContactEmail(license.maintainer_contact));
  if (includeApprover) {
    add(license.approver_user_email);
    add(getContactEmail(license.approver_contact));
  }
  return [...recipients];
}

async function notifyLicenseEvent(eventType, licenseId, extraVars = {}, includeApprover = false) {
  const license = await getLicenseNotificationContext(licenseId);
  if (!license) return;
  const toEmails = collectLicenseRecipientEmails(license, includeApprover);
  if (toEmails.length === 0) return;

  await sendEmailNotification(
    eventType,
    toEmails,
    buildLicenseTemplateVars(license, extraVars),
    'license',
    licenseId
  );
}

router.get('/approval/:token/requests', [param('token').isString().isLength({ min: 20, max: 300 })], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const tokenHash = hashApprovalToken(req.params.token);
  const scope = await findApprovalScopeByTokenHash(tokenHash);
  if (!scope) return res.status(404).json({ error: 'Approval link not found' });
  if (scope.error) return res.status(scope.status).json({ error: scope.error });

  const requests = await listPendingApprovalsByScope(scope);
  res.json({
    current_request_id: scope.sourceLicenseId,
    requests,
  });
});

router.get('/approval/:token/request/:id', [
  param('token').isString().isLength({ min: 20, max: 300 }),
  param('id').isUUID(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const tokenHash = hashApprovalToken(req.params.token);
  const scope = await findApprovalScopeByTokenHash(tokenHash);
  if (!scope) return res.status(404).json({ error: 'Approval link not found' });
  if (scope.error) return res.status(scope.status).json({ error: scope.error });

  const row = await getApprovalInfoByScope(scope, req.params.id);
  if (!row) return res.status(404).json({ error: 'Approval request not found' });

  res.json(row);
});

router.post('/approval/:token/request/:id/approve', [
  param('token').isString().isLength({ min: 20, max: 300 }),
  param('id').isUUID(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const tokenHash = hashApprovalToken(req.params.token);
  const scope = await findApprovalScopeByTokenHash(tokenHash);
  if (!scope) return res.status(404).json({ error: 'Approval link not found' });
  if (scope.error) return res.status(scope.status).json({ error: scope.error });

  const row = await getApprovalInfoByScope(scope, req.params.id);
  if (!row) return res.status(404).json({ error: 'Approval request not found' });

  await query(
    `UPDATE licenses
     SET approval_status='approved', approved_at=NOW(), rejected_at=NULL, rejected_by=NULL,
         rejection_reason=NULL, approval_token_hash=NULL, approval_token_expires_at=NULL, updated_at=NOW()
     WHERE id=$1`,
    [req.params.id]
  );

  await notifyLicenseEvent('license_approved', req.params.id, {
    acted_by: 'Approval Link',
    approved_at: new Date().toISOString(),
  }, true).catch(() => {});

  res.json({ message: 'License approved' });
});

router.post('/approval/:token/request/:id/reject', [
  param('token').isString().isLength({ min: 20, max: 300 }),
  param('id').isUUID(),
  body('reason').optional().isString().isLength({ max: 2000 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const tokenHash = hashApprovalToken(req.params.token);
  const scope = await findApprovalScopeByTokenHash(tokenHash);
  if (!scope) return res.status(404).json({ error: 'Approval link not found' });
  if (scope.error) return res.status(scope.status).json({ error: scope.error });

  const row = await getApprovalInfoByScope(scope, req.params.id);
  if (!row) return res.status(404).json({ error: 'Approval request not found' });

  await query(
    `UPDATE licenses
     SET approval_status='rejected', rejected_at=NOW(), rejection_reason=$1,
         approval_token_hash=NULL, approval_token_expires_at=NULL, updated_at=NOW()
     WHERE id=$2`,
    [req.body.reason || null, req.params.id]
  );

  await notifyLicenseEvent('license_rejected', req.params.id, {
    acted_by: 'Approval Link',
    rejected_at: new Date().toISOString(),
    rejection_reason: req.body.reason || '-',
  }, true).catch(() => {});

  res.json({ message: 'License rejected' });
});

router.get('/approval/:token', [param('token').isString().isLength({ min: 20, max: 300 })], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const tokenHash = hashApprovalToken(req.params.token);
  const row = await getOne(
    `SELECT l.id, l.name, l.description, l.approval_status, l.expiry_date, l.renewal_date, l.approval_required,
            l.approval_token_expires_at, s.company AS supplier_company
     FROM licenses l
     LEFT JOIN suppliers s ON s.id=l.supplier_id
     WHERE l.approval_token_hash=$1`,
    [tokenHash]
  );
  if (!row) return res.status(404).json({ error: 'Approval link not found' });
  if (!row.approval_required) return res.status(400).json({ error: 'Approval is not required for this license' });
  if (!row.approval_token_expires_at || new Date(row.approval_token_expires_at).getTime() < Date.now()) {
    return res.status(410).json({ error: 'Approval link expired' });
  }

  res.json({
    id: row.id,
    name: row.name,
    description: row.description,
    supplier_company: row.supplier_company,
    approval_status: row.approval_status,
    expiry_date: row.expiry_date,
    renewal_date: row.renewal_date,
    expires_at: row.approval_token_expires_at,
  });
});

router.post('/approval/:token/approve', [param('token').isString().isLength({ min: 20, max: 300 })], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const tokenHash = hashApprovalToken(req.params.token);
  const row = await getOne(
    `SELECT id, approval_status, approval_token_expires_at FROM licenses WHERE approval_token_hash=$1`,
    [tokenHash]
  );
  if (!row) return res.status(404).json({ error: 'Approval link not found' });
  if (!row.approval_token_expires_at || new Date(row.approval_token_expires_at).getTime() < Date.now()) {
    return res.status(410).json({ error: 'Approval link expired' });
  }
  if (row.approval_status === 'approved') return res.json({ message: 'License already approved' });

  await query(
    `UPDATE licenses
     SET approval_status='approved', approved_at=NOW(), rejected_at=NULL, rejected_by=NULL,
         rejection_reason=NULL, approval_token_hash=NULL, approval_token_expires_at=NULL, updated_at=NOW()
     WHERE id=$1`,
    [row.id]
  );

  await notifyLicenseEvent('license_approved', row.id, {
    acted_by: 'Approval Link',
    approved_at: new Date().toISOString(),
  }, true).catch(() => {});

  res.json({ message: 'License approved' });
});

router.post('/approval/:token/reject', [
  param('token').isString().isLength({ min: 20, max: 300 }),
  body('reason').optional().isString().isLength({ max: 2000 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const tokenHash = hashApprovalToken(req.params.token);
  const row = await getOne(
    `SELECT id, approval_status, approval_token_expires_at FROM licenses WHERE approval_token_hash=$1`,
    [tokenHash]
  );
  if (!row) return res.status(404).json({ error: 'Approval link not found' });
  if (!row.approval_token_expires_at || new Date(row.approval_token_expires_at).getTime() < Date.now()) {
    return res.status(410).json({ error: 'Approval link expired' });
  }
  if (row.approval_status === 'rejected') return res.json({ message: 'License already rejected' });

  await query(
    `UPDATE licenses
     SET approval_status='rejected', rejected_at=NOW(), rejection_reason=$1,
         approval_token_hash=NULL, approval_token_expires_at=NULL, updated_at=NOW()
     WHERE id=$2`,
    [req.body.reason || null, row.id]
  );

  await notifyLicenseEvent('license_rejected', row.id, {
    acted_by: 'Approval Link',
    rejected_at: new Date().toISOString(),
    rejection_reason: req.body.reason || '-',
  }, true).catch(() => {});

  res.json({ message: 'License rejected' });
});

router.use(requireAuth);

function normalizeDocuments(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(d => d && typeof d === 'object')
    .map(d => ({
      name: String(d.name || '').trim(),
      url: String(d.url || '').trim(),
    }))
    .filter(d => d.name || d.url);
}

async function syncLinks(licenseId, assetIds = [], serviceIds = []) {
  await query('DELETE FROM license_assets WHERE license_id=$1', [licenseId]);
  await query('DELETE FROM license_services WHERE license_id=$1', [licenseId]);

  for (const assetId of assetIds) {
    await query(
      'INSERT INTO license_assets (license_id, asset_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [licenseId, assetId]
    );
  }
  for (const serviceId of serviceIds) {
    await query(
      'INSERT INTO license_services (license_id, service_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [licenseId, serviceId]
    );
  }
}

router.get('/', [
  qv('page').optional().isInt({ min: 1 }),
  qv('limit').optional().isInt({ min: 1, max: 100 }),
  qv('q').optional().isString(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const page = parseInt(req.query.page || '1', 10);
  const limit = parseInt(req.query.limit || '25', 10);
  const offset = (page - 1) * limit;
  const q = String(req.query.q || '').trim().toLowerCase();

  const where = [];
  const vals = [];
  let idx = 1;

  if (q) {
    where.push(`(LOWER(l.name) LIKE $${idx} OR LOWER(COALESCE(l.supplier,'')) LIKE $${idx})`);
    vals.push(`%${q}%`);
    idx += 1;
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const totalRow = await getOne(`SELECT COUNT(*)::int AS c FROM licenses l ${whereSql}`, vals);
  const total = totalRow?.c || 0;

  const rows = await getMany(
    `SELECT l.*,
            uo.display_name AS owner_name,
            um.display_name AS maintainer_name,
            ua.display_name AS approver_name,
            s.company AS supplier_company,
            s.email AS supplier_email,
            COUNT(DISTINCT la.asset_id)::int AS asset_count,
            COUNT(DISTINCT ls.service_id)::int AS service_count
     FROM licenses l
     LEFT JOIN users uo ON uo.id = l.owner_user_id
     LEFT JOIN users um ON um.id = l.maintainer_user_id
     LEFT JOIN users ua ON ua.id = l.approver_user_id
     LEFT JOIN suppliers s ON s.id = l.supplier_id
     LEFT JOIN license_assets la ON la.license_id = l.id
     LEFT JOIN license_services ls ON ls.license_id = l.id
     ${whereSql}
     GROUP BY l.id, uo.display_name, um.display_name, ua.display_name, s.company, s.email
     ORDER BY l.expiry_date NULLS LAST, l.name
     LIMIT $${idx} OFFSET $${idx + 1}`,
    [...vals, limit, offset]
  );

  res.json({ data: rows, total, page, limit });
});

router.get('/:id', [param('id').isUUID()], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const row = await getOne(
    `SELECT l.*, uo.display_name AS owner_name, um.display_name AS maintainer_name, ua.display_name AS approver_name,
            s.company AS supplier_company, s.email AS supplier_email
     FROM licenses l
     LEFT JOIN users uo ON uo.id = l.owner_user_id
     LEFT JOIN users um ON um.id = l.maintainer_user_id
     LEFT JOIN users ua ON ua.id = l.approver_user_id
     LEFT JOIN suppliers s ON s.id = l.supplier_id
     WHERE l.id=$1`,
    [req.params.id]
  );
  if (!row) return res.status(404).json({ error: 'License not found' });

  const assets = await getMany(
    `SELECT a.id, a.name, a.status
     FROM license_assets la
     JOIN assets a ON a.id = la.asset_id
     WHERE la.license_id=$1
     ORDER BY a.name`,
    [req.params.id]
  );
  const services = await getMany(
    `SELECT s.id, s.name, s.status AS current_status
     FROM license_services ls
     JOIN services s ON s.id = ls.service_id
     WHERE ls.license_id=$1
     ORDER BY s.name`,
    [req.params.id]
  );

  res.json({ ...row, assets, services });
});

router.post('/', requireAdmin, [
  body('name').isString().trim().isLength({ min: 2, max: 200 }),
  body('description').optional().isString(),
  body('owner_user_id').optional({ nullable: true }).isUUID(),
  body('supplier_id').optional({ nullable: true }).isUUID(),
  body('owner_contact').optional({ nullable: true }).isObject(),
  body('maintainer_contact').optional({ nullable: true }).isObject(),
  body('approver_contact').optional({ nullable: true }).isObject(),
  body('supplier').optional().isString(),
  body('maintainer_user_id').optional({ nullable: true }).isUUID(),
  body('approver_user_id').optional({ nullable: true }).isUUID(),
  body('expiry_date').optional({ nullable: true }).isISO8601(),
  body('renewal_date').optional({ nullable: true }).isISO8601(),
  body('reminder_days').optional().isInt({ min: 1, max: 365 }),
  body('approval_required').optional().isBoolean(),
  body('approval_status').optional().isIn(['pending', 'approved', 'rejected']),
  body('estimated_cost').optional({ nullable: true }).isNumeric(),
  body('currency').optional().isString().trim().isLength({ min: 1, max: 10 }),
  body('notes').optional().isString(),
  body('documents').optional().isArray(),
  body('asset_ids').optional().isArray(),
  body('service_ids').optional().isArray(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const docs = normalizeDocuments(req.body.documents);
  const assetIds = Array.isArray(req.body.asset_ids) ? req.body.asset_ids : [];
  const serviceIds = Array.isArray(req.body.service_ids) ? req.body.service_ids : [];

  const result = await query(
    `INSERT INTO licenses (
      name, description, owner_user_id, owner_contact, supplier_id, supplier, maintainer_user_id, maintainer_contact, approver_user_id, approver_contact,
      expiry_date, renewal_date, reminder_days, approval_required, approval_status,
      estimated_cost, currency, notes, documents, created_by, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,NOW())
    RETURNING id`,
    [
      req.body.name,
      req.body.description || null,
      req.body.owner_user_id || null,
      req.body.owner_contact ? JSON.stringify(req.body.owner_contact) : null,
      req.body.supplier_id || null,
      req.body.supplier || null,
      req.body.maintainer_user_id || null,
      req.body.maintainer_contact ? JSON.stringify(req.body.maintainer_contact) : null,
      req.body.approver_user_id || null,
      req.body.approver_contact ? JSON.stringify(req.body.approver_contact) : null,
      req.body.expiry_date || null,
      req.body.renewal_date || null,
      req.body.reminder_days || 30,
      req.body.approval_required !== undefined ? req.body.approval_required : true,
      req.body.approval_status || 'pending',
      req.body.estimated_cost || null,
      req.body.currency || 'EUR',
      req.body.notes || null,
      JSON.stringify(docs),
      req.user.id,
    ]
  );

  const id = result.rows[0].id;
  await syncLinks(id, assetIds, serviceIds);
  res.status(201).json({ id });
});

router.put('/:id', requireAdmin, [
  param('id').isUUID(),
  body('name').optional().isString().trim().isLength({ min: 2, max: 200 }),
  body('description').optional().isString(),
  body('owner_user_id').optional({ nullable: true }).isUUID(),
  body('supplier_id').optional({ nullable: true }).isUUID(),
  body('owner_contact').optional({ nullable: true }).isObject(),
  body('maintainer_contact').optional({ nullable: true }).isObject(),
  body('approver_contact').optional({ nullable: true }).isObject(),
  body('supplier').optional().isString(),
  body('maintainer_user_id').optional({ nullable: true }).isUUID(),
  body('approver_user_id').optional({ nullable: true }).isUUID(),
  body('expiry_date').optional({ nullable: true }).isISO8601(),
  body('renewal_date').optional({ nullable: true }).isISO8601(),
  body('reminder_days').optional().isInt({ min: 1, max: 365 }),
  body('approval_required').optional().isBoolean(),
  body('approval_status').optional().isIn(['pending', 'approved', 'rejected']),
  body('estimated_cost').optional({ nullable: true }).isNumeric(),
  body('currency').optional().isString().trim().isLength({ min: 1, max: 10 }),
  body('notes').optional().isString(),
  body('documents').optional().isArray(),
  body('asset_ids').optional().isArray(),
  body('service_ids').optional().isArray(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const existing = await getOne('SELECT id FROM licenses WHERE id=$1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'License not found' });

  const fields = [];
  const vals = [];
  let idx = 1;

  const setField = (key, value) => {
    fields.push(`${key}=$${idx++}`);
    vals.push(value);
  };

  const allowed = [
    'name', 'description', 'owner_user_id', 'supplier_id', 'supplier', 'maintainer_user_id', 'approver_user_id',
    'expiry_date', 'renewal_date', 'reminder_days', 'approval_required', 'approval_status',
    'estimated_cost', 'currency', 'notes'
  ];

  for (const key of allowed) {
    if (req.body[key] !== undefined) setField(key, req.body[key] === '' ? null : req.body[key]);
  }
  if (req.body.owner_contact !== undefined) setField('owner_contact', req.body.owner_contact ? JSON.stringify(req.body.owner_contact) : null);
  if (req.body.maintainer_contact !== undefined) setField('maintainer_contact', req.body.maintainer_contact ? JSON.stringify(req.body.maintainer_contact) : null);
  if (req.body.approver_contact !== undefined) setField('approver_contact', req.body.approver_contact ? JSON.stringify(req.body.approver_contact) : null);
  if (req.body.documents !== undefined) setField('documents', JSON.stringify(normalizeDocuments(req.body.documents)));

  if (fields.length > 0) {
    fields.push(`updated_at=NOW()`);
    await query(`UPDATE licenses SET ${fields.join(', ')} WHERE id=$${idx}`, [...vals, req.params.id]);
  }

  if (req.body.asset_ids !== undefined || req.body.service_ids !== undefined) {
    await syncLinks(
      req.params.id,
      Array.isArray(req.body.asset_ids) ? req.body.asset_ids : [],
      Array.isArray(req.body.service_ids) ? req.body.service_ids : []
    );
  }

  res.json({ message: 'License updated' });
});

router.post('/:id/approve', requireAdmin, [param('id').isUUID()], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  await query(
    `UPDATE licenses
     SET approval_status='approved', approved_at=NOW(), approved_by=$1, rejected_at=NULL, rejected_by=NULL, rejection_reason=NULL, updated_at=NOW()
     WHERE id=$2`,
    [req.user.id, req.params.id]
  );

  await notifyLicenseEvent('license_approved', req.params.id, {
    acted_by: req.user?.display_name || req.user?.username || 'Admin',
    approved_at: new Date().toISOString(),
  }, true).catch(() => {});

  res.json({ message: 'License approved' });
});

router.post('/:id/reject', requireAdmin, [
  param('id').isUUID(),
  body('reason').optional().isString(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  await query(
    `UPDATE licenses
     SET approval_status='rejected', rejected_at=NOW(), rejected_by=$1, rejection_reason=$2, updated_at=NOW()
     WHERE id=$3`,
    [req.user.id, req.body.reason || null, req.params.id]
  );

  await notifyLicenseEvent('license_rejected', req.params.id, {
    acted_by: req.user?.display_name || req.user?.username || 'Admin',
    rejected_at: new Date().toISOString(),
    rejection_reason: req.body.reason || '-',
  }, true).catch(() => {});

  res.json({ message: 'License rejected' });
});

router.post('/:id/request-approval', requireAdmin, [
  param('id').isUUID(),
  body('expiry_hours').optional().isInt({ min: 1, max: 168 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const lic = await getOne(
    `SELECT l.id, l.name, l.approval_required, l.approver_contact, l.approver_user_id,
            u.email AS approver_user_email
     FROM licenses l
     LEFT JOIN users u ON u.id=l.approver_user_id
     WHERE l.id=$1`,
    [req.params.id]
  );
  if (!lic) return res.status(404).json({ error: 'License not found' });
  if (!lic.approval_required) return res.status(400).json({ error: 'Approval not required for this license' });

  const approverContact = lic.approver_contact && typeof lic.approver_contact === 'object' ? lic.approver_contact : null;
  const to = approverContact?.email || lic.approver_user_email;
  if (!to) return res.status(400).json({ error: 'No approver email configured' });

  const hours = Number(req.body.expiry_hours || 72);
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashApprovalToken(token);

  await query(
    `UPDATE licenses
     SET approval_status='pending', approval_token_hash=$1, approval_token_expires_at=$2,
         approval_requested_at=NOW(), updated_at=NOW()
     WHERE id=$3`,
    [tokenHash, expiresAt.toISOString(), lic.id]
  );

  const appBaseUrl = await getAppBaseUrl();
  const approvalUrl = `${appBaseUrl}/licenses/approval?token=${token}`;

  const context = await getLicenseNotificationContext(lic.id);
  const vars = buildLicenseTemplateVars(context || { id: lic.id, name: lic.name }, {
    approval_url: approvalUrl,
    expires_at: expiresAt.toISOString(),
    approver_email: to,
  });

  await sendEmailNotification('license_approval_requested', [to], vars, 'license', lic.id);

  res.json({ message: `Approval request sent to ${to}`, expires_at: expiresAt.toISOString() });
});

router.delete('/:id', requireAdmin, [param('id').isUUID()], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  await query('DELETE FROM licenses WHERE id=$1', [req.params.id]);
  res.json({ message: 'License deleted' });
});

module.exports = router;
