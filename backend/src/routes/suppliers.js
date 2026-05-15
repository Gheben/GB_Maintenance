const { Router } = require('express');
const { body, param, query: qv, validationResult } = require('express-validator');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');
const { query, getOne, getMany } = require('../db/database');

const router = Router();
router.use(requireAuth);

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
    where.push(`(
      LOWER(first_name) LIKE $${idx}
      OR LOWER(last_name) LIKE $${idx}
      OR LOWER(company) LIKE $${idx}
      OR LOWER(email) LIKE $${idx}
      OR LOWER(COALESCE(vat_number,'')) LIKE $${idx}
    )`);
    vals.push(`%${q}%`);
    idx += 1;
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const totalRow = await getOne(`SELECT COUNT(*)::int AS c FROM suppliers ${whereSql}`, vals);
  const total = totalRow?.c || 0;

  const rows = await getMany(
    `SELECT * FROM suppliers ${whereSql}
     ORDER BY company, last_name, first_name
     LIMIT $${idx} OFFSET $${idx + 1}`,
    [...vals, limit, offset]
  );

  res.json({ data: rows, total, page, limit });
});

router.get('/:id', [param('id').isUUID()], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const row = await getOne('SELECT * FROM suppliers WHERE id=$1', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Supplier not found' });
  res.json(row);
});

router.post('/', requireAdmin, [
  body('first_name').isString().trim().isLength({ min: 1, max: 120 }),
  body('last_name').isString().trim().isLength({ min: 1, max: 120 }),
  body('company').isString().trim().isLength({ min: 1, max: 200 }),
  body('nationality').optional().isString().trim().isLength({ max: 100 }),
  body('phone').optional().isString().trim().isLength({ max: 60 }),
  body('mobile').optional().isString().trim().isLength({ max: 60 }),
  body('email').isEmail(),
  body('vat_number').optional().isString().trim().isLength({ max: 80 }),
  body('notes').optional().isString(),
  body('is_active').optional().isBoolean(),
  body('website').optional().isString().trim().isLength({ max: 500 }),
  body('contract_reference').optional().isString().trim().isLength({ max: 200 }),
  body('contract_start_date').optional({ nullable: true }).isISO8601(),
  body('contract_end_date').optional({ nullable: true }).isISO8601(),
  body('availability_hours').optional().isString().trim().isLength({ max: 200 }),
  body('emergency_phone').optional().isString().trim().isLength({ max: 60 }),
  body('emergency_email').optional().isString().trim().isLength({ max: 200 }),
  body('sla_resolution_hours').optional({ nullable: true }).isInt({ min: 0 }),
  body('contract_notes').optional().isString(),
  body('contract_documents').optional().isArray(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const result = await query(
    `INSERT INTO suppliers (
      first_name, last_name, company, nationality, phone, mobile, email, vat_number, notes, is_active, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
    RETURNING id`,
    `INSERT INTO suppliers (
      first_name, last_name, company, nationality, phone, mobile, email, vat_number, notes, is_active,
      website, contract_reference, contract_start_date, contract_end_date, availability_hours,
      emergency_phone, emergency_email, sla_resolution_hours, contract_notes, contract_documents,
      updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,NOW())
    RETURNING id`,
    [
      req.body.first_name,
      req.body.last_name,
      req.body.company,
      req.body.nationality || null,
      req.body.phone || null,
      req.body.mobile || null,
      req.body.email,
      req.body.vat_number || null,
      req.body.notes || null,
      req.body.is_active !== undefined ? req.body.is_active : true,
      req.body.website || null,
      req.body.contract_reference || null,
      req.body.contract_start_date || null,
      req.body.contract_end_date || null,
      req.body.availability_hours || null,
      req.body.emergency_phone || null,
      req.body.emergency_email || null,
      req.body.sla_resolution_hours != null && req.body.sla_resolution_hours !== '' ? parseInt(req.body.sla_resolution_hours, 10) : null,
      req.body.contract_notes || null,
      JSON.stringify(Array.isArray(req.body.contract_documents) ? req.body.contract_documents : []),
    ]
  );

  res.status(201).json({ id: result.rows[0].id });
});

router.put('/:id', requireAdmin, [
  param('id').isUUID(),
  body('first_name').optional().isString().trim().isLength({ min: 1, max: 120 }),
  body('last_name').optional().isString().trim().isLength({ min: 1, max: 120 }),
  body('company').optional().isString().trim().isLength({ min: 1, max: 200 }),
  body('nationality').optional().isString().trim().isLength({ max: 100 }),
  body('phone').optional().isString().trim().isLength({ max: 60 }),
  body('mobile').optional().isString().trim().isLength({ max: 60 }),
  body('email').optional().isEmail(),
  body('vat_number').optional().isString().trim().isLength({ max: 80 }),
  body('notes').optional().isString(),
  body('is_active').optional().isBoolean(),
  body('website').optional().isString().trim().isLength({ max: 500 }),
  body('contract_reference').optional().isString().trim().isLength({ max: 200 }),
  body('contract_start_date').optional({ nullable: true }).isISO8601(),
  body('contract_end_date').optional({ nullable: true }).isISO8601(),
  body('availability_hours').optional().isString().trim().isLength({ max: 200 }),
  body('emergency_phone').optional().isString().trim().isLength({ max: 60 }),
  body('emergency_email').optional().isString().trim().isLength({ max: 200 }),
  body('sla_resolution_hours').optional({ nullable: true }).isInt({ min: 0 }),
  body('contract_notes').optional().isString(),
  body('contract_documents').optional().isArray(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const existing = await getOne('SELECT id FROM suppliers WHERE id=$1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Supplier not found' });

  const fields = [];
  const vals = [];
  let idx = 1;
  const setField = (k, v) => { fields.push(`${k}=$${idx++}`); vals.push(v); };

  const keys = ['first_name', 'last_name', 'company', 'nationality', 'phone', 'mobile', 'email', 'vat_number', 'notes', 'is_active',
    'website', 'contract_reference', 'contract_start_date', 'contract_end_date', 'availability_hours',
    'emergency_phone', 'emergency_email', 'sla_resolution_hours', 'contract_notes'];
  for (const k of keys) {
    if (req.body[k] !== undefined) setField(k, req.body[k] === '' ? null : req.body[k]);
  }
  if (req.body.contract_documents !== undefined) {
    setField('contract_documents', JSON.stringify(Array.isArray(req.body.contract_documents) ? req.body.contract_documents : []));
  }

  if (fields.length > 0) {
    fields.push('updated_at=NOW()');
    await query(`UPDATE suppliers SET ${fields.join(', ')} WHERE id=$${idx}`, [...vals, req.params.id]);
  }

  res.json({ message: 'Supplier updated' });
});

router.delete('/:id', requireAdmin, [param('id').isUUID()], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  await query('DELETE FROM suppliers WHERE id=$1', [req.params.id]);
  res.json({ message: 'Supplier deleted' });
});

module.exports = router;
