const { Router } = require('express');
const { body, validationResult } = require('express-validator');
const { requireAuth, requireAdmin, requireSuperAdmin } = require('../middleware/authMiddleware');
const { query, getOne, getMany, transaction } = require('../db/database');
const { encrypt, isEncrypted } = require('../utils/encryption');
const ldapService = require('../services/ldapService');
const samlService = require('../services/samlService');
const authService = require('../services/authService');
const { testSmtp, getSmtpConfig, sendMail } = require('../utils/mailer');
const auditService = require('../services/auditService');

const router = Router();

function getDefaultGeneralSettings() {
  return {
    app_name: 'GB Maintenance',
    app_url: '',
    app_brand_image_url: '',
    default_language: 'it',
    require_approval_for: ['critical', 'high'],
    audit_log_retention_days: 365,
    audit_log_auto_purge: true,
    maintenance_reminders: ['7d', '1d', '2h', '30m'],
    approval_page_title: 'License Approval',
    approval_page_subtitle: 'Review the request and confirm whether the license can be approved.',
    approval_page_logo_url: '',
    approval_page_primary_color: '#2563eb',
    approval_page_side_kicker: 'Approval Flow',
    approval_page_side_title: 'Simple, but brandable',
    approval_page_side_description: "This page can now be branded from Licenses > Template with company name, custom title, subtitle, logo, and primary color, so the approval request feels like part of the customer's own portal.",
    approval_page_side_rows_count: 4,
    approval_page_side_point_1: 'Company/app name shown in the public header',
    approval_page_side_point_2: 'Custom title and subtitle for approval requests',
    approval_page_side_point_3: 'Company logo uploaded from Licenses > Template',
    approval_page_side_point_4: 'Primary accent color used for CTA and highlights',
    approval_page_side_point_5: '',
    approval_page_side_point_6: '',
    approval_page_side_point_7: '',
    approval_page_side_point_8: '',
    approval_page_side_icon_1: 'shield-check',
    approval_page_side_icon_2: 'layout-list',
    approval_page_side_icon_3: 'image',
    approval_page_side_icon_4: 'palette',
    approval_page_side_icon_5: 'sparkles',
    approval_page_side_icon_6: 'star',
    approval_page_side_icon_7: 'check-circle',
    approval_page_side_icon_8: 'circle-dot',
    approval_page_back_to_login_label: 'Back to login',
    approval_page_footer_text: 'Powered by {app_name}',
    approval_page_load_button_label: 'Load request',
    approval_page_loading_label: 'Loading approval request...',
    approval_page_approve_button_label: 'Approve',
    approval_page_reject_button_label: 'Reject',
    approval_page_reject_reason_label: 'Reject reason (optional)',
    approval_page_reject_reason_placeholder: 'Add a note for the requester, if needed.',
    approval_page_missing_token_text: 'Missing approval token',
    approval_page_load_error_text: 'Cannot load approval request',
  };
}

async function getDemoRegistry() {
  const row = await getOne("SELECT value FROM settings WHERE key='demo_seed_registry'");
  if (!row?.value) return null;
  try {
    const parsed = JSON.parse(row.value);
    return {
      asset_ids: Array.isArray(parsed.asset_ids) ? parsed.asset_ids : [],
      service_ids: Array.isArray(parsed.service_ids) ? parsed.service_ids : [],
      maintenance_ids: Array.isArray(parsed.maintenance_ids) ? parsed.maintenance_ids : [],
      incident_ids: Array.isArray(parsed.incident_ids) ? parsed.incident_ids : [],
      supplier_ids: Array.isArray(parsed.supplier_ids) ? parsed.supplier_ids : [],
      local_user_ids: Array.isArray(parsed.local_user_ids) ? parsed.local_user_ids : [],
      local_group_ids: Array.isArray(parsed.local_group_ids) ? parsed.local_group_ids : [],
      asset_dependency_count: Number(parsed.asset_dependency_count || 0),
      service_dependency_count: Number(parsed.service_dependency_count || 0),
      seeded_at: parsed.seeded_at || null,
      seeded_by: parsed.seeded_by || null,
      tag: parsed.tag || null,
    };
  } catch {
    return null;
  }
}

function atFromNow(hoursFromNow) {
  return new Date(Date.now() + (hoursFromNow * 60 * 60 * 1000)).toISOString();
}

function atCurrentMonth(day, hour, minute = 0) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const safeDay = Math.max(1, Math.min(28, Number(day) || 1));
  return new Date(year, month, safeDay, hour, minute, 0, 0).toISOString();
}

