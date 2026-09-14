const { Router } = require('express');
const { body, param, query: qv, validationResult } = require('express-validator');
const { requireAuth, requireAdmin, optionalAuth } = require('../middleware/authMiddleware');
const { query, getOne, getMany } = require('../db/database');
const crypto = require('crypto');
const { sendEmailNotification, sendInApp } = require('../services/notificationService');

const router = Router();

function hashApprovalToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function hashStatusToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function collectContactItems(contact) {
  if (!contact || typeof contact !== 'object') return [];
  if (Array.isArray(contact)) return contact.filter(v => v && typeof v === 'object');
  const nested = Array.isArray(contact.contacts) ? contact.contacts.filter(v => v && typeof v === 'object') : [];
  return [contact, ...nested];
}

function collectContactEmails(contact) {
  const emails = new Set();
  for (const item of collectContactItems(contact)) {
    const email = String(item?.email || '').trim().toLowerCase();
    if (email) emails.add(email);
  }
  return [...emails];
}

function buildApproverEmailMatchClause(paramPos) {
  return `(
    LOWER(l.approver_contact->>'email')=$${paramPos}
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(l.approver_contact->'contacts')='array' THEN l.approver_contact->'contacts'
          ELSE '[]'::jsonb
        END
      ) ap
      WHERE LOWER(ap->>'email')=$${paramPos}
    )
  )`;
}

function normalizeLicenseDocumentsForEmail(value) {
  const parsed = Array.isArray(value)
    ? value
    : (() => {
        if (!value) return [];
        if (typeof value === 'string') {
          try {
            const obj = JSON.parse(value);
            return Array.isArray(obj) ? obj : [];
          } catch {
            return [];
          }
        }
        return [];
      })();

  return parsed
    .filter(d => d && typeof d === 'object')
    .map(d => ({
      name: String(d.name || '').trim(),
      url: String(d.url || '').trim(),
    }))
    .filter(d => d.name || d.url);
}

