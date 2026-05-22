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
      seeded_at: parsed.seeded_at || null,
      seeded_by: parsed.seeded_by || null,
    };
  } catch {
    return null;
  }
}

function atFromNow(hoursFromNow) {
  return new Date(Date.now() + (hoursFromNow * 60 * 60 * 1000)).toISOString();
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
      seeded_at: null,
      seeded_by: null,
    });
  }
  return res.json({
    exists: (reg.asset_ids.length + reg.service_ids.length + reg.maintenance_ids.length) > 0,
    asset_count: reg.asset_ids.length,
    service_count: reg.service_ids.length,
    maintenance_count: reg.maintenance_ids.length,
    seeded_at: reg.seeded_at,
    seeded_by: reg.seeded_by,
  });
});

router.post('/demo/create', requireAuth, requireSuperAdmin, async (req, res) => {
  const existing = await getDemoRegistry();
  if (existing && (existing.asset_ids.length || existing.service_ids.length || existing.maintenance_ids.length)) {
    return res.status(409).json({ error: 'Demo data already exists. Remove it first.' });
  }

  const tag = Date.now();
  const assetsDef = [
    { key: 'portal-web', name: 'Demo Portal Web', category: 'application', criticality: 'high', status: 'operational', desc: 'Frontend portal' },
    { key: 'portal-api', name: 'Demo Portal API', category: 'api', criticality: 'high', status: 'degraded', desc: 'Public API layer' },
    { key: 'auth-service', name: 'Demo Auth Service', category: 'application', criticality: 'critical', status: 'operational', desc: 'Authentication backend' },
    { key: 'payments-db', name: 'Demo Payments DB', category: 'database', criticality: 'critical', status: 'operational', desc: 'Payment database' },
    { key: 'reporting-db', name: 'Demo Reporting DB', category: 'database', criticality: 'medium', status: 'operational', desc: 'Reporting data mart' },
    { key: 'edge-lb', name: 'Demo Edge Load Balancer', category: 'infrastructure', criticality: 'high', status: 'operational', desc: 'Ingress traffic balancer' },
    { key: 'redis-cache', name: 'Demo Redis Cache', category: 'infrastructure', criticality: 'medium', status: 'degraded', desc: 'Session and cache layer' },
    { key: 'vpn-gateway', name: 'Demo VPN Gateway', category: 'network', criticality: 'medium', status: 'operational', desc: 'Remote office VPN' },
    { key: 'etl-engine', name: 'Demo ETL Engine', category: 'application', criticality: 'low', status: 'operational', desc: 'Nightly ETL process' },
    { key: 'email-worker', name: 'Demo Email Worker', category: 'application', criticality: 'low', status: 'major_outage', desc: 'Notification sender worker' },
  ];

  const servicesDef = [
    { key: 'customer-portal', name: 'Demo Customer Portal', criticality: 'high', status: 'degraded', is_public: true, assets: ['portal-web', 'portal-api', 'edge-lb', 'redis-cache'] },
    { key: 'identity', name: 'Demo Identity Service', criticality: 'critical', status: 'operational', is_public: true, assets: ['auth-service', 'redis-cache'] },
    { key: 'billing', name: 'Demo Billing Service', criticality: 'critical', status: 'operational', is_public: true, assets: ['portal-api', 'payments-db'] },
    { key: 'analytics', name: 'Demo Analytics', criticality: 'medium', status: 'operational', is_public: false, assets: ['etl-engine', 'reporting-db'] },
    { key: 'internal-vpn', name: 'Demo Internal VPN', criticality: 'medium', status: 'operational', is_public: false, assets: ['vpn-gateway'] },
    { key: 'mailing', name: 'Demo Mailing', criticality: 'low', status: 'major_outage', is_public: true, assets: ['email-worker'] },
  ];

  const maintDef = [
    {
      key: 'db-upgrade',
      title: 'DEMO - Payments DB minor upgrade',
      type: 'upgrade',
      status: 'scheduled',
      impact_level: 'high',
      scheduled_start: atFromNow(24),
      scheduled_end: atFromNow(26),
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
      scheduled_start: atFromNow(-1),
      scheduled_end: atFromNow(1),
      actual_start: atFromNow(-0.8),
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
      scheduled_start: atFromNow(-10),
      scheduled_end: atFromNow(-8),
      actual_start: atFromNow(-10),
      actual_end: atFromNow(-9),
      reopened_at: atFromNow(-2),
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
      scheduled_start: atFromNow(-72),
      scheduled_end: atFromNow(-71),
      actual_start: atFromNow(-72),
      actual_end: atFromNow(-71.5),
      reopened_at: null,
      reopen_reason: null,
      note: 'Completed without incidents',
      assets: ['vpn-gateway'],
      services: ['internal-vpn'],
    },
  ];

  const created = await transaction(async (client) => {
    const assetsByKey = new Map();
    const servicesByKey = new Map();
    const maintenanceByKey = new Map();

    for (const a of assetsDef) {
      const r = await client.query(
        `INSERT INTO assets (name, slug, category, criticality, description, status, owner_type, is_active, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,'user',true,$7::jsonb)
         RETURNING id`,
        [a.name, `demo-${a.key}-${tag}`, a.category, a.criticality, a.desc, a.status, JSON.stringify({ demo_seed: true, demo_tag: tag })]
      );
      assetsByKey.set(a.key, r.rows[0].id);
    }

    for (const s of servicesDef) {
      const r = await client.query(
        `INSERT INTO services (name, slug, description, criticality, status, sla_uptime_percent, is_public, owner_type, is_active)
         VALUES ($1,$2,$3,$4,$5,99.90,$6,'user',true)
         RETURNING id`,
        [s.name, `demo-${s.key}-${tag}`, `Demo service for ${s.name}`, s.criticality, s.status, !!s.is_public]
      );
      const sid = r.rows[0].id;
      servicesByKey.set(s.key, sid);
      for (const ak of s.assets) {
        const aid = assetsByKey.get(ak);
        if (aid) {
          await client.query(`INSERT INTO service_assets (service_id, asset_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [sid, aid]);
        }
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
        if (aid) {
          await client.query(`INSERT INTO maintenance_assets (maintenance_id, asset_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [mid, aid]);
        }
      }
      for (const sk of m.services) {
        const sid = servicesByKey.get(sk);
        if (sid) {
          await client.query(`INSERT INTO maintenance_services (maintenance_id, service_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [mid, sid]);
        }
      }

      await client.query(
        `INSERT INTO status_history (entity_type, entity_id, status, changed_by, reason)
         VALUES ('maintenance',$1,$2,$3,$4)`,
        [mid, 'scheduled', req.user.username || req.user.id || 'system', 'Demo maintenance scheduled']
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

    const registry = {
      asset_ids: Array.from(assetsByKey.values()),
      service_ids: Array.from(servicesByKey.values()),
      maintenance_ids: Array.from(maintenanceByKey.values()),
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
    },
    seeded_at: created.seeded_at,
  });
});

router.post('/demo/clear', requireAuth, requireSuperAdmin, async (req, res) => {
  const reg = await getDemoRegistry();
  if (!reg) return res.json({ message: 'No demo data to remove', removed: { assets: 0, services: 0, maintenances: 0 } });

  await transaction(async (client) => {
    if (reg.maintenance_ids.length > 0) {
      await client.query(`DELETE FROM status_history WHERE entity_type='maintenance' AND entity_id = ANY($1::uuid[])`, [reg.maintenance_ids]);
      await client.query(`DELETE FROM maintenance_services WHERE maintenance_id = ANY($1::uuid[])`, [reg.maintenance_ids]);
      await client.query(`DELETE FROM maintenance_assets WHERE maintenance_id = ANY($1::uuid[])`, [reg.maintenance_ids]);
      await client.query(`DELETE FROM maintenance_windows WHERE id = ANY($1::uuid[])`, [reg.maintenance_ids]);
    }
    if (reg.service_ids.length > 0) {
      await client.query(`DELETE FROM services WHERE id = ANY($1::uuid[])`, [reg.service_ids]);
    }
    if (reg.asset_ids.length > 0) {
      await client.query(`DELETE FROM assets WHERE id = ANY($1::uuid[])`, [reg.asset_ids]);
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
