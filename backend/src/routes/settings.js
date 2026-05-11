const { Router } = require('express');
const { body, validationResult } = require('express-validator');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');
const { query, getOne, getMany } = require('../db/database');
const { encrypt, isEncrypted } = require('../utils/encryption');
const ldapService = require('../services/ldapService');
const samlService = require('../services/samlService');
const { testSmtp, getSmtpConfig } = require('../utils/mailer');
const auditService = require('../services/auditService');

const router = Router();

// ─── GET /api/settings ────────────────────────────────────────────────────────
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  const rows = await getMany('SELECT key, updated_at FROM settings ORDER BY key');
  res.json(rows.map(r => r.key));
});

// ─── GET /api/settings/:key ───────────────────────────────────────────────────
router.get('/:key', requireAuth, requireAdmin, async (req, res) => {
  const row = await getOne('SELECT value FROM settings WHERE key=$1', [req.params.key]);
  if (!row) return res.status(404).json({ error: 'Chiave non trovata' });
  try {
    const val = JSON.parse(row.value);
    // Mask passwords
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
router.post('/smtp/test', requireAuth, requireAdmin, async (req, res) => {
  try {
    const existing = await getSmtpConfig();
    const cfg = { ...existing, ...req.body };
    await testSmtp(cfg);
    res.json({ message: 'Connessione SMTP riuscita' });
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
  res.json(row ? JSON.parse(row.value) : {
    app_name: 'GB Maintenance', app_url: '', default_language: 'it',
    require_approval_for: ['critical','high'], maintenance_reminders: ['7d','1d','2h','30m']
  });
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

module.exports = router;
