const { Router } = require('express');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/authMiddleware');
const authService = require('../services/authService');
const ldapService = require('../services/ldapService');
const samlService = require('../services/samlService');
const totpService = require('../services/totpService');
const auditService = require('../services/auditService');
const logger = require('../utils/logger');
const { getOne } = require('../db/database');

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Troppi tentativi di login. Riprova tra 15 minuti.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
router.post('/login', loginLimiter, [
  body('username').isString().trim().isLength({ min: 1 }),
  body('password').isString().isLength({ min: 1 }),
  body('auth_type').optional().isIn(['local', 'ldap']),
  body('totp_token').optional().isString(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { username, password, auth_type, totp_token } = req.body;

  try {
    let user;
    let authSource = 'local';

    if (auth_type === 'ldap') {
      authSource = 'ldap';
      user = await ldapService.authenticateUser(username, password);
    } else if (auth_type === 'local') {
      authSource = 'local';
      user = await authService.loginLocal(username, password);
    } else {
      // Auto mode: if a local user exists, use local auth; otherwise fallback to LDAP (if enabled).
      const localUser = await getOne(
        `SELECT id FROM users WHERE LOWER(username)=LOWER($1) AND auth_type='local' AND is_active=true LIMIT 1`,
        [username]
      );
      if (localUser) {
        authSource = 'local';
        user = await authService.loginLocal(username, password);
      } else {
        const ldapCfg = await ldapService.getLdapSettings();
        if (ldapCfg?.enabled) {
          authSource = 'ldap';
          user = await ldapService.authenticateUser(username, password);
        } else {
          authSource = 'local';
          user = await authService.loginLocal(username, password);
        }
      }
    }

    if (!user) {
      await auditService.log(null, username, 'auth:login_failed', 'user', null, `auth_type=${authSource}`, req.ip);
      return res.status(401).json({ error: 'Credenziali non valide' });
    }

    // Check TOTP if enabled
    if (user.totp_enabled) {
      if (!totp_token) {
        return res.status(200).json({ require_totp: true, user_id: user.id });
      }
      const valid = await totpService.validateTotp(user.id, totp_token);
      if (!valid) {
        await auditService.log(user.id, user.username, 'auth:totp_failed', 'user', user.id, null, req.ip);
        return res.status(401).json({ error: 'Codice TOTP non valido' });
      }
    }

    const { token, jti } = authService.signToken(user);
    const expires = process.env.JWT_EXPIRES_IN || '8h';
    await authService.createSession(user.id, jti, req.ip, req.get('user-agent'), expires);
    await auditService.log(user.id, user.username, 'auth:login', 'user', user.id, `auth_type=${authSource}`, req.ip, req.get('user-agent'));

    res.json({ token, user: authService.safeUser(user) });
  } catch (err) {
    if (auth_type === 'ldap' || /LDAP/i.test(String(err.message || ''))) {
      const m = String(err.message || '');
      if (err.name === 'InvalidCredentialsError' || /invalid credentials|credentials/i.test(m)) {
        await auditService.log(null, username, 'auth:login_failed', 'user', null, 'auth_type=ldap', req.ip);
        return res.status(401).json({ error: 'Credenziali LDAP non valide' });
      }
      if (/LDAP access denied|not belong|authorized LDAP group|Accesso LDAP negato|gruppo LDAP autorizzato/i.test(m)) {
        return res.status(403).json({ error: m });
      }
      if (/LDAP non abilitato|non configurat|search base/i.test(m)) {
        return res.status(400).json({ error: m });
      }
    }
    if (err.code === 'ACCOUNT_LOCKED') return res.status(403).json({ error: err.message });
    logger.error(`[Auth] Login error: ${err.message}`);
    res.status(500).json({ error: 'Errore durante il login' });
  }
});

// ─── POST /api/auth/logout ────────────────────────────────────────────────────
router.post('/logout', requireAuth, async (req, res) => {
  try {
    if (req.user.jti) await authService.revokeSession(req.user.jti);
    await auditService.log(req.user.id, req.user.username, 'auth:logout', 'user', req.user.id, null, req.ip);
    res.json({ message: 'Logout effettuato' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', requireAuth, (req, res) => {
  res.json(authService.safeUser(req.user));
});

// ─── GET /api/auth/sessions ───────────────────────────────────────────────────
router.get('/sessions', requireAuth, async (req, res) => {
  const sessions = await authService.getUserSessions(req.user.id);
  res.json(sessions);
});

// ─── DELETE /api/auth/sessions/:id ───────────────────────────────────────────
router.delete('/sessions/:jti', requireAuth, async (req, res) => {
  await authService.revokeSession(req.params.jti);
  res.json({ message: 'Sessione revocata' });
});

// ─── POST /api/auth/sessions/revoke-all ──────────────────────────────────────
router.post('/sessions/revoke-all', requireAuth, async (req, res) => {
  await authService.revokeAllUserSessions(req.user.id);
  res.json({ message: 'Tutte le sessioni revocate' });
});

// ─── TOTP Setup ───────────────────────────────────────────────────────────────
router.post('/totp/setup', requireAuth, async (req, res) => {
  try {
    const data = await totpService.setupTotp(req.user.id);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/totp/verify', requireAuth, [
  body('token').isString().isLength({ min: 6, max: 8 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const valid = await totpService.verifyAndActivateTotp(req.user.id, req.body.token);
  if (!valid) return res.status(400).json({ error: 'Codice TOTP non valido' });
  await auditService.log(req.user.id, req.user.username, 'auth:totp_enabled', 'user', req.user.id, null, req.ip);
  res.json({ message: 'TOTP attivato con successo' });
});

router.post('/totp/disable', requireAuth, [
  body('token').isString().isLength({ min: 6, max: 8 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const valid = await totpService.validateTotp(req.user.id, req.body.token);
  if (!valid) return res.status(400).json({ error: 'Codice TOTP non valido' });
  await totpService.disableTotp(req.user.id);
  await auditService.log(req.user.id, req.user.username, 'auth:totp_disabled', 'user', req.user.id, null, req.ip);
  res.json({ message: 'TOTP disabilitato' });
});

// ─── SAML SSO ─────────────────────────────────────────────────────────────────
router.get('/saml/metadata', async (req, res) => {
  try {
    const xml = await samlService.getMetadata();
    res.type('application/xml').send(xml);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.get('/saml/login', async (req, res) => {
  try {
    const url = await samlService.generateAuthUrl(req);
    res.redirect(url);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

async function handleSamlCallback(req, res) {
  try {
    const user = await samlService.validateCallback(req);
    const { token } = authService.signToken(user);
    const frontendUrl = process.env.APP_URL || 'http://localhost:4681';
    res.redirect(`${frontendUrl}/login?token=${encodeURIComponent(token)}`);
  } catch (err) {
    logger.error(`[Auth] SAML ACS error: ${err.message}`);
    res.redirect(`${process.env.APP_URL || 'http://localhost:4681'}/login?error=saml`);
  }
}

router.post('/saml/callback', handleSamlCallback);
router.post('/saml/acs', handleSamlCallback);

// ─── Change Password ──────────────────────────────────────────────────────────
router.post('/change-password', requireAuth, [
  body('current_password').isString().isLength({ min: 1 }),
  body('new_password').isString().isLength({ min: 8 })
    .matches(/[A-Z]/).withMessage('Deve contenere almeno una maiuscola')
    .matches(/[0-9]/).withMessage('Deve contenere almeno un numero')
    .matches(/[^A-Za-z0-9]/).withMessage('Deve contenere almeno un carattere speciale'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const user = await authService.getUserWithHash(req.user.id);
    if (!user || user.auth_type !== 'local') return res.status(400).json({ error: 'Solo per account locali' });
    const valid = authService.verifyPassword(req.body.current_password, user.password_hash);
    if (!valid) return res.status(400).json({ error: 'Password corrente non valida' });
    await authService.updateUser(req.user.id, { password: req.body.new_password });
    await authService.revokeAllUserSessions(req.user.id);
    await auditService.log(req.user.id, req.user.username, 'auth:password_changed', 'user', req.user.id, null, req.ip);
    res.json({ message: 'Password aggiornata. Effettua nuovamente il login.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
