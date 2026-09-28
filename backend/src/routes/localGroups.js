const { Router } = require('express');
const { body, param, validationResult } = require('express-validator');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');
const { query, getOne, getMany } = require('../db/database');
const auditService = require('../services/auditService');
const ldapService = require('../services/ldapService');

const router = Router();

// Minimal projection open to any authenticated user, for owner pickers.
// Registered before the admin-only guard below so it bypasses it.
router.get('/assignable', requireAuth, async (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const params = [];
  const where = q ? `WHERE LOWER(lg.name) LIKE $1` : '';
  if (q) params.push(`%${q}%`);
  const groups = await getMany(
    `SELECT lg.id, lg.name, COALESCE(map.ldap_mapping_count, 0) AS ldap_mapping_count
     FROM local_groups lg
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS ldap_mapping_count
       FROM ldap_group_mappings lgm
       WHERE lgm.local_group_id = lg.id
     ) map ON TRUE
     ${where}
     ORDER BY lg.name LIMIT 200`,
    params
  );
  res.json(groups);
});

router.use(requireAuth, requireAdmin);

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

// ─── GET /api/groups ──────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const includeLdapMembers = ['1', 'true', 'yes', 'on'].includes(String(req.query.include_ldap_members || '').toLowerCase());

  const groups = await getMany(
    `SELECT lg.*,
            COALESCE(loc.local_member_count, 0) AS local_member_count,
            COALESCE(map.ldap_mapping_count, 0) AS ldap_mapping_count,
            COALESCE(map.ldap_group_dns, '{}'::text[]) AS ldap_group_dns
     FROM local_groups lg
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS local_member_count
       FROM user_group_members ugm
       WHERE ugm.group_id = lg.id
     ) loc ON TRUE
     LEFT JOIN LATERAL (
       SELECT
         COUNT(*)::int AS ldap_mapping_count,
         COALESCE(
           ARRAY_AGG(lgm.ldap_group_dn) FILTER (WHERE lgm.ldap_group_dn IS NOT NULL AND TRIM(lgm.ldap_group_dn) <> ''),
           '{}'::text[]
         ) AS ldap_group_dns
       FROM ldap_group_mappings lgm
       WHERE lgm.local_group_id = lg.id
     ) map ON TRUE
     ORDER BY lg.name`
  );

  const enriched = includeLdapMembers
    ? await Promise.all(groups.map(async (group) => {
      let ldapMemberCount = 0;
      try {
        ldapMemberCount = await ldapService.countUsersInGroups(group.ldap_group_dns || []);
      } catch (_) {
        ldapMemberCount = 0;
      }
      return {
        ...group,
        member_count: Number(group.local_member_count || 0) + Number(ldapMemberCount || 0),
      };
    }))
    : groups.map((group) => ({
      ...group,
      member_count: Number(group.local_member_count || 0),
    }));

  res.json(enriched);
});

// ─── GET /api/groups/:id ──────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  const group = await getOne('SELECT * FROM local_groups WHERE id=$1', [req.params.id]);
  if (!group) return res.status(404).json({ error: 'Group not found' });

  const members = await getMany(
    `SELECT u.id, u.username, u.display_name, u.email, u.role, u.avatar_color, u.auth_type
     FROM users u JOIN user_group_members ugm ON ugm.user_id=u.id
     WHERE ugm.group_id=$1 ORDER BY u.username`,
    [req.params.id]
  );
  const ldapMappings = await getMany(
    'SELECT * FROM ldap_group_mappings WHERE local_group_id=$1',
    [req.params.id]
  );
  res.json({ ...group, members, ldapMappings });
});