function normalizeDocumentUrlForEmail(rawUrl, appBaseUrl = '') {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return '';

  // Fix malformed links like "http:///uploads/file.pdf".
  const malformedMatch = trimmed.match(/^https?:\/\/\/+(.+)$/i);
  const collapsed = malformedMatch ? `/${String(malformedMatch[1] || '').replace(/^\/+/, '')}` : trimmed;

  const pathOnly = collapsed.match(/^\/?uploads\//i)
    ? `/${collapsed.replace(/^\/+/, '')}`
    : collapsed;

  if (/^https?:\/\//i.test(pathOnly)) return pathOnly;
  if (/^\//.test(pathOnly) && appBaseUrl) return `${appBaseUrl}${pathOnly}`;
  return pathOnly;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildLicenseDocumentsHtml(documents, appBaseUrl = '') {
  const docs = normalizeLicenseDocumentsForEmail(documents);
  if (!docs.length) return '-';

  const items = docs.map((doc) => {
    const normalizedUrl = normalizeDocumentUrlForEmail(doc.url, appBaseUrl);
    const label = escapeHtml(doc.name || normalizedUrl || doc.url);
    if (normalizedUrl) {
      return `<li><a href="${escapeHtml(normalizedUrl)}" style="color:#1d4ed8;text-decoration:underline">${label}</a></li>`;
    }
    return `<li>${label}</li>`;
  });

  return `<ul style="margin:0;padding-left:18px">${items.join('')}</ul>`;
}

function formatActorLabel(name, email, office) {
  const safeName = String(name || '').trim();
  const safeEmail = String(email || '').trim();
  const safeOffice = String(office || '').trim();

  const base = safeName && safeEmail
    ? `${safeName} <${safeEmail}>`
    : (safeName || safeEmail || 'Approver');

  return safeOffice ? `${base} (${safeOffice})` : base;
}

function extractApproverIdentity(row) {
  if (!row || typeof row !== 'object') return { approverUserId: null, approverEmails: [] };
  const approverEmails = collectContactEmails(row.approver_contact);

  const userLabel = String(
    row.approver_user_display_name || row.approver_user_username || row.approver_user_email || ''
  ).trim();

  const contactItems = collectContactItems(row.approver_contact);
  const namedContact = contactItems.find(item => String(item?.name || item?.display_name || '').trim());
  const contactName = String(
    namedContact?.name ||
    namedContact?.display_name ||
    ''
  ).trim();
  const contactEmail = String(contactItems.find(item => String(item?.email || '').trim())?.email || '').trim();
  const contactOffice = String(
    contactItems.find(item => String(item?.office || item?.department || '').trim())?.office ||
    contactItems.find(item => String(item?.office || item?.department || '').trim())?.department ||
    ''
  ).trim();
  const primaryEmail = String(row.approver_user_email || contactEmail || '').trim();
  const office = String(row.approver_user_office || contactOffice || '').trim();

  const actorName = userLabel || contactName || '';
  const approverActorLabel = formatActorLabel(actorName, primaryEmail, office);

  return {
    approverUserId: row.approver_user_id || null,
    approverEmails,
    approverActorLabel,
  };
}

async function findApprovalScopeByTokenHash(tokenHash) {
  const row = await getOne(
    `SELECT l.id, l.approver_user_id, l.approver_contact, l.approval_status, l.approval_required, l.approval_token_expires_at,
            ua.display_name AS approver_user_display_name,
            ua.username AS approver_user_username,
            ua.email AS approver_user_email,
            ua.office AS approver_user_office
     FROM licenses l
     LEFT JOIN users ua ON ua.id=l.approver_user_id
     WHERE l.approval_token_hash=$1`,
    [tokenHash]
  );
  if (!row) return null;

  if (!row.approval_required) return { error: 'Approval is not required for this license', status: 400 };
  if (!row.approval_token_expires_at || new Date(row.approval_token_expires_at).getTime() < Date.now()) {
    return { error: 'Approval link expired', status: 410 };
  }

  const identity = extractApproverIdentity(row);
  if (!identity.approverUserId && identity.approverEmails.length === 0) {
    return { error: 'Approver is not configured for this license', status: 400 };
  }

  return {
    sourceLicenseId: row.id,
    approverUserId: identity.approverUserId,
    approverEmails: identity.approverEmails,
    approverActorLabel: identity.approverActorLabel,
  };
}

function isLoggedUserAuthorizedForScope(user, scope) {
  if (!user) return true;

  const userId = String(user.id || '').trim();
  const approverUserId = String(scope?.approverUserId || '').trim();
  if (userId && approverUserId && userId === approverUserId) return true;

  const userEmail = String(user.email || '').trim().toLowerCase();
  if (userEmail && Array.isArray(scope?.approverEmails)) {
    return scope.approverEmails.some(v => String(v || '').trim().toLowerCase() === userEmail);
  }

  return false;
}

function ensureLoggedUserAuthorizedForScope(req, res, scope) {
  if (!req.user) return true;
  if (isLoggedUserAuthorizedForScope(req.user, scope)) return true;
  res.status(403).json({ error: 'User is not authorized for this operation.' });
  return false;
}

function buildApproverDisplayLabel(entry) {
  const name = String(entry?.name || '').trim();
  const email = String(entry?.email || '').trim();
  const company = String(entry?.company || '').trim();
  const office = String(entry?.office || '').trim();

  const base = name && email
    ? `${name} <${email}>`
    : (email || name || 'Unknown approver');

  const extra = [company, office].filter(Boolean);
  return extra.length > 0 ? `${base} (${extra.join(', ')})` : base;
}

function buildApproversNotified(row, appCompany = '') {
  const records = [];

  const userName = String(row?.approver_user_display_name || row?.approver_user_username || '').trim();
  const userEmail = String(row?.approver_user_email || '').trim().toLowerCase();
  const userOffice = String(row?.approver_user_office || '').trim();
  if (userName || userEmail) {
    records.push({
      source: String(row?.approver_user_auth_type || 'user').trim() || 'user',
      name: userName,
      email: userEmail,
      company: String(appCompany || '').trim(),
      office: userOffice,
    });
  }

  for (const item of collectContactItems(row?.approver_contact)) {
    const name = String(item?.name || item?.display_name || '').trim();
    const email = String(item?.email || '').trim().toLowerCase();
    const company = String(item?.company || item?.company_name || item?.organization || item?.org || '').trim();
    const office = String(item?.office || item?.department || '').trim();
    if (!(name || email)) continue;
    records.push({
      source: 'contact',
      name,
      email,
      company,
      office,
    });
  }

  const dedup = new Map();
  for (const rec of records) {
    const key = rec.email || `${rec.source}:${rec.name}`;
    if (!key) continue;
    if (!dedup.has(key)) dedup.set(key, rec);
  }

  return [...dedup.values()].map(rec => ({
    ...rec,
    label: buildApproverDisplayLabel(rec),
  }));
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
  const approverEmails = Array.isArray(scope.approverEmails) ? scope.approverEmails : [];
  for (const email of approverEmails) {
    identityClauses.push(buildApproverEmailMatchClause(idx++));
    params.push(email);
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
  const approverEmails = Array.isArray(scope.approverEmails) ? scope.approverEmails : [];
  for (const email of approverEmails) {
    identityClauses.push(buildApproverEmailMatchClause(idx++));
    params.push(email);
  }
  if (!identityClauses.length) return null;
  where.push(`(${identityClauses.join(' OR ')})`);

  return getOne(
    `SELECT l.id, l.name, l.description, l.approval_status, l.expiry_date, l.renewal_date,
            l.documents,
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

async function getGeneralConfig() {
  const row = await getOne("SELECT value FROM settings WHERE key='general_config'");
  return row ? JSON.parse(row.value || '{}') : {};
}

function getContactEmail(contact) {
  const emails = collectContactEmails(contact);
  return emails.length > 0 ? emails[0] : null;
}

function addMonths(baseDate, months) {
  const date = new Date(baseDate.getTime())
  const targetDay = date.getDate()
  date.setMonth(date.getMonth() + months)
  if (date.getDate() !== targetDay) date.setDate(0)
  return date
}

function computeLicenseExpiry({ activation_date, duration_months, custom_expiry_date, expiry_date }) {
  if (custom_expiry_date) return custom_expiry_date
  if (expiry_date) return expiry_date
  if (!activation_date) return null
  const months = Number(duration_months || 0)
  if (!Number.isFinite(months) || months <= 0) return null
  return addMonths(new Date(activation_date), months).toISOString().slice(0, 10)
}

function formatDateForEmail(value, { includeTime = false } = {}) {
  if (!value) return '-';
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

function formatDateForPublicApi(value, { includeTime = false } = {}) {
  return formatDateForEmail(value, { includeTime });
}

function buildLicenseTemplateVars(license, extraVars = {}) {
  const resolvedApprovalStatus =
    extraVars.approval_status !== undefined && extraVars.approval_status !== null
      ? extraVars.approval_status
      : (license.approval_status || '-');

  const normalizedReason =
    extraVars.reason !== undefined && extraVars.reason !== null
      ? extraVars.reason
      : (extraVars.rejection_reason !== undefined && extraVars.rejection_reason !== null
          ? extraVars.rejection_reason
          : (license.rejection_reason || '-'));

  return {
    ...extraVars,
    license_id: license.id,
    license_name: license.name,
    license_description: license.description || '-',
    supplier_company: license.supplier_company || '-',
    requester_name: extraVars.requester_name || license.created_by_email || '-',
    approval_status: resolvedApprovalStatus,
    activation_date: formatDateForEmail(license.activation_date),
    duration_months: license.duration_months || '-',
    expiry_date: formatDateForEmail(license.expiry_date),
    renewal_date: formatDateForEmail(license.renewal_date),
    license_documents_html: buildLicenseDocumentsHtml(license.documents, String(extraVars.app_url || '').trim()),
    reason: normalizedReason,
    rejection_reason: normalizedReason,
    expires_at: extraVars.expires_at ? formatDateForEmail(extraVars.expires_at, { includeTime: true }) : '-',
    approved_at: extraVars.approved_at ? formatDateForEmail(extraVars.approved_at, { includeTime: true }) : '-',
    rejected_at: extraVars.rejected_at ? formatDateForEmail(extraVars.rejected_at, { includeTime: true }) : '-',
  };
}

async function getLicenseNotificationContext(licenseId) {
  return getOne(
            `SELECT l.id, l.name, l.description, l.approval_status, l.activation_date, l.duration_months, l.expiry_date, l.renewal_date,
          l.rejection_reason,
            l.owner_user_id, l.maintainer_user_id, l.approver_user_id, l.created_by AS created_by_user_id,
              l.documents,
            l.owner_contact, l.maintainer_contact, l.approver_contact,
            s.company AS supplier_company,
              s.email AS supplier_email,
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
  add(license.supplier_email);
  collectContactEmails(license.owner_contact).forEach(add);
  collectContactEmails(license.maintainer_contact).forEach(add);
  if (includeApprover) {
    add(license.approver_user_email);
    collectContactEmails(license.approver_contact).forEach(add);
  }
  return [...recipients];
}

function collectLicenseRecipientUserIds(license, includeApprover = false) {
  const recipients = new Set();
  const add = (value) => {
    const id = String(value || '').trim();
    if (id) recipients.add(id);
  };

  add(license.owner_user_id);
  add(license.maintainer_user_id);
  add(license.created_by_user_id);
  if (includeApprover) add(license.approver_user_id);

  return [...recipients];
}

async function resolveExistingActiveUserIds(userIds = []) {
  const normalized = [...new Set(
    (Array.isArray(userIds) ? userIds : [])
      .map(v => String(v || '').trim())
      .filter(Boolean)
  )];
  if (normalized.length === 0) return [];

  const rows = await getMany(
    `SELECT id
     FROM users
     WHERE is_active = true
       AND id = ANY($1::uuid[])`,
    [normalized]
  ).catch(() => []);

  return [...new Set(rows.map(r => String(r?.id || '').trim()).filter(Boolean))];
}

async function resolveExistingActiveUserIdsByEmails(emails = []) {
  const normalized = [...new Set(
    (Array.isArray(emails) ? emails : [])
      .map(v => String(v || '').trim().toLowerCase())
      .filter(Boolean)
  )];
  if (normalized.length === 0) return [];

  const rows = await getMany(
    `SELECT id
     FROM users
     WHERE is_active = true
       AND LOWER(email) = ANY($1::text[])`,
    [normalized]
  ).catch(() => []);

  return [...new Set(rows.map(r => String(r?.id || '').trim()).filter(Boolean))];
}

function collectApproverRecipientEmails(license) {
  const recipients = new Set();
  const add = (value) => {
    const email = String(value || '').trim().toLowerCase();
    if (email) recipients.add(email);
  };
  add(license.approver_user_email);
  collectContactEmails(license.approver_contact).forEach(add);
  return [...recipients];
}

function collectStakeholderRecipientEmails(license) {
  const recipients = new Set();
  const add = (value) => {
    const email = String(value || '').trim().toLowerCase();
    if (email) recipients.add(email);
  };

  add(license.owner_user_email);
  add(license.maintainer_user_email);
  add(license.created_by_email);
  add(license.supplier_email);
  collectContactEmails(license.owner_contact).forEach(add);
  collectContactEmails(license.maintainer_contact).forEach(add);

  return [...recipients];
}

function collectApproverRecipientUserIds(license) {
  const recipients = new Set();
  const add = (value) => {
    const id = String(value || '').trim();
    if (id) recipients.add(id);
  };

  add(license.approver_user_id);
  return [...recipients];
}

function collectStakeholderRecipientUserIds(license) {
  const recipients = new Set();
  const add = (value) => {
    const id = String(value || '').trim();
    if (id) recipients.add(id);
  };

  add(license.owner_user_id);
  add(license.maintainer_user_id);
  add(license.created_by_user_id);
  return [...recipients];
}

function buildLicenseInAppPayload(eventType, license, vars = {}) {
  const licenseName = String(license?.name || vars?.license_name || 'License').trim() || 'License';
  const supplier = String(license?.supplier_company || vars?.supplier_company || '').trim();

  const titleByEvent = {
    license_approval_requested: `Approval required: ${licenseName}`,
    license_approval_requested_info: `Approval started: ${licenseName}`,
    license_approved: `License approved: ${licenseName}`,
    license_rejected: `License rejected: ${licenseName}`,
    license_expiry_reminder: `License expiring soon: ${licenseName}`,
  };

  const messageByEvent = {
    license_approval_requested: `A decision is required for license ${licenseName}${supplier ? ` (${supplier})` : ''}.`,
    license_approval_requested_info: `Approval workflow started for license ${licenseName}${supplier ? ` (${supplier})` : ''}.`,
    license_approved: `License ${licenseName} has been approved${vars?.acted_by ? ` by ${vars.acted_by}` : ''}.`,
    license_rejected: `License ${licenseName} has been rejected${vars?.acted_by ? ` by ${vars.acted_by}` : ''}.`,
    license_expiry_reminder: `License ${licenseName} expires on ${vars?.expiry_date || '-'}.`,
  };

  return {
    type: eventType,
    title: titleByEvent[eventType] || `License update: ${licenseName}`,
    message: messageByEvent[eventType] || `Status update for license ${licenseName}.`,
  };
}

async function notifyLicenseEvent(eventType, licenseId, extraVars = {}, includeApprover = false) {
  const license = await getLicenseNotificationContext(licenseId);
  if (!license) return;
  const toEmails = collectLicenseRecipientEmails(license, includeApprover);
  const directUserIds = collectLicenseRecipientUserIds(license, includeApprover);
  const matchedByEmailUserIds = await resolveExistingActiveUserIdsByEmails(toEmails);
  const toUserIds = await resolveExistingActiveUserIds([...directUserIds, ...matchedByEmailUserIds]);
  if (toEmails.length === 0 && toUserIds.length === 0) return;

  const appBaseUrl = await getAppBaseUrl();
  const mergedVars = {
    app_url: appBaseUrl,
    ...extraVars,
  };

  const templateVars = buildLicenseTemplateVars(license, mergedVars);
  const inAppPayload = buildLicenseInAppPayload(eventType, license, templateVars);

  const tasks = [];
  if (toEmails.length > 0) {
    tasks.push(
      sendEmailNotification(
        eventType,
        toEmails,
        templateVars,
        'license',
        licenseId
      )
    );
  }
  if (toUserIds.length > 0) {
    tasks.push(Promise.all(
      toUserIds.map((uid) =>
        sendInApp(uid, inAppPayload.type, inAppPayload.title, inAppPayload.message, 'license', licenseId)
      )
    ));
  }
  await Promise.allSettled(tasks);
}

router.get('/approval/:token/requests', optionalAuth, [param('token').isString().isLength({ min: 20, max: 300 })], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const tokenHash = hashApprovalToken(req.params.token);
  const scope = await findApprovalScopeByTokenHash(tokenHash);
  if (!scope) return res.status(404).json({ error: 'Approval link not found' });
  if (scope.error) return res.status(scope.status).json({ error: scope.error });
  if (!ensureLoggedUserAuthorizedForScope(req, res, scope)) return;

  const requests = await listPendingApprovalsByScope(scope);
  res.json({
    current_request_id: scope.sourceLicenseId,
    requests: requests.map((row) => ({
      ...row,
      expiry_date: formatDateForPublicApi(row.expiry_date),
      renewal_date: formatDateForPublicApi(row.renewal_date),
      expires_at: formatDateForPublicApi(row.expires_at, { includeTime: true }),
    })),
  });
});

router.get('/approval/:token/request/:id', optionalAuth, [
  param('token').isString().isLength({ min: 20, max: 300 }),
  param('id').isUUID(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const tokenHash = hashApprovalToken(req.params.token);
  const scope = await findApprovalScopeByTokenHash(tokenHash);
  if (!scope) return res.status(404).json({ error: 'Approval link not found' });
  if (scope.error) return res.status(scope.status).json({ error: scope.error });
  if (!ensureLoggedUserAuthorizedForScope(req, res, scope)) return;

  const row = await getApprovalInfoByScope(scope, req.params.id);
  if (!row) return res.status(404).json({ error: 'Approval request not found' });

  res.json({
    ...row,
    expiry_date: formatDateForPublicApi(row.expiry_date),
    renewal_date: formatDateForPublicApi(row.renewal_date),
    expires_at: formatDateForPublicApi(row.expires_at, { includeTime: true }),
  });
});

router.post('/approval/:token/request/:id/approve', optionalAuth, [
  param('token').isString().isLength({ min: 20, max: 300 }),
  param('id').isUUID(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const tokenHash = hashApprovalToken(req.params.token);
  const scope = await findApprovalScopeByTokenHash(tokenHash);
  if (!scope) return res.status(404).json({ error: 'Approval link not found' });
  if (scope.error) return res.status(scope.status).json({ error: scope.error });
  if (!ensureLoggedUserAuthorizedForScope(req, res, scope)) return;

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
    approval_status: 'approved',
    acted_by: scope.approverActorLabel || 'Approver',
    approved_at: new Date().toISOString(),
  }, true).catch(() => {});

  res.json({ message: 'License approved' });
});

router.post('/approval/:token/request/:id/reject', optionalAuth, [
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
  if (!ensureLoggedUserAuthorizedForScope(req, res, scope)) return;

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
    approval_status: 'rejected',
    acted_by: scope.approverActorLabel || 'Approver',
    rejected_at: new Date().toISOString(),
    reason: req.body.reason || '-',
    rejection_reason: req.body.reason || '-',
  }, true).catch(() => {});

  res.json({ message: 'License rejected' });
});

router.get('/approval/:token', optionalAuth, [param('token').isString().isLength({ min: 20, max: 300 })], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const tokenHash = hashApprovalToken(req.params.token);
  const scope = await findApprovalScopeByTokenHash(tokenHash);
  if (!scope) return res.status(404).json({ error: 'Approval link not found' });
  if (scope.error) return res.status(scope.status).json({ error: scope.error });
  if (!ensureLoggedUserAuthorizedForScope(req, res, scope)) return;

  const row = await getOne(
    `SELECT l.id, l.name, l.description, l.approval_status, l.expiry_date, l.renewal_date, l.approval_required,
            l.documents,
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
    expiry_date: formatDateForPublicApi(row.expiry_date),
    renewal_date: formatDateForPublicApi(row.renewal_date),
    documents: row.documents,
    expires_at: formatDateForPublicApi(row.approval_token_expires_at, { includeTime: true }),
  });
});

router.get('/status/:token', [param('token').isString().isLength({ min: 20, max: 300 })], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const tokenHash = hashStatusToken(req.params.token);
  const row = await getOne(
    `SELECT l.id, l.name, l.description, l.approval_status, l.approval_requested_at, l.approved_at, l.rejected_at,
            l.rejection_reason, l.expiry_date, l.renewal_date, l.approval_required, l.status_token_expires_at,
            l.approver_contact,
            ua.display_name AS approver_user_display_name,
            ua.username AS approver_user_username,
            ua.email AS approver_user_email,
            ua.office AS approver_user_office,
            ua.auth_type AS approver_user_auth_type,
            s.company AS supplier_company
     FROM licenses l
     LEFT JOIN users ua ON ua.id=l.approver_user_id
     LEFT JOIN suppliers s ON s.id=l.supplier_id
     WHERE l.status_token_hash=$1`,
    [tokenHash]
  );
  if (!row) return res.status(404).json({ error: 'Status link not found' });
  if (!row.approval_required) return res.status(400).json({ error: 'Approval is not required for this license' });
  if (row.status_token_expires_at && new Date(row.status_token_expires_at).getTime() < Date.now()) {
    return res.status(410).json({ error: 'Status link expired' });
  }

  const generalCfg = await getGeneralConfig();
  const approversNotified = buildApproversNotified(row, String(generalCfg?.app_name || '').trim());
  const approverEmails = [...new Set(
    approversNotified
      .map(v => String(v?.email || '').trim().toLowerCase())
      .filter(Boolean)
  )];

  res.json({
    id: row.id,
    name: row.name,
    description: row.description,
    supplier_company: row.supplier_company,
    approval_status: row.approval_status,
    approval_requested_at: formatDateForPublicApi(row.approval_requested_at, { includeTime: true }),
    approved_at: formatDateForPublicApi(row.approved_at, { includeTime: true }),
    rejected_at: formatDateForPublicApi(row.rejected_at, { includeTime: true }),
    rejection_reason: row.rejection_reason,
    expiry_date: formatDateForPublicApi(row.expiry_date),
    renewal_date: formatDateForPublicApi(row.renewal_date),
    approvers_notified: approversNotified,
    approver_emails: approverEmails,
    status_link_expires_at: formatDateForPublicApi(row.status_token_expires_at, { includeTime: true }),
  });
});

router.post('/approval/:token/approve', optionalAuth, [param('token').isString().isLength({ min: 20, max: 300 })], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const tokenHash = hashApprovalToken(req.params.token);
  const scope = await findApprovalScopeByTokenHash(tokenHash);
  if (!scope) return res.status(404).json({ error: 'Approval link not found' });
  if (scope.error) return res.status(scope.status).json({ error: scope.error });
  if (!ensureLoggedUserAuthorizedForScope(req, res, scope)) return;

  const row = await getOne(
    `SELECT l.id, l.approval_status, l.approval_token_expires_at,
            l.approver_contact,
            ua.display_name AS approver_user_display_name,
            ua.username AS approver_user_username,
            ua.email AS approver_user_email,
            ua.office AS approver_user_office
     FROM licenses l
     LEFT JOIN users ua ON ua.id=l.approver_user_id
     WHERE l.approval_token_hash=$1`,
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

  const approverIdentity = extractApproverIdentity(row);

  await notifyLicenseEvent('license_approved', row.id, {
    approval_status: 'approved',
    acted_by: approverIdentity.approverActorLabel || 'Approver',
    approved_at: new Date().toISOString(),
  }).catch(() => {});

  res.json({ message: 'License approved' });
});

router.post('/approval/:token/reject', optionalAuth, [
  param('token').isString().isLength({ min: 20, max: 300 }),
  body('reason').optional().isString().isLength({ max: 2000 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const tokenHash = hashApprovalToken(req.params.token);
  const scope = await findApprovalScopeByTokenHash(tokenHash);
  if (!scope) return res.status(404).json({ error: 'Approval link not found' });
  if (scope.error) return res.status(scope.status).json({ error: scope.error });
  if (!ensureLoggedUserAuthorizedForScope(req, res, scope)) return;

  const row = await getOne(
    `SELECT l.id, l.approval_status, l.approval_token_expires_at,
            l.approver_contact,
            ua.display_name AS approver_user_display_name,
            ua.username AS approver_user_username,
            ua.email AS approver_user_email,
            ua.office AS approver_user_office
     FROM licenses l
     LEFT JOIN users ua ON ua.id=l.approver_user_id
     WHERE l.approval_token_hash=$1`,
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

  const approverIdentity = extractApproverIdentity(row);

  await notifyLicenseEvent('license_rejected', row.id, {
    approval_status: 'rejected',
    acted_by: approverIdentity.approverActorLabel || 'Approver',
    rejected_at: new Date().toISOString(),
    reason: req.body.reason || '-',
    rejection_reason: req.body.reason || '-',
  }).catch(() => {});

  res.json({ message: 'License rejected' });
});

router.use(requireAuth);

function normalizeDocuments(value) {
  if (!Array.isArray(value)) return [];

  const malformedToPath = (input) => {
    const trimmed = String(input || '').trim();
    if (!trimmed) return '';
    const malformedMatch = trimmed.match(/^https?:\/\/\/+(.+)$/i);
    if (!malformedMatch) return trimmed;
    return `/${String(malformedMatch[1] || '').replace(/^\/+/, '')}`;
  };

  return value
    .filter(d => d && typeof d === 'object')
    .map(d => ({
      name: String(d.name || '').trim(),
      url: malformedToPath(d.url),
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
  qv('limit').optional().isInt({ min: 1, max: 500 }),
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
            COALESCE(la.asset_count, 0) AS asset_count,
            COALESCE(ls.service_count, 0) AS service_count
     FROM licenses l
     LEFT JOIN users uo ON uo.id = l.owner_user_id
     LEFT JOIN users um ON um.id = l.maintainer_user_id
     LEFT JOIN users ua ON ua.id = l.approver_user_id
     LEFT JOIN suppliers s ON s.id = l.supplier_id
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS asset_count
       FROM license_assets la
       WHERE la.license_id = l.id
     ) la ON TRUE
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS service_count
       FROM license_services ls
       WHERE ls.license_id = l.id
     ) ls ON TRUE
     ${whereSql}
     ORDER BY l.expiry_date NULLS LAST, l.name
     LIMIT $${idx} OFFSET $${idx + 1}`,
    [...vals, limit, offset]
  );

  res.json({
    data: rows.map((row) => ({
      ...row,
      activation_date: formatDateForPublicApi(row.activation_date),
      custom_expiry_date: formatDateForPublicApi(row.custom_expiry_date),
      expiry_date: formatDateForPublicApi(row.expiry_date),
      renewal_date: formatDateForPublicApi(row.renewal_date),
      approval_requested_at: formatDateForPublicApi(row.approval_requested_at, { includeTime: true }),
      approved_at: formatDateForPublicApi(row.approved_at, { includeTime: true }),
      rejected_at: formatDateForPublicApi(row.rejected_at, { includeTime: true }),
    })),
    total,
    page,
    limit,
  });
});

router.get('/report', requireAuth, async (req, res) => {
  const rows = await getMany(
    `SELECT l.name, l.approval_status, l.expiry_date, l.renewal_date, l.estimated_cost, l.currency,
            s.company AS supplier,
            (SELECT COUNT(*)::int FROM license_assets la WHERE la.license_id=l.id) AS asset_count,
            (SELECT COUNT(*)::int FROM license_services ls WHERE ls.license_id=l.id) AS service_count
     FROM licenses l
     LEFT JOIN suppliers s ON s.id=l.supplier_id
     WHERE l.is_active=true
     ORDER BY l.expiry_date NULLS LAST, l.name`
  );
  const headers = ['Name', 'Approval status', 'Expiry date', 'Renewal date', 'Supplier', 'Estimated cost', 'Currency', 'Assets', 'Services'];
  const values = rows.map(row => [row.name, row.approval_status, row.expiry_date || '', row.renewal_date || '', row.supplier || '', row.estimated_cost || '', row.currency || '', row.asset_count, row.service_count]);
  const csv = [headers, ...values].map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=licenses-report.csv');
  res.send(`\uFEFF${csv}`);
});

router.get('/:id/history', [param('id').isUUID()], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const rows = await getMany(
    `SELECT h.*, u.display_name AS changed_by_name
     FROM license_renewal_history h
     LEFT JOIN users u ON u.id=h.changed_by
     WHERE h.license_id=$1 ORDER BY h.created_at DESC`,
    [req.params.id]
  );
  res.json(rows);
});

router.post('/:id/renew', requireAdmin, [
  param('id').isUUID(),
  body('new_expiry_date').isISO8601(),
  body('renewal_date').optional({ nullable: true }).isISO8601(),
  body('notes').optional().isString(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const license = await getOne('SELECT id, expiry_date FROM licenses WHERE id=$1', [req.params.id]);
  if (!license) return res.status(404).json({ error: 'License not found' });
  await transaction(async (client) => {
    await client.query('UPDATE licenses SET expiry_date=$1, renewal_date=$2, updated_at=NOW() WHERE id=$3', [req.body.new_expiry_date, req.body.renewal_date || null, req.params.id]);
    await client.query('INSERT INTO license_renewal_history (license_id, previous_expiry_date, new_expiry_date, renewal_date, notes, changed_by) VALUES ($1,$2,$3,$4,$5,$6)', [req.params.id, license.expiry_date, req.body.new_expiry_date, req.body.renewal_date || null, req.body.notes || null, req.user.id]);
  });
  res.json({ message: 'License renewed successfully' });
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

  res.json({
    ...row,
    activation_date: formatDateForPublicApi(row.activation_date),
    custom_expiry_date: formatDateForPublicApi(row.custom_expiry_date),
    expiry_date: formatDateForPublicApi(row.expiry_date),
    renewal_date: formatDateForPublicApi(row.renewal_date),
    approval_requested_at: formatDateForPublicApi(row.approval_requested_at, { includeTime: true }),
    approved_at: formatDateForPublicApi(row.approved_at, { includeTime: true }),
    rejected_at: formatDateForPublicApi(row.rejected_at, { includeTime: true }),
    approval_token_expires_at: formatDateForPublicApi(row.approval_token_expires_at, { includeTime: true }),
    status_token_expires_at: formatDateForPublicApi(row.status_token_expires_at, { includeTime: true }),
    assets,
    services,
  });
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
  body('activation_date').optional({ nullable: true }).isISO8601(),
  body('duration_months').optional({ nullable: true }).isInt({ min: 1, max: 120 }),
  body('custom_expiry_date').optional({ nullable: true }).isISO8601(),
  body('expiry_date').optional({ nullable: true }).isISO8601(),
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
      activation_date, duration_months, custom_expiry_date, expiry_date, reminder_days, approval_required, approval_status,
      estimated_cost, currency, notes, documents, created_by, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,NOW())
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
      req.body.activation_date || null,
      req.body.duration_months || null,
      req.body.custom_expiry_date || null,
      computeLicenseExpiry(req.body),
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
  body('activation_date').optional({ nullable: true }).isISO8601(),
  body('duration_months').optional({ nullable: true }).isInt({ min: 1, max: 120 }),
  body('custom_expiry_date').optional({ nullable: true }).isISO8601(),
  body('expiry_date').optional({ nullable: true }).isISO8601(),
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
    'activation_date', 'duration_months', 'custom_expiry_date', 'reminder_days', 'approval_required', 'approval_status',
    'estimated_cost', 'currency', 'notes'
  ];

  for (const key of allowed) {
    if (req.body[key] !== undefined) setField(key, req.body[key] === '' ? null : req.body[key]);
  }
  if (req.body.owner_contact !== undefined) setField('owner_contact', req.body.owner_contact ? JSON.stringify(req.body.owner_contact) : null);
  if (req.body.maintainer_contact !== undefined) setField('maintainer_contact', req.body.maintainer_contact ? JSON.stringify(req.body.maintainer_contact) : null);
  if (req.body.approver_contact !== undefined) setField('approver_contact', req.body.approver_contact ? JSON.stringify(req.body.approver_contact) : null);
  if (req.body.documents !== undefined) setField('documents', JSON.stringify(normalizeDocuments(req.body.documents)));
  if (req.body.activation_date !== undefined || req.body.duration_months !== undefined || req.body.custom_expiry_date !== undefined || req.body.expiry_date !== undefined) {
    const nextExpiry = computeLicenseExpiry({
      activation_date: req.body.activation_date !== undefined ? req.body.activation_date : (await getOne('SELECT activation_date FROM licenses WHERE id=$1', [req.params.id]))?.activation_date,
      duration_months: req.body.duration_months !== undefined ? req.body.duration_months : (await getOne('SELECT duration_months FROM licenses WHERE id=$1', [req.params.id]))?.duration_months,
      custom_expiry_date: req.body.custom_expiry_date !== undefined ? req.body.custom_expiry_date : (await getOne('SELECT custom_expiry_date FROM licenses WHERE id=$1', [req.params.id]))?.custom_expiry_date,
      expiry_date: req.body.expiry_date !== undefined ? req.body.expiry_date : (await getOne('SELECT expiry_date FROM licenses WHERE id=$1', [req.params.id]))?.expiry_date,
    });
    if (nextExpiry !== null) setField('expiry_date', nextExpiry);
  }

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
    approval_status: 'approved',
    acted_by: formatActorLabel(
      req.user?.display_name || req.user?.username || '',
      req.user?.email || '',
      req.user?.office || ''
    ),
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
    approval_status: 'rejected',
    acted_by: formatActorLabel(
      req.user?.display_name || req.user?.username || '',
      req.user?.email || '',
      req.user?.office || ''
    ),
    rejected_at: new Date().toISOString(),
    reason: req.body.reason || '-',
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

  const approverEmails = new Set(collectContactEmails(lic.approver_contact));
  if (lic.approver_user_email) approverEmails.add(String(lic.approver_user_email).trim().toLowerCase());
  if (approverEmails.size === 0) return res.status(400).json({ error: 'No approver email configured' });

  const context = await getLicenseNotificationContext(lic.id);
  const recipients = context
    ? collectLicenseRecipientEmails(context, true)
    : [...new Set([
        ...collectContactEmails(lic.approver_contact),
        lic.approver_user_email,
      ].filter(Boolean).map(v => String(v).trim().toLowerCase()))];
  if (recipients.length === 0) return res.status(400).json({ error: 'No recipients configured for this license' });

  const hours = Number(req.body.expiry_hours || 72);
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashApprovalToken(token);
  const statusToken = crypto.randomBytes(32).toString('hex');
  const statusTokenHash = hashStatusToken(statusToken);
  const statusTokenExpiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

  const updated = await query(
    `UPDATE licenses
     SET approval_status='pending', approval_token_hash=$1, approval_token_expires_at=$2,
         status_token_hash=$3, status_token_expires_at=$4,
         approved_at=NULL, approved_by=NULL,
         rejected_at=NULL, rejected_by=NULL, rejection_reason=NULL,
         approval_requested_at=NOW(), updated_at=NOW()
     WHERE id=$5
     RETURNING approval_requested_at`,
    [tokenHash, expiresAt.toISOString(), statusTokenHash, statusTokenExpiresAt.toISOString(), lic.id]
  );
  const approvalRequestedAt = updated.rows?.[0]?.approval_requested_at || null;

  const appBaseUrl = await getAppBaseUrl();
  const approvalUrl = `${appBaseUrl}/licenses/approval?token=${token}`;
  const statusUrl = `${appBaseUrl}/licenses/approval-status?token=${statusToken}`;

  const approverRecipients = context ? collectApproverRecipientEmails(context) : recipients;
  const stakeholderRecipients = context ? collectStakeholderRecipientEmails(context) : [];
  const approverUserIds = context ? collectApproverRecipientUserIds(context) : [];
  const stakeholderUserIds = context ? collectStakeholderRecipientUserIds(context) : [];
  const normalizedApprovers = [...new Set(approverRecipients.map(v => String(v || '').trim().toLowerCase()).filter(Boolean))];
  const normalizedStakeholders = [...new Set(
    stakeholderRecipients
      .map(v => String(v || '').trim().toLowerCase())
      .filter(Boolean)
      .filter(v => !normalizedApprovers.includes(v))
  )];
  const approverMatchedUserIds = await resolveExistingActiveUserIdsByEmails(normalizedApprovers);
  const stakeholderMatchedUserIds = await resolveExistingActiveUserIdsByEmails(normalizedStakeholders);
  const normalizedApproverUserIds = await resolveExistingActiveUserIds(
    [...new Set([
      ...approverUserIds.map(v => String(v || '').trim()).filter(Boolean),
      ...approverMatchedUserIds,
    ])]
  );
  const normalizedStakeholderUserIds = await resolveExistingActiveUserIds(
    [...new Set(
      [
        ...stakeholderUserIds.map(v => String(v || '').trim()).filter(Boolean),
        ...stakeholderMatchedUserIds,
      ]
        .filter(v => !normalizedApproverUserIds.includes(v))
    )]
  );

  const requesterBase = String(req.user?.display_name || req.user?.username || req.user?.email || 'Requester').trim();
  const requesterAuthType = String(req.user?.auth_type || '').trim().toLowerCase();
  const includeOrgDetails = requesterAuthType === 'ldap' || requesterAuthType === 'local';
  const requesterCompany = includeOrgDetails
    ? String(req.user?.company || req.user?.organization || req.user?.org || '').trim()
    : '';
  const requesterOffice = includeOrgDetails
    ? String(req.user?.office || '').trim()
    : '';
  const requesterDetails = [requesterCompany, requesterOffice].filter(Boolean);
  const requesterName = requesterDetails.length > 0
    ? `${requesterBase} (${requesterDetails.join(', ')})`
    : requesterBase;

  const vars = buildLicenseTemplateVars(context || { id: lic.id, name: lic.name }, {
    app_url: appBaseUrl,
    approval_url: approvalUrl,
    status_url: statusUrl,
    approval_status: 'pending',
    expires_at: formatDateForEmail(expiresAt, { includeTime: true }),
    approver_email: normalizedApprovers[0] || '',
    requester_name: requesterName,
  });

  if (normalizedApprovers.length > 0) {
    await sendEmailNotification('license_approval_requested', normalizedApprovers, vars, 'license', lic.id);
  }
  if (normalizedStakeholders.length > 0) {
    await sendEmailNotification('license_approval_requested_info', normalizedStakeholders, vars, 'license', lic.id);
  }
  const inAppTasks = [];
  const approverInApp = buildLicenseInAppPayload('license_approval_requested', context || { name: lic.name }, vars);
  const stakeholderInApp = buildLicenseInAppPayload('license_approval_requested_info', context || { name: lic.name }, vars);
  if (normalizedApproverUserIds.length > 0) {
    inAppTasks.push(Promise.all(
      normalizedApproverUserIds.map((uid) =>
        sendInApp(uid, approverInApp.type, approverInApp.title, approverInApp.message, 'license', lic.id)
      )
    ));
  }
  if (normalizedStakeholderUserIds.length > 0) {
    inAppTasks.push(Promise.all(
      normalizedStakeholderUserIds.map((uid) =>
        sendInApp(uid, stakeholderInApp.type, stakeholderInApp.title, stakeholderInApp.message, 'license', lic.id)
      )
    ));
  }
  if (inAppTasks.length > 0) {
    await Promise.allSettled(inAppTasks);
  }

  res.json({
    message: `Approval request sent to ${[...new Set([...normalizedApprovers, ...normalizedStakeholders])].join(', ')}`,
    expires_at: formatDateForPublicApi(expiresAt, { includeTime: true }),
    approval_requested_at: formatDateForPublicApi(approvalRequestedAt, { includeTime: true }),
  });
});

router.delete('/:id', requireAdmin, [param('id').isUUID()], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  await query('DELETE FROM licenses WHERE id=$1', [req.params.id]);
  res.json({ message: 'License deleted' });
});

module.exports = router;
