// Public CMS routes — no auth. The frontend consumes these.
//   GET /api/content         → full content map
//   GET /api/content/:key    → one content block
//   GET /api/products        → active products list

import express from 'express';
import { dbHelpers } from '../db.js';

const router = express.Router();

router.get('/content', (req, res) => {
  try {
    res.json({ content: dbHelpers.getSiteContent() });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load content', details: error.message });
  }
});

router.get('/content/:key', (req, res) => {
  try {
    res.json({ block: dbHelpers.getContentBlock(req.params.key) || {} });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load block', details: error.message });
  }
});

router.get('/products', (req, res) => {
  try {
    const products = dbHelpers.getProducts().filter((p) => p.is_active !== false);
    res.json({ products });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load products', details: error.message });
  }
});

export default router;