// ─── POST /api/groups ─────────────────────────────────────────────────────────
router.post('/', [
  body('name').isString().trim().isLength({ min: 2, max: 100 }),
  body('description').optional().isString().trim(),
  body('role').isString().trim().isLength({ min: 1, max: 100 }),
  body('permissions').optional().isObject(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const allowedRoles = await getAllowedRoles();
  if (!allowedRoles.has(req.body.role)) return res.status(400).json({ error: 'Invalid role' });

  try {
    const result = await query(
      `INSERT INTO local_groups (name, description, role, permissions) VALUES ($1, $2, $3, $4) RETURNING id`,
      [req.body.name, req.body.description || null, req.body.role, JSON.stringify(req.body.permissions || {})]
    );
    const id = result.rows[0].id;
    await auditService.log(req.user.id, req.user.username, 'group:create', 'local_group', id, `name=${req.body.name}`, req.ip);
    res.status(201).json({ id });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Group name already in use' });
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/groups/:id ──────────────────────────────────────────────────────
router.put('/:id', [
  body('name').optional().isString().trim().isLength({ min: 2, max: 100 }),
  body('description').optional().isString(),
  body('role').optional().isString().trim().isLength({ min: 1, max: 100 }),
  body('permissions').optional().isObject(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  if (req.body.role === undefined) return res.status(400).json({ error: 'Role is required' });

  const allowedRoles = await getAllowedRoles();
  if (!allowedRoles.has(req.body.role)) return res.status(400).json({ error: 'Invalid role' });

  const sets = []; const vals = []; let i = 1;
  if (req.body.name !== undefined)        { sets.push(`name=$${i++}`); vals.push(req.body.name); }
  if (req.body.description !== undefined) { sets.push(`description=$${i++}`); vals.push(req.body.description); }
  if (req.body.role !== undefined)        { sets.push(`role=$${i++}`); vals.push(req.body.role); }
  if (req.body.permissions !== undefined) { sets.push(`permissions=$${i++}`); vals.push(JSON.stringify(req.body.permissions)); }
  if (sets.length === 0) return res.status(400).json({ error: 'No fields to update' });
  sets.push(`updated_at=$${i++}`); vals.push(new Date()); vals.push(req.params.id);

  await query(`UPDATE local_groups SET ${sets.join(',')} WHERE id=$${i}`, vals);
  await auditService.log(req.user.id, req.user.username, 'group:update', 'local_group', req.params.id, null, req.ip);
  res.json({ message: 'Group updated' });
});

// ─── DELETE /api/groups/:id ───────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  await query('DELETE FROM local_groups WHERE id=$1', [req.params.id]);
  await auditService.log(req.user.id, req.user.username, 'group:delete', 'local_group', req.params.id, null, req.ip);
  res.json({ message: 'Group deleted' });
});

// ─── POST /api/groups/:id/members ─────────────────────────────────────────────
router.post('/:id/members', [
  body('user_ids').isArray({ min: 1 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  for (const uid of req.body.user_ids) {
    await query(
      `INSERT INTO user_group_members (user_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [uid, req.params.id]
    );
  }
  res.json({ message: 'Members added' });
});

// ─── DELETE /api/groups/:id/members/:userId ───────────────────────────────────
router.delete('/:id/members/:userId', async (req, res) => {
  await query(
    'DELETE FROM user_group_members WHERE group_id=$1 AND user_id=$2',
    [req.params.id, req.params.userId]
  );
  res.json({ message: 'Member removed' });
});

// ─── LDAP Mappings ────────────────────────────────────────────────────────────
router.get('/ldap/mappings', async (req, res) => {
  const mappings = await getMany(
    `SELECT lm.*, lg.name as group_name FROM ldap_group_mappings lm
     LEFT JOIN local_groups lg ON lg.id=lm.local_group_id ORDER BY lm.ldap_group_dn`
  );
  res.json(mappings);
});

router.post('/ldap/mappings', [
  body('ldap_group_dn').isString().trim().isLength({ min: 1 }),
  body('local_group_id').optional().isUUID(),
  body('role').isString().trim().isLength({ min: 1, max: 100 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const allowedRoles = await getAllowedRoles();
  if (!allowedRoles.has(req.body.role)) return res.status(400).json({ error: 'Invalid role' });

  const result = await query(
    `INSERT INTO ldap_group_mappings (ldap_group_dn, local_group_id, role) VALUES ($1,$2,$3) RETURNING id`,
    [req.body.ldap_group_dn, req.body.local_group_id || null, req.body.role || null]
  );
  res.status(201).json({ id: result.rows[0].id });
});

router.delete('/ldap/mappings/:id', async (req, res) => {
  await query('DELETE FROM ldap_group_mappings WHERE id=$1', [req.params.id]);
  res.json({ message: 'Mapping deleted' });
});

module.exports = router;
