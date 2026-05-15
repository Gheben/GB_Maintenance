const { Router } = require('express');
const { body, param, query: qv, validationResult } = require('express-validator');
const { requireAuth, requireAdmin, requireSuperAdmin } = require('../middleware/authMiddleware');
const authService = require('../services/authService');
const auditService = require('../services/auditService');
const { query, getOne, getMany } = require('../db/database');

const router = Router();
router.use(requireAuth);

async function getAllowedRoles() {
  const defaults = ['admin', 'change_manager', 'operator', 'viewer', 'subscriber'];
  const row = await getOne("SELECT value FROM settings WHERE key='role_presets'");
  const presets = row ? JSON.parse(row.value) : [];
  const presetRoles = Array.isArray(presets)
    ? presets
      .map((p) => String((p?.name || p?.id || '')).trim())
      .filter(Boolean)
    : [];
  return new Set([...defaults, ...presetRoles]);
}

// ─── GET /api/users ───────────────────────────────────────────────────────────
router.get('/', requireAdmin, async (req, res) => {
  const users = await authService.getAllUsers();
  res.json(users);
});

// ─── GET /api/users/permissions ───────────────────────────────────────────────
router.get('/permissions', requireAdmin, (req, res) => {
  res.json(authService.PERMISSION_KEYS);
});

// ─── GET /api/users/roles ─────────────────────────────────────────────────────
router.get('/roles', requireAdmin, (req, res) => {
  res.json(Object.keys(authService.ROLE_DEFAULTS));
});

// ─── GET /api/users/:id ───────────────────────────────────────────────────────
router.get('/:id', requireAdmin, async (req, res) => {
  const user = await authService.getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'Utente non trovato' });

  // Include groups
  const groups = await getMany(
    `SELECT lg.id, lg.name FROM local_groups lg
     JOIN user_group_members ugm ON ugm.group_id = lg.id
     WHERE ugm.user_id = $1`,
    [req.params.id]
  );
  res.json({ ...user, groups });
});

// ─── POST /api/users ──────────────────────────────────────────────────────────
router.post('/', requireAdmin, [
  body('username').isString().trim().isLength({ min: 3, max: 100 }),
  body('password').isString().isLength({ min: 8 })
    .matches(/[A-Z]/).withMessage('Deve contenere almeno una maiuscola')
    .matches(/[0-9]/).withMessage('Deve contenere almeno un numero')
    .matches(/[^A-Za-z0-9]/).withMessage('Deve contenere almeno un carattere speciale'),
  body('role').isString().trim().isLength({ min: 1, max: 100 }),
  body('display_name').optional().isString().trim(),
  body('email').optional().isEmail(),
  body('permissions').optional().isObject(),
  body('group_id').optional().isUUID(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const allowedRoles = await getAllowedRoles();
  if (!allowedRoles.has(req.body.role)) {
    return res.status(400).json({ error: 'Ruolo non valido' });
  }

  try {
    const id = await authService.createUser(
      req.body.username,
      req.body.password,
      req.body.role,
      {
        display_name: req.body.display_name,
        email: req.body.email,
        permissions: req.body.permissions
      }
    );
    if (req.body.group_id) {
      await query(
        `INSERT INTO user_group_members (user_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [id, req.body.group_id]
      );
    }
    await auditService.log(req.user.id, req.user.username, 'user:create', 'user', id, `username=${req.body.username}`, req.ip, req.get('user-agent'));
    res.status(201).json({ id });
  } catch (err) {
    if (err.message?.includes('unique') || err.code === '23505') {
      return res.status(409).json({ error: 'Username già in uso' });
    }
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/users/:id ───────────────────────────────────────────────────────
router.put('/:id', requireAdmin, [
  body('username').optional().isString().trim().isLength({ min: 3, max: 100 }),
  body('display_name').optional().isString().trim(),
  body('email').optional().isEmail(),
  body('role').optional().isString().trim().isLength({ min: 1, max: 100 }),
  body('permissions').optional().isObject(),
  body('is_active').optional().isBoolean(),
  body('password').optional().isString().isLength({ min: 8 })
    .matches(/[A-Z]/).withMessage('Deve contenere almeno una maiuscola')
    .matches(/[0-9]/).withMessage('Deve contenere almeno un numero')
    .matches(/[^A-Za-z0-9]/).withMessage('Deve contenere almeno un carattere speciale'),
  body('group_id').optional().isUUID(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  // Protect superadmin from being demoted by non-superadmin
  const target = await authService.getUserById(req.params.id);
  if (!target) return res.status(404).json({ error: 'Utente non trovato' });
  if (target.role === 'superadmin' && req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Solo il superadmin può modificare il superadmin' });
  }
  if (target.auth_type === 'local' && req.body.role === undefined) {
    return res.status(400).json({ error: 'Ruolo obbligatorio per utenti locali' });
  }
  if (req.body.role !== undefined) {
    const allowedRoles = await getAllowedRoles();
    if (!allowedRoles.has(req.body.role)) {
      return res.status(400).json({ error: 'Ruolo non valido' });
    }
  }

  try {
    await authService.updateUser(req.params.id, req.body);
    if (req.body.group_id !== undefined) {
      // Replace existing group membership with new one
      await query('DELETE FROM user_group_members WHERE user_id=$1', [req.params.id]);
      if (req.body.group_id) {
        await query(
          `INSERT INTO user_group_members (user_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [req.params.id, req.body.group_id]
        );
      }
    }
    await auditService.log(req.user.id, req.user.username, 'user:update', 'user', req.params.id, null, req.ip, req.get('user-agent'));
    res.json({ message: 'User updated' });
  } catch (err) {
    if (err.message?.includes('unique') || err.code === '23505') {
      return res.status(409).json({ error: 'Username already in use' });
    }
    return res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/users/:id ────────────────────────────────────────────────────
router.delete('/:id', requireAdmin, async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Non puoi eliminare te stesso' });
  const target = await authService.getUserById(req.params.id);
  if (!target) return res.status(404).json({ error: 'Utente non trovato' });
  if (target.role === 'superadmin') return res.status(403).json({ error: 'Non puoi eliminare il superadmin' });

  await authService.deleteUser(req.params.id);
  await auditService.log(req.user.id, req.user.username, 'user:delete', 'user', req.params.id, `username=${target.username}`, req.ip, req.get('user-agent'));
  res.json({ message: 'Utente eliminato' });
});

// ─── GET /api/users/:id/sessions ─────────────────────────────────────────────
router.get('/:id/sessions', requireAdmin, async (req, res) => {
  const sessions = await authService.getUserSessions(req.params.id);
  res.json(sessions);
});

// ─── POST /api/users/:id/revoke-sessions ──────────────────────────────────────
router.post('/:id/revoke-sessions', requireAdmin, async (req, res) => {
  await authService.revokeAllUserSessions(req.params.id);
  res.json({ message: 'Tutte le sessioni revocate' });
});

module.exports = router;
