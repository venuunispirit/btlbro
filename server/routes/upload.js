// Upload API — product/section images for website management.
//
//   POST /api/admin/upload  (multipart/form-data, field "image", staff only)
//     → { url: "/uploads/<file>" }
//
// Files land in server/uploads/ and are served statically at /uploads/*.

import express from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { requireStaff } from '../middleware/staffAuth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || '').toLowerCase().replace(/[^.\w]/g, '');
    const safe = `${Date.now()}-${Math.round(Math.random() * 1e6)}${ext || '.png'}`;
    cb(null, safe);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(png|jpe?g|webp|gif|svg\+xml)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

const router = express.Router();

router.post('/', requireStaff, (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
    if (!req.file) return res.status(400).json({ error: 'No image provided (field "image")' });
    res.json({ success: true, url: `/uploads/${req.file.filename}` });
  });
});

export default router;