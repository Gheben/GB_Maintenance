const { Router } = require('express');
const { body, validationResult } = require('express-validator');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');
const { query, getOne, getMany } = require('../db/database');
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
router.get('/ldap', requireAuth, requireAdmin, async (req, res) => {
  const cfg = await ldapService.getLdapSettings();
  if (!cfg) return res.json({});
  const safe = { ...cfg };
  if (safe.bind_password) safe.bind_password = '********';
  res.json(safe);
});

router.put('/ldap', requireAuth, requireAdmin, async (req, res) => {
  await ldapService.saveLdapSettings(req.body);
  await auditService.log(req.user.id, req.user.username, 'settings:update', 'settings', 'ldap_config', null, req.ip);
  res.json({ message: 'Configurazione LDAP salvata' });
});

router.post('/ldap/test', requireAuth, requireAdmin, async (req, res) => {
  try {
    const cfg = req.body.url ? req.body : await ldapService.getLdapSettings();
    if (!cfg) return res.status(400).json({ error: 'LDAP non configurato' });
    await ldapService.testLdapConnection(cfg);
    res.json({ message: 'Connessione LDAP riuscita' });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ─── GET /api/settings/ldap/groups ───────────────────────────────────────────
router.get('/ldap/groups', requireAuth, requireAdmin, async (req, res) => {
  try {
    const groups = await ldapService.searchGroups(req.query.q || '');
    res.json(groups);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET /api/settings/ldap/users ────────────────────────────────────────────
router.get('/ldap/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const users = await ldapService.searchUsers(req.query.q || '');
    res.json(users);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET/PUT /api/settings/saml ───────────────────────────────────────────────
router.get('/saml', requireAuth, requireAdmin, async (req, res) => {
  const cfg = await samlService.getSamlSettings();
  if (!cfg) return res.json({});
  const safe = { ...cfg };
  if (safe.sp_private_key) safe.sp_private_key = '********';
  res.json(safe);
});

router.put('/saml', requireAuth, requireAdmin, async (req, res) => {
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
router.get('/general', requireAuth, requireAdmin, async (req, res) => {
  const row = await getOne("SELECT value FROM settings WHERE key='general_config'");
  res.json(row ? { ...getDefaultGeneralSettings(), ...JSON.parse(row.value) } : getDefaultGeneralSettings());
});

router.put('/general', requireAuth, requireAdmin, async (req, res) => {
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

// ─── GET /api/settings/:key — generic fallback, must be LAST ─────────────────
router.get('/:key', requireAuth, requireAdmin, async (req, res) => {
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
