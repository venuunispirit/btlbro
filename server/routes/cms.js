// Website management API — the admin can change every editable bit of the
// site from one place: section copy/images, pricing, products & photos.
//
//   GET/PUT  /api/admin/content/:key            → manage one content block
//   GET      /api/admin/content                 → full content map
//   GET/POST /api/admin/products                → list / create products
//   PUT/DELETE /api/admin/products/:id          → update / delete a product
//
// Reads are public (the public MarketingTool/products pages consume them);
// writes require a staff session.

import express from 'express';
import { dbHelpers } from '../db.js';
import { requireStaff } from '../middleware/staffAuth.js';
import { roleLevel } from '../middleware/staffAuth.js';

const router = express.Router();

// ---------- Content ----------
router.get('/', (req, res) => {
  try {
    res.json({ content: dbHelpers.getSiteContent() });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load content', details: error.message });
  }
});

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

router.put('/content/:key', requireStaff, (req, res) => {
  try {
    const block = dbHelpers.setContentBlock(req.params.key, req.body || {});
    res.json({ success: true, block });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save content', details: error.message });
  }
});

// ---------- Products ----------
router.get('/products', (req, res) => {
  try {
    const products = dbHelpers.getProducts();
    const onlyActive = req.query.all !== '1';
    res.json({
      products: onlyActive ? products.filter((p) => p.is_active !== false) : products,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load products', details: error.message });
  }
});

router.post('/products', requireStaff, (req, res) => {
  try {
    const p = req.body || {};
    if (!p.name) return res.status(400).json({ error: 'Product name is required' });
    if (isNaN(Number(p.price))) return res.status(400).json({ error: 'Valid price is required' });
    const product = dbHelpers.addProduct({
      name: String(p.name).trim(),
      price: Number(p.price),
      mrp: p.mrp !== undefined && p.mrp !== '' && !isNaN(Number(p.mrp)) ? Number(p.mrp) : null,
      category: String(p.category || 'General').trim(),
      description: String(p.description || ''),
      image: String(p.image || ''),
      size_label: String(p.size_label || ''),
      stock: p.stock !== undefined && !isNaN(Number(p.stock)) ? Number(p.stock) : null,
      tags: Array.isArray(p.tags) ? p.tags : [],
      is_active: p.is_active !== false,
      // Rich fields for frontend rendering (ProductsPage)
      icon: String(p.icon || ''),
      use: String(p.use || 'Indoor'),
      printed: String(p.printed || 'Printed'),
      rating: p.rating !== undefined ? Number(p.rating) : 0,
      reviews: p.reviews !== undefined ? Number(p.reviews) : 0,
      sizes: Array.isArray(p.sizes) ? p.sizes : [],
      finishing: Array.isArray(p.finishing) ? p.finishing : [],
    });
    res.json({ success: true, product });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create product', details: error.message });
  }
});

router.put('/products/:id', requireStaff, (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = dbHelpers.getProductById(id);
    if (!existing) return res.status(404).json({ error: 'Product not found' });

    const p = req.body || {};
    const clean = {};
    if (typeof p.name === 'string' && p.name.trim()) clean.name = p.name.trim();
    if (p.price !== undefined && p.price !== '' && !isNaN(Number(p.price))) clean.price = Number(p.price);
    if (p.mrp !== undefined) clean.mrp = p.mrp === '' || isNaN(Number(p.mrp)) ? null : Number(p.mrp);
    if (typeof p.category === 'string') clean.category = p.category.trim() || 'General';
    if (typeof p.description === 'string') clean.description = p.description;
    if (typeof p.image === 'string') clean.image = p.image;
    if (typeof p.size_label === 'string') clean.size_label = p.size_label;
    if (p.stock !== undefined) clean.stock = isNaN(Number(p.stock)) ? null : Number(p.stock);
    if (typeof p.is_active === 'boolean') clean.is_active = p.is_active;
    // Rich fields for frontend rendering
    if (typeof p.icon === 'string') clean.icon = p.icon;
    if (typeof p.use === 'string') clean.use = p.use;
    if (typeof p.printed === 'string') clean.printed = p.printed;
    if (p.rating !== undefined) clean.rating = Number(p.rating);
    if (p.reviews !== undefined) clean.reviews = Number(p.reviews);
    if (Array.isArray(p.sizes)) clean.sizes = p.sizes;
    if (Array.isArray(p.finishing)) clean.finishing = p.finishing;

    // role guard: members can see but not mutate catalog
    if (roleLevel(req.user.role) < 1) return res.status(403).json({ error: 'Only Manager+ can edit products' });

    const product = dbHelpers.updateProduct(id, clean);
    res.json({ success: true, product });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update product', details: error.message });
  }
});

router.delete('/products/:id', requireStaff, (req, res) => {
  try {
    if (roleLevel(req.user.role) < 1) return res.status(403).json({ error: 'Only Manager+ can delete products' });
    dbHelpers.deleteProduct(Number(req.params.id));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete product', details: error.message });
  }
});

// ---------- Records (inline data editing, sheet-style) ----------
// GET  /api/admin/records?file=..&page=..&limit=..&search=..  (staff)
// PUT  /api/admin/records/:id  { field, value }               (staff, Manager+)
router.get('/records', (req, res) => {
  try {
    const { file, page = 1, limit = 200, search = '' } = req.query;
    const limitN = Math.min(Number(limit) || 200, 500);
    const pageN = Math.max(Number(page) || 1, 1);

    let records = dbHelpers.getAllRecords();
    if (file) records = records.filter((r) => r.file_id === Number(file));
    if (search && search !== '__all__') {
      const q = search.toLowerCase();
      records = records.filter((r) => JSON.stringify(r.data || {}).toLowerCase().includes(q));
    }
    const total = records.length;
    const start = (pageN - 1) * limitN;
    res.json({
      records: records.slice(start, start + limitN),
      pagination: { page: pageN, limit: limitN, total, pages: Math.ceil(total / limitN) },
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load records', details: error.message });
  }
});

router.put('/records/:id', requireStaff, (req, res) => {
  try {
    if (roleLevel(req.user.role) < 1) return res.status(403).json({ error: 'Only Manager+ can edit location data' });
    const { field, value } = req.body || {};
    if (!field || typeof field !== 'string') return res.status(400).json({ error: 'field is required' });

    const record = dbHelpers.getRecordById(Number(req.params.id));
    if (!record) return res.status(404).json({ error: 'Record not found' });

    let val = value;
    // numbers keep their type (CSV/parse prices) so downstream math stays intact
    if (typeof val === 'string' && val.trim() !== '' && !isNaN(Number(val))) {
      val = Number(val);
    } else if (val === '' || val === null) {
      val = val === null ? null : '';
    }

    dbHelpers.patchRecordData(Number(req.params.id), { [field]: val });
    res.json({ success: true, record: dbHelpers.getRecordById(Number(req.params.id)) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update record', details: error.message });
  }
});

export default router;