// ─── GET /api/settings/public-branding ──────────────────────────────────────
router.get('/public-branding', async (req, res) => {
  const row = await getOne("SELECT value FROM settings WHERE key='general_config'");
  const general = row ? JSON.parse(row.value || '{}') : {};
  const defaults = getDefaultGeneralSettings();
  const sideRowsCountRaw = Number(general.approval_page_side_rows_count || defaults.approval_page_side_rows_count);
  const sideRowsCount = Number.isFinite(sideRowsCountRaw) ? Math.min(8, Math.max(1, Math.trunc(sideRowsCountRaw))) : 4;

  res.json({
    app_name: general.app_name || defaults.app_name,
    app_url: general.app_url || defaults.app_url,
    app_brand_image_url: general.app_brand_image_url || defaults.app_brand_image_url,
    approval_page_title: general.approval_page_title || defaults.approval_page_title,
    approval_page_subtitle: general.approval_page_subtitle || defaults.approval_page_subtitle,
    approval_page_logo_url: general.approval_page_logo_url || defaults.approval_page_logo_url,
    approval_page_primary_color: general.approval_page_primary_color || defaults.approval_page_primary_color,
    approval_page_side_kicker: general.approval_page_side_kicker || defaults.approval_page_side_kicker,
    approval_page_side_title: general.approval_page_side_title || defaults.approval_page_side_title,
    approval_page_side_description: general.approval_page_side_description || defaults.approval_page_side_description,
    approval_page_side_rows_count: sideRowsCount,
    approval_page_side_point_1: general.approval_page_side_point_1 || defaults.approval_page_side_point_1,
    approval_page_side_point_2: general.approval_page_side_point_2 || defaults.approval_page_side_point_2,
    approval_page_side_point_3: general.approval_page_side_point_3 || defaults.approval_page_side_point_3,
    approval_page_side_point_4: general.approval_page_side_point_4 || defaults.approval_page_side_point_4,
    approval_page_side_point_5: general.approval_page_side_point_5 || defaults.approval_page_side_point_5,
    approval_page_side_point_6: general.approval_page_side_point_6 || defaults.approval_page_side_point_6,
    approval_page_side_point_7: general.approval_page_side_point_7 || defaults.approval_page_side_point_7,
    approval_page_side_point_8: general.approval_page_side_point_8 || defaults.approval_page_side_point_8,
    approval_page_side_icon_1: general.approval_page_side_icon_1 || defaults.approval_page_side_icon_1,
    approval_page_side_icon_2: general.approval_page_side_icon_2 || defaults.approval_page_side_icon_2,
    approval_page_side_icon_3: general.approval_page_side_icon_3 || defaults.approval_page_side_icon_3,
    approval_page_side_icon_4: general.approval_page_side_icon_4 || defaults.approval_page_side_icon_4,
    approval_page_side_icon_5: general.approval_page_side_icon_5 || defaults.approval_page_side_icon_5,
    approval_page_side_icon_6: general.approval_page_side_icon_6 || defaults.approval_page_side_icon_6,
    approval_page_side_icon_7: general.approval_page_side_icon_7 || defaults.approval_page_side_icon_7,
    approval_page_side_icon_8: general.approval_page_side_icon_8 || defaults.approval_page_side_icon_8,
    approval_page_back_to_login_label: general.approval_page_back_to_login_label || defaults.approval_page_back_to_login_label,
    approval_page_footer_text: general.approval_page_footer_text || defaults.approval_page_footer_text,
    approval_page_load_button_label: general.approval_page_load_button_label || defaults.approval_page_load_button_label,
    approval_page_loading_label: general.approval_page_loading_label || defaults.approval_page_loading_label,
    approval_page_approve_button_label: general.approval_page_approve_button_label || defaults.approval_page_approve_button_label,
    approval_page_reject_button_label: general.approval_page_reject_button_label || defaults.approval_page_reject_button_label,
    approval_page_refresh_button_label: general.approval_page_refresh_button_label || defaults.approval_page_refresh_button_label,
    approval_page_reject_reason_label: general.approval_page_reject_reason_label || defaults.approval_page_reject_reason_label,
    approval_page_reject_reason_placeholder: general.approval_page_reject_reason_placeholder || defaults.approval_page_reject_reason_placeholder,
    approval_page_missing_token_text: general.approval_page_missing_token_text || defaults.approval_page_missing_token_text,
    approval_page_load_error_text: general.approval_page_load_error_text || defaults.approval_page_load_error_text,
  });
});

// ─── GET /api/settings ────────────────────────────────────────────────────────
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  const rows = await getMany('SELECT key, updated_at FROM settings ORDER BY key');
  res.json(rows.map(r => r.key));
});

// ─── GET /api/settings/smtp ───────────────────────────────────────────────────
router.get('/smtp', requireAuth, requireAdmin, async (req, res) => {
  const cfg = await getSmtpConfig();
  if (!cfg) return res.json({});
  const safe = { ...cfg };
  if (safe.pass) safe.pass = '********';
  res.json(safe);
});

