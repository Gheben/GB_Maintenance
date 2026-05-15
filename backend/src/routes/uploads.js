const { Router } = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');

const router = Router();

const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').slice(0, 10);
    const base = path.basename(file.originalname || 'document', path.extname(file.originalname || ''))
      .replace(/[^a-zA-Z0-9-_]/g, '_')
      .slice(0, 80);
    cb(null, `${Date.now()}_${base}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
});

const imageUpload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file?.mimetype || !file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed'));
    }
    cb(null, true);
  },
});

router.post('/license-document', requireAuth, requireAdmin, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  res.json({
    name: req.file.originalname,
    url: `/uploads/${req.file.filename}`,
    size: req.file.size,
    mime: req.file.mimetype,
  });
});

router.post('/license-template-logo', requireAuth, requireAdmin, imageUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });

  res.json({
    name: req.file.originalname,
    url: `/uploads/${req.file.filename}`,
    size: req.file.size,
    mime: req.file.mimetype,
  });
});

router.post('/app-brand-image', requireAuth, requireAdmin, imageUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });

  res.json({
    name: req.file.originalname,
    url: `/uploads/${req.file.filename}`,
    size: req.file.size,
    mime: req.file.mimetype,
  });
});

router.post('/supplier-document', requireAuth, requireAdmin, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  res.json({
    name: req.file.originalname,
    url: `/uploads/${req.file.filename}`,
    size: req.file.size,
    mime: req.file.mimetype,
  });
});

module.exports = router;