// ─── PUT /api/settings/smtp ───────────────────────────────────────────────────
router.put('/smtp', requireAuth, requireAdmin, [
  body('host').isString().trim().notEmpty(),
  body('port').isInt({ min: 1, max: 65535 }),
  body('user').optional().isString(),
  body('from').optional().isString(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const existing = await getSmtpConfig() || {};
  const cfg = {
    host: req.body.host,
    port: req.body.port,
    secure: req.body.secure || false,
    ignoreTls: req.body.ignoreTls !== undefined ? !!req.body.ignoreTls : !!existing.ignoreTls,
    user: req.body.user || '',
    pass: req.body.pass ? encrypt(req.body.pass) : (existing.pass || ''),
    from: req.body.from || `GB Maintenance <${req.body.user}>`,
  };
  await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ('smtp_config', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`,
    [JSON.stringify(cfg)]
  );
  await auditService.log(req.user.id, req.user.username, 'settings:update', 'settings', 'smtp_config', null, req.ip);
  res.json({ message: 'Configurazione SMTP salvata' });
});

// ─── POST /api/settings/smtp/test ────────────────────────────────────────────
router.post('/smtp/test', requireAuth, requireAdmin, [
  body('to').isEmail().withMessage('Valid recipient email is required'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const existing = await getSmtpConfig();
    const cfg = {
      ...existing,
      ...(req.body.host ? req.body : {}),
    };
    await testSmtp(cfg);

    const now = new Date().toISOString();
    const info = await sendMail({
      to: req.body.to,
      subject: 'GB Maintenance SMTP test',
      text: `SMTP test message sent at ${now}`,
      html: `<p>SMTP test message sent at <strong>${now}</strong>.</p>`
    });

    res.json({
      message: `SMTP connection OK, test email queued to ${req.body.to}`,
      delivery: info || null
    });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ─── GET/PUT /api/settings/ldap ───────────────────────────────────────────────
router.get('/ldap', requireAuth, requireSuperAdmin, async (req, res) => {
  const cfg = await ldapService.getLdapSettings();
  if (!cfg) return res.json({});
  const safe = { ...cfg };
  if (safe.bind_password) safe.bind_password = '********';
  res.json(safe);
});

router.put('/ldap', requireAuth, requireSuperAdmin, async (req, res) => {
  await ldapService.saveLdapSettings(req.body);
  await auditService.log(req.user.id, req.user.username, 'settings:update', 'settings', 'ldap_config', null, req.ip);
  res.json({ message: 'Configurazione LDAP salvata' });
});

router.post('/ldap/test', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const cfg = req.body.url ? req.body : await ldapService.getLdapSettings();
    if (!cfg) return res.status(400).json({ error: 'LDAP non configurato' });
    await ldapService.testLdapConnection(cfg);
    res.json({ message: 'Connessione LDAP riuscita' });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ─── GET /api/settings/ldap/groups ───────────────────────────────────────────
router.get('/ldap/groups', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const groups = await ldapService.searchGroups(req.query.q || '');
    res.json(groups);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET /api/settings/ldap/users ────────────────────────────────────────────
router.get('/ldap/users', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const users = await ldapService.searchUsers(req.query.q || '');
    res.json(users);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET/PUT /api/settings/saml ───────────────────────────────────────────────
router.get('/saml', requireAuth, requireSuperAdmin, async (req, res) => {
  const cfg = await samlService.getSamlSettings();
  if (!cfg) return res.json({});
  const safe = { ...cfg };
  if (safe.sp_private_key) safe.sp_private_key = '********';
  res.json(safe);
});

router.put('/saml', requireAuth, requireSuperAdmin, async (req, res) => {
  await samlService.saveSamlSettings(req.body);
  await auditService.log(req.user.id, req.user.username, 'settings:update', 'settings', 'saml_config', null, req.ip);
  res.json({ message: 'Configurazione SAML salvata' });
});

// ─── GET/PUT /api/settings/webhooks ──────────────────────────────────────────
router.get('/webhooks', requireAuth, requireAdmin, async (req, res) => {
  const row = await getOne("SELECT value FROM settings WHERE key='webhook_config'");
  res.json(row ? JSON.parse(row.value) : []);
});

router.put('/webhooks', requireAuth, requireAdmin, [
  body().isArray(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ('webhook_config', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`,
    [JSON.stringify(req.body)]
  );
  res.json({ message: 'Webhook salvati' });
});

// ─── GET/PUT /api/settings/general ───────────────────────────────────────────
router.get('/general', requireAuth, requireSuperAdmin, async (req, res) => {
  const row = await getOne("SELECT value FROM settings WHERE key='general_config'");
  res.json(row ? { ...getDefaultGeneralSettings(), ...JSON.parse(row.value) } : getDefaultGeneralSettings());
});

router.put('/general', requireAuth, requireSuperAdmin, async (req, res) => {
  await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ('general_config', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`,
    [JSON.stringify(req.body)]
  );
  await auditService.log(req.user.id, req.user.username, 'settings:update', 'settings', 'general_config', null, req.ip);
  res.json({ message: 'Impostazioni generali salvate' });
});

// ─── GET/PUT /api/settings/ntp ────────────────────────────────────────────────
router.get('/ntp', requireAuth, requireAdmin, async (req, res) => {
  const row = await getOne("SELECT value FROM settings WHERE key='ntp_config'");
  res.json(row ? JSON.parse(row.value) : { ntp_server: 'pool.ntp.org', timezone: 'Europe/Rome' });
});

router.put('/ntp', requireAuth, requireAdmin, [
  body('ntp_server').optional().isString().trim(),
  body('timezone').optional().isString().trim(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const cfg = {
    ntp_server: req.body.ntp_server || 'pool.ntp.org',
    timezone: req.body.timezone || 'Europe/Rome',
    note: req.body.note || '',
  };
  await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ('ntp_config', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`,
    [JSON.stringify(cfg)]
  );
  await auditService.log(req.user.id, req.user.username, 'settings:update', 'settings', 'ntp_config', null, req.ip);
  res.json({ message: 'NTP/timezone configuration saved' });
});

// ─── POST /api/settings/ntp/query ─────────────────────────────────────────────
router.post('/ntp/query', requireAuth, requireAdmin, async (req, res) => {
  const server = (req.body.server || 'pool.ntp.org').trim();
  const dgram = require('dgram');
  const NTP_PORT = 123;
  try {
    const result = await new Promise((resolve, reject) => {
      const client = dgram.createSocket('udp4');
      const buf = Buffer.alloc(48);
      buf[0] = 0x1b; // LI=0, VN=3, Mode=3 (client)
      const t1 = Date.now();
      client.send(buf, 0, buf.length, NTP_PORT, server, err => {
        if (err) { client.close(); reject(err); }
      });
      client.on('message', msg => {
        const t4 = Date.now();
        const secs = msg.readUInt32BE(40);
        const serverMs = (secs - 2208988800) * 1000;
        const offset = Math.round(((serverMs - t1) + (serverMs - t4)) / 2);
        client.close();
        resolve({ server_time: new Date(serverMs).toISOString(), offset_ms: offset });
      });
      client.on('error', err => { try { client.close(); } catch {} reject(err); });
      setTimeout(() => { try { client.close(); } catch {} reject(new Error('NTP query timeout (5s)')); }, 5000);
    });
    res.json({ success: true, server, server_time: result.server_time, offset_ms: result.offset_ms, local_time: new Date().toISOString() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── GET/PUT /api/settings/role-presets ───────────────────────────────────────
router.get('/role-presets', requireAuth, requireAdmin, async (req, res) => {
  const row = await getOne("SELECT value FROM settings WHERE key='role_presets'");
  const saved = row ? JSON.parse(row.value) : [];
  const defaultOrder = ['admin', 'change_manager', 'operator', 'viewer', 'subscriber'];
  const defaults = defaultOrder.map((role) => ({
    id: role,
    name: role,
    description: 'Default role preset',
    permissions: authService.ROLE_DEFAULTS[role] || {},
  }));

  // Legacy upgrade path: if old data has no built-in role IDs, seed defaults once.
  if (!row) return res.json(defaults);

  const safeSaved = Array.isArray(saved) ? saved : [];
  const hasAnyDefaultId = safeSaved.some((p) => defaultOrder.includes(String(p?.id || '')));
  if (!hasAnyDefaultId) {
    const upgraded = [...defaults, ...safeSaved];
    await query(
      `INSERT INTO settings (key, value, updated_at) VALUES ('role_presets', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`,
      [JSON.stringify(upgraded)]
    );
    return res.json(upgraded);
  }

  res.json(safeSaved);
});

router.put('/role-presets', requireAuth, requireAdmin, async (req, res) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ error: 'Expected array' });
  const toSave = req.body
    .filter((p) => p && typeof p === 'object')
    .map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description || '',
      permissions: p.permissions || {},
    }));
  await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ('role_presets', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`,
    [JSON.stringify(toSave)]
  );
  await auditService.log(req.user.id, req.user.username, 'settings:update', 'settings', 'role_presets', null, req.ip);
  res.json({ message: 'Role presets saved' });
});

// ─── Demo Data (superadmin only) ────────────────────────────────────────────
router.get('/demo/status', requireAuth, requireSuperAdmin, async (req, res) => {
  const reg = await getDemoRegistry();
  if (!reg) {
    return res.json({
      exists: false,
      asset_count: 0,
      service_count: 0,
      maintenance_count: 0,
      incident_count: 0,
      supplier_count: 0,
      local_user_count: 0,
      local_group_count: 0,
      asset_dependency_count: 0,
      service_dependency_count: 0,
      seeded_at: null,
      seeded_by: null,
    });
  }
  const total = reg.asset_ids.length + reg.service_ids.length + reg.maintenance_ids.length + reg.incident_ids.length + reg.supplier_ids.length + reg.local_user_ids.length + reg.local_group_ids.length;
  return res.json({
    exists: total > 0,
    asset_count: reg.asset_ids.length,
    service_count: reg.service_ids.length,
    maintenance_count: reg.maintenance_ids.length,
    incident_count: reg.incident_ids.length,
    supplier_count: reg.supplier_ids.length,
    local_user_count: reg.local_user_ids.length,
    local_group_count: reg.local_group_ids.length,
    asset_dependency_count: reg.asset_dependency_count,
    service_dependency_count: reg.service_dependency_count,
    seeded_at: reg.seeded_at,
    seeded_by: reg.seeded_by,
  });
});

router.post('/demo/create', requireAuth, requireSuperAdmin, async (req, res) => {
  const existing = await getDemoRegistry();
  if (existing) {
    const totalExisting = existing.asset_ids.length + existing.service_ids.length + existing.maintenance_ids.length + existing.incident_ids.length + existing.supplier_ids.length + existing.local_user_ids.length + existing.local_group_ids.length;
    if (totalExisting > 0) {
      return res.status(409).json({ error: 'Demo data already exists. Remove it first.' });
    }
  }

  const tag = Date.now();
  const demoEmail = 'guidoballarini.9@gmail.com';

  const localUsersDef = [
    { key: 'ops1', username: 'demo.1', display_name: 'Login demo.1', role: 'operator', office: 'Milan HQ' },
    { key: 'ops2', username: 'demo.2', display_name: 'Login demo.2', role: 'operator', office: 'Rome Branch' },
    { key: 'viewer1', username: 'demo.3', display_name: 'Login demo.3', role: 'viewer', office: 'Turin Office' },
    { key: 'subscriber1', username: 'demo.4', display_name: 'Login demo.4', role: 'subscriber', office: 'Remote NOC' },
  ];

  const suppliersDef = [
    { first: 'Demo', last: 'Cloud', company: 'Acme Cloud SRL' },
    { first: 'Demo', last: 'Network', company: 'NorthNet SPA' },
    { first: 'Demo', last: 'Security', company: 'SafePatch LTD' },
  ];

  const assetsDef = [
    { key: 'portal-web', name: 'Demo Portal Web', category: 'application', criticality: 'high', status: 'operational', desc: 'Frontend portal', owner: 'group', user_targets: ['demo.1', 'demo.3'] },
    { key: 'portal-api', name: 'Demo Portal API', category: 'api', criticality: 'high', status: 'degraded', desc: 'Public API layer', owner: 'group', user_targets: ['demo.1', 'demo.2'] },
    { key: 'auth-service', name: 'Demo Auth Service', category: 'application', criticality: 'critical', status: 'operational', desc: 'Authentication backend', owner: 'user', user_targets: ['demo.2'] },
    { key: 'payments-db', name: 'Demo Payments DB', category: 'database', criticality: 'critical', status: 'operational', desc: 'Payment database', owner: 'user', user_targets: ['demo.1', 'demo.4'] },
    { key: 'reporting-db', name: 'Demo Reporting DB', category: 'database', criticality: 'medium', status: 'operational', desc: 'Reporting data mart', owner: 'group', user_targets: ['demo.3'] },
    { key: 'edge-lb', name: 'Demo Edge Load Balancer', category: 'infrastructure', criticality: 'high', status: 'operational', desc: 'Ingress traffic balancer', owner: 'group', user_targets: ['demo.1', 'demo.2'] },
    { key: 'redis-cache', name: 'Demo Redis Cache', category: 'infrastructure', criticality: 'medium', status: 'degraded', desc: 'Session and cache layer', owner: 'group', user_targets: ['demo.2', 'demo.3'] },
    { key: 'vpn-gateway', name: 'Demo VPN Gateway', category: 'network', criticality: 'medium', status: 'operational', desc: 'Remote office VPN', owner: 'user', user_targets: ['demo.4'] },
    { key: 'etl-engine', name: 'Demo ETL Engine', category: 'application', criticality: 'low', status: 'operational', desc: 'Nightly ETL process', owner: 'user', user_targets: ['demo.3', 'demo.4'] },
    { key: 'email-worker', name: 'Demo Email Worker', category: 'application', criticality: 'low', status: 'major_outage', desc: 'Notification sender worker', owner: 'group', user_targets: ['demo.1', 'demo.4'] },
  ];

  const assetDependenciesDef = [
    ['portal-web', 'portal-api'],
    ['portal-api', 'auth-service'],
    ['portal-api', 'payments-db'],
    ['analytics-etl', 'reporting-db'],
    ['email-worker', 'portal-api'],
  ];

  const servicesDef = [
    { key: 'customer-portal', name: 'Demo Customer Portal', criticality: 'high', status: 'degraded', is_public: true, assets: ['portal-web', 'portal-api', 'edge-lb', 'redis-cache'], owner: 'group', user_targets: ['demo.1', 'demo.3'] },
    { key: 'identity', name: 'Demo Identity Service', criticality: 'critical', status: 'operational', is_public: true, assets: ['auth-service', 'redis-cache'], owner: 'user', user_targets: ['demo.2'] },
    { key: 'billing', name: 'Demo Billing Service', criticality: 'critical', status: 'operational', is_public: true, assets: ['portal-api', 'payments-db'], owner: 'user', user_targets: ['demo.1', 'demo.4'] },
    { key: 'analytics', name: 'Demo Analytics', criticality: 'medium', status: 'operational', is_public: false, assets: ['etl-engine', 'reporting-db'], owner: 'group', user_targets: ['demo.3'] },
    { key: 'internal-vpn', name: 'Demo Internal VPN', criticality: 'medium', status: 'operational', is_public: false, assets: ['vpn-gateway'], owner: 'group', user_targets: ['demo.4'] },
    { key: 'mailing', name: 'Demo Mailing', criticality: 'low', status: 'major_outage', is_public: true, assets: ['email-worker'], owner: 'group', user_targets: ['demo.1', 'demo.4'] },
  ];

  const serviceDependenciesDef = [
    ['customer-portal', 'identity'],
    ['customer-portal', 'billing'],
    ['analytics', 'billing'],
    ['mailing', 'customer-portal'],
  ];

  const maintDef = [
    {
      key: 'db-upgrade',
      title: 'DEMO - Payments DB minor upgrade',
      type: 'upgrade',
      status: 'scheduled',
      impact_level: 'high',
      scheduled_start: atCurrentMonth(5, 9, 0),
      scheduled_end: atCurrentMonth(5, 11, 0),
      actual_start: null,
      actual_end: null,
      reopened_at: null,
      reopen_reason: null,
      note: 'Planned maintenance for schema optimization',
      assets: ['payments-db'],
      services: ['billing'],
    },
    {
      key: 'cache-restart',
      title: 'DEMO - Cache cluster rolling restart',
      type: 'infrastructure',
      status: 'in_progress',
      impact_level: 'medium',
      scheduled_start: atCurrentMonth(12, 8, 0),
      scheduled_end: atCurrentMonth(12, 12, 0),
      actual_start: atCurrentMonth(12, 8, 30),
      actual_end: null,
      reopened_at: null,
      reopen_reason: null,
      note: 'Rolling restart in progress',
      assets: ['redis-cache'],
      services: ['customer-portal', 'identity'],
    },
    {
      key: 'mail-hotfix',
      title: 'DEMO - Email worker hotfix',
      type: 'emergency',
      status: 'in_progress',
      impact_level: 'high',
      scheduled_start: atCurrentMonth(18, 14, 0),
      scheduled_end: atCurrentMonth(18, 16, 0),
      actual_start: atCurrentMonth(18, 14, 15),
      actual_end: atCurrentMonth(18, 15, 0),
      reopened_at: atCurrentMonth(19, 9, 30),
      reopen_reason: 'Recurring SMTP timeout after previous fix',
      note: 'Reopened for additional patching',
      assets: ['email-worker'],
      services: ['mailing'],
    },
    {
      key: 'vpn-health',
      title: 'DEMO - VPN certificate rotation',
      type: 'security_patch',
      status: 'completed',
      impact_level: 'low',
      scheduled_start: atCurrentMonth(24, 10, 0),
      scheduled_end: atCurrentMonth(24, 11, 30),
      actual_start: atCurrentMonth(24, 10, 15),
      actual_end: atCurrentMonth(24, 11, 15),
      reopened_at: null,
      reopen_reason: null,
      note: 'Completed without incidents',
      assets: ['vpn-gateway'],
      services: ['internal-vpn'],
    },
  ];

  const incidentsDef = [
    {
      key: 'portal-latency',
      title: 'DEMO - Elevated latency on customer portal',
      severity: 'high',
      status: 'investigating',
      started_at: atFromNow(-3),
      resolved_at: null,
      description: 'Latency spike detected by synthetic probes.',
      assets: ['portal-api', 'redis-cache'],
      services: ['customer-portal'],
      updates: [
        { status: 'investigating', message: 'Engineers are collecting telemetry.' },
        { status: 'identified', message: 'Cache saturation identified, applying mitigation.' },
      ],
    },
    {
      key: 'mail-delays',
      title: 'DEMO - Delayed outbound notifications',
      severity: 'medium',
      status: 'monitoring',
      started_at: atFromNow(-14),
      resolved_at: null,
      description: 'Email queue backlog during SMTP provider instability.',
      assets: ['email-worker'],
      services: ['mailing'],
      updates: [
        { status: 'investigating', message: 'SMTP endpoint intermittently timing out.' },
        { status: 'monitoring', message: 'Retry policy tuned and queue draining.' },
      ],
    },
    {
      key: 'vpn-outage',
      title: 'DEMO - Temporary VPN disruption',
      severity: 'low',
      status: 'resolved',
      started_at: atFromNow(-48),
      resolved_at: atFromNow(-46),
      description: 'Brief disruption during certificate rollover.',
      assets: ['vpn-gateway'],
      services: ['internal-vpn'],
      updates: [
        { status: 'investigating', message: 'Root cause isolated to expired intermediate cert.' },
        { status: 'resolved', message: 'Certificate chain updated and service restored.' },
      ],
    },
  ];

  const created = await transaction(async (client) => {
    const usersByKey = new Map();
    const assetsByKey = new Map();
    const servicesByKey = new Map();
    const maintenanceByKey = new Map();
    const incidentsByKey = new Map();
    const supplierIds = [];

    const g = await client.query(
      `INSERT INTO local_groups (name, description, permissions, role)
       VALUES ($1,$2,'{}'::jsonb,'viewer')
       RETURNING id`,
      [`Demo Ops ${tag}`, 'Demo local group for seed data management and notification tests']
    );
    const demoGroupId = g.rows[0].id;

    for (const u of localUsersDef) {
      const r = await client.query(
        `INSERT INTO users (username, display_name, email, office, auth_type, role, permissions, is_active)
         VALUES ($1,$2,$3,$4,'local',$5,'{}'::jsonb,true)
         RETURNING id`,
        [u.username, u.display_name, demoEmail, u.office, u.role]
      );
      const uid = r.rows[0].id;
      usersByKey.set(u.key, uid);
      await client.query(`INSERT INTO user_group_members (user_id, group_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [uid, demoGroupId]);
    }

    for (const s of suppliersDef) {
      const r = await client.query(
        `INSERT INTO suppliers (first_name, last_name, company, email, is_active)
         VALUES ($1,$2,$3,$4,true)
         RETURNING id`,
        [s.first, s.last, s.company, demoEmail]
      );
      supplierIds.push(r.rows[0].id);
    }

    for (const a of assetsDef) {
      const ownerUser = usersByKey.get('ops1') || null;
      const ownerType = a.owner === 'group' ? 'local_group' : 'user';
      const ownerGroupId = ownerType === 'local_group' ? demoGroupId : null;
      const ownerId = ownerType === 'user' ? ownerUser : null;
      const userTargets = (a.user_targets || []).map((k) => {
        const uid = usersByKey.get(k);
        return uid ? { type: 'user', id: uid } : null;
      }).filter(Boolean);
      const r = await client.query(
        `INSERT INTO assets (name, slug, category, criticality, description, status, owner_id, owner_type, owner_group_id, user_targets, is_active, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,true,$11::jsonb)
         RETURNING id`,
        [a.name, `demo-${a.key}-${tag}`, a.category, a.criticality, a.desc, a.status, ownerId, ownerType, ownerGroupId, JSON.stringify(userTargets), JSON.stringify({ demo_seed: true, demo_tag: tag })]
      );
      assetsByKey.set(a.key, r.rows[0].id);
    }

    for (const dep of assetDependenciesDef) {
      const aid = assetsByKey.get(dep[0]);
      const did = assetsByKey.get(dep[1]);
      if (aid && did) {
        await client.query(`INSERT INTO asset_dependencies (asset_id, depends_on_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [aid, did]);
      }
    }

    for (const s of servicesDef) {
      const ownerType = s.owner === 'group' ? 'local_group' : 'user';
      const ownerGroupId = ownerType === 'local_group' ? demoGroupId : null;
      const ownerId = ownerType === 'user' ? (usersByKey.get('ops2') || null) : null;
      const userTargets = (s.user_targets || []).map((k) => {
        const uid = usersByKey.get(k);
        return uid ? { type: 'user', id: uid } : null;
      }).filter(Boolean);
      const r = await client.query(
        `INSERT INTO services (name, slug, description, criticality, status, sla_uptime_percent, is_public, owner_id, owner_type, owner_group_id, user_targets, is_active)
         VALUES ($1,$2,$3,$4,$5,99.90,$6,$7,$8,$9,$10::jsonb,true)
         RETURNING id`,
        [s.name, `demo-${s.key}-${tag}`, `Demo service for ${s.name}`, s.criticality, s.status, !!s.is_public, ownerId, ownerType, ownerGroupId, JSON.stringify(userTargets)]
      );
      const sid = r.rows[0].id;
      servicesByKey.set(s.key, sid);
      for (const ak of s.assets) {
        const aid = assetsByKey.get(ak);
        if (aid) {
          await client.query(`INSERT INTO service_assets (service_id, asset_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [sid, aid]);
        }
      }
      for (const uid of usersByKey.values()) {
        await client.query(
          `INSERT INTO service_subscribers (service_id, user_id, email, notify_maintenance, notify_incidents, notify_recovery)
           VALUES ($1,$2,$3,true,true,true)
           ON CONFLICT DO NOTHING`,
          [sid, uid, demoEmail]
        );
      }
    }

    for (const dep of serviceDependenciesDef) {
      const sid = servicesByKey.get(dep[0]);
      const did = servicesByKey.get(dep[1]);
      if (sid && did) {
        await client.query(`INSERT INTO service_dependencies (service_id, depends_on_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [sid, did]);
      }
    }

    for (const m of maintDef) {
      const r = await client.query(
        `INSERT INTO maintenance_windows
          (title, description, type, status, impact_level, scheduled_start, scheduled_end, actual_start, actual_end, created_by, notes, approved_at, reopened_at, reopen_reason, owner_approval_required, owner_approval_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,false,'not_required')
         RETURNING id`,
        [m.title, `Demo maintenance: ${m.title}`, m.type, m.status, m.impact_level, m.scheduled_start, m.scheduled_end, m.actual_start, m.actual_end, req.user.id, m.note, m.status !== 'scheduled' ? m.scheduled_start : null, m.reopened_at, m.reopen_reason]
      );
      const mid = r.rows[0].id;
      maintenanceByKey.set(m.key, mid);

      for (const ak of m.assets) {
        const aid = assetsByKey.get(ak);
        if (aid) await client.query(`INSERT INTO maintenance_assets (maintenance_id, asset_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [mid, aid]);
      }
      for (const sk of m.services) {
        const sid = servicesByKey.get(sk);
        if (sid) await client.query(`INSERT INTO maintenance_services (maintenance_id, service_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [mid, sid]);
      }
      for (const uid of usersByKey.values()) {
        await client.query(`INSERT INTO maintenance_status_subscribers (maintenance_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [mid, uid]);
      }

      await client.query(
        `INSERT INTO status_history (entity_type, entity_id, status, changed_by, reason)
         VALUES ('maintenance',$1,'scheduled',$2,$3)`,
        [mid, req.user.username || req.user.id || 'system', 'Demo maintenance scheduled']
      ).catch(() => {});
      if (m.status === 'in_progress' || m.status === 'completed') {
        await client.query(
          `INSERT INTO status_history (entity_type, entity_id, status, changed_by, reason)
           VALUES ('maintenance',$1,'in_progress',$2,$3)`,
          [mid, req.user.username || req.user.id || 'system', 'Demo maintenance started']
        ).catch(() => {});
      }
      if (m.status === 'completed') {
        await client.query(
          `INSERT INTO status_history (entity_type, entity_id, status, changed_by, reason)
           VALUES ('maintenance',$1,'completed',$2,$3)`,
          [mid, req.user.username || req.user.id || 'system', 'Demo maintenance completed']
        ).catch(() => {});
      }
      if (m.reopened_at) {
        await client.query(
          `INSERT INTO status_history (entity_type, entity_id, status, changed_by, reason)
           VALUES ('maintenance',$1,'reopened',$2,$3)`,
          [mid, req.user.username || req.user.id || 'system', m.reopen_reason || 'Demo maintenance reopened']
        ).catch(() => {});
      }
    }

    for (const i of incidentsDef) {
      const r = await client.query(
        `INSERT INTO incidents (title, description, severity, status, started_at, resolved_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id`,
        [i.title, i.description, i.severity, i.status, i.started_at, i.resolved_at, req.user.id]
      );
      const iid = r.rows[0].id;
      incidentsByKey.set(i.key, iid);

      for (const ak of i.assets) {
        const aid = assetsByKey.get(ak);
        if (aid) await client.query(`INSERT INTO incident_assets (incident_id, asset_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [iid, aid]);
      }
      for (const sk of i.services) {
        const sid = servicesByKey.get(sk);
        if (sid) await client.query(`INSERT INTO incident_services (incident_id, service_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [iid, sid]);
      }
      for (const up of i.updates) {
        await client.query(
          `INSERT INTO incident_updates (incident_id, status, message, created_by)
           VALUES ($1,$2,$3,$4)`,
          [iid, up.status, up.message, req.user.id]
        );
      }
    }

    const registry = {
      asset_ids: Array.from(assetsByKey.values()),
      service_ids: Array.from(servicesByKey.values()),
      maintenance_ids: Array.from(maintenanceByKey.values()),
      incident_ids: Array.from(incidentsByKey.values()),
      supplier_ids: supplierIds,
      local_user_ids: Array.from(usersByKey.values()),
      local_group_ids: [demoGroupId],
      asset_dependency_count: assetDependenciesDef.filter(d => assetsByKey.get(d[0]) && assetsByKey.get(d[1])).length,
      service_dependency_count: serviceDependenciesDef.filter(d => servicesByKey.get(d[0]) && servicesByKey.get(d[1])).length,
      seeded_at: new Date().toISOString(),
      seeded_by: req.user.username || req.user.id || 'system',
      tag,
    };

    await client.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ('demo_seed_registry', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`,
      [JSON.stringify(registry)]
    );

    return registry;
  });

  await auditService.log(req.user.id, req.user.username, 'settings:demo_create', 'settings', 'demo_seed_registry', null, req.ip);
  res.status(201).json({
    message: 'Demo data created',
    counts: {
      assets: created.asset_ids.length,
      services: created.service_ids.length,
      maintenances: created.maintenance_ids.length,
      incidents: created.incident_ids.length,
      suppliers: created.supplier_ids.length,
      local_users: created.local_user_ids.length,
      local_groups: created.local_group_ids.length,
      asset_dependencies: created.asset_dependency_count,
      service_dependencies: created.service_dependency_count,
    },
    seeded_at: created.seeded_at,
  });
});

router.post('/demo/clear', requireAuth, requireSuperAdmin, async (req, res) => {
  const reg = await getDemoRegistry();
  if (!reg) {
    return res.json({
      message: 'No demo data to remove',
      removed: {
        assets: 0,
        services: 0,
        maintenances: 0,
        incidents: 0,
        suppliers: 0,
        local_users: 0,
        local_groups: 0,
      },
    });
  }

  await transaction(async (client) => {
    if (reg.incident_ids.length > 0) {
      await client.query(`DELETE FROM incidents WHERE id = ANY($1::uuid[])`, [reg.incident_ids]);
    }
    if (reg.maintenance_ids.length > 0) {
      await client.query(`DELETE FROM status_history WHERE entity_type='maintenance' AND entity_id = ANY($1::uuid[])`, [reg.maintenance_ids]);
      await client.query(`DELETE FROM maintenance_windows WHERE id = ANY($1::uuid[])`, [reg.maintenance_ids]);
    }
    if (reg.service_ids.length > 0) {
      await client.query(`DELETE FROM services WHERE id = ANY($1::uuid[])`, [reg.service_ids]);
    }
    if (reg.asset_ids.length > 0) {
      await client.query(`DELETE FROM assets WHERE id = ANY($1::uuid[])`, [reg.asset_ids]);
    }
    if (reg.supplier_ids.length > 0) {
      await client.query(`DELETE FROM suppliers WHERE id = ANY($1::uuid[])`, [reg.supplier_ids]);
    }
    if (reg.local_user_ids.length > 0) {
      await client.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [reg.local_user_ids]);
    }
    if (reg.local_group_ids.length > 0) {
      await client.query(`DELETE FROM local_groups WHERE id = ANY($1::uuid[])`, [reg.local_group_ids]);
    }
    await client.query(`DELETE FROM settings WHERE key='demo_seed_registry'`);
  });

  await auditService.log(req.user.id, req.user.username, 'settings:demo_clear', 'settings', 'demo_seed_registry', null, req.ip);
  res.json({
    message: 'Demo data removed',
    removed: {
      assets: reg.asset_ids.length,
      services: reg.service_ids.length,
      maintenances: reg.maintenance_ids.length,
      incidents: reg.incident_ids.length,
      suppliers: reg.supplier_ids.length,
      local_users: reg.local_user_ids.length,
      local_groups: reg.local_group_ids.length,
    },
  });
});

// ─── GET /api/settings/:key — generic fallback, must be LAST ─────────────────
router.get('/:key', requireAuth, requireAdmin, async (req, res) => {
  const sensitiveKeys = new Set(['ldap_config', 'saml_config', 'general_config']);
  if (sensitiveKeys.has(String(req.params.key || '')) && req.user?.role !== 'superadmin') {
    return res.status(403).json({ error: 'Superadmin role required' });
  }

  const row = await getOne('SELECT value FROM settings WHERE key=$1', [req.params.key]);
  if (!row) return res.status(404).json({ error: 'Chiave non trovata' });
  try {
    const val = JSON.parse(row.value);
    if (val && typeof val === 'object') {
      for (const k of Object.keys(val)) {
        if ((k.includes('password') || k.includes('pass') || k.includes('secret')) && val[k]) {
          val[k] = '********';
        }
      }
    }
    res.json(val);
  } catch { res.json(row.value); }
});

module.exports = router;
