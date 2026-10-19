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

// Columns on a record that are metadata, never a sellable service. Mirrors the
// list in routes/recee.js so a request auto-created from a location row prices
// the same services the field team would otherwise be told to check.
const SERVICE_CORE = new Set([
  'sheet_id', 'name', 'type', 'tab_name', 'sl_no', 'pin_code', 'has_pin_column',
  'distance_km', 'has_distance_column', 'lat', 'lng', 'gmap_link', 'gmap_query',
  'is_active', 'created_at', 'updated_at', 'source', 'edited_locally', 'edited_at',
  'distance', 'apartment', 'id', 'row', 'file_id', 'services',
  'assigned_to', 'assigned_to_name', 'assigned_by', 'assigned_at',
  'recee_status', 'recee_status_at', 'recee_status_by', 'needs_recee', 'edited_by',
]);

// The service names a location row is listed/priced for: the modern `services`
// map first, then any numeric non-core column (the legacy flat layout).
function recordServiceNames(data) {
  const names = [];
  const seen = new Set();
  const add = (n) => {
    const name = String(n || '').trim();
    const key = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (name && key && !seen.has(key)) { seen.add(key); names.push(name); }
  };
  const d = data || {};
  if (d.services && typeof d.services === 'object' && !Array.isArray(d.services)) {
    Object.keys(d.services).forEach(add);
  }
  for (const [k, v] of Object.entries(d)) {
    if (SERVICE_CORE.has(k) || v === null || v === undefined || v === '') continue;
    const clean = String(v).replace(/[₹,\s]/g, '');
    if (/^\d+(\.\d+)?$/.test(clean)) add(k.replace(/_/g, ' '));
  }
  return names;
}

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
    const { file, page = 1, limit = 200, search = '', include_inactive } = req.query;
    const limitN = Math.min(Number(limit) || 200, 2000);
    const pageN = Math.max(Number(page) || 1, 1);

    let records = include_inactive === 'true' ? dbHelpers.getAllRecordsRaw() : dbHelpers.getAllRecords();
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

    dbHelpers.patchRecordData(Number(req.params.id), { [field]: val, edited_by: req.user?.name || 'Admin' });
    res.json({ success: true, record: dbHelpers.getRecordById(Number(req.params.id)) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update record', details: error.message });
  }
});

// POST /api/admin/records/assign — bulk assign location records to a team member
// (Recee/ops). Stamps assigned_to / assigned_to_name / assigned_by / assigned_at
// and starts the recee workflow (pending) on each selected record.
//
// Assigning in the Data section IS the recee assignment: alongside the record
// stamp, a site-survey request is created (or re-pointed) for the assignee so
// the location shows up on that recee's screen. The two systems stay in sync
// without the manager having to re-enter the location as a separate request.
router.post('/records/assign', requireStaff, (req, res) => {
  try {
    if (roleLevel(req.user.role) < 1) return res.status(403).json({ error: 'Only Manager+ can assign location data' });
    const { ids, member_id } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids (record ids) are required' });
    if (!member_id) return res.status(400).json({ error: 'member_id is required' });

    const member = dbHelpers.getUserById(Number(member_id));
    if (!member || !member.is_team) return res.status(404).json({ error: 'Team member not found' });

    const now = new Date().toISOString();
    const byName = req.user?.name || 'Admin';
    // One pass over open requests, keyed by the location row they verify, so a
    // bulk assign re-points an existing request instead of minting duplicates.
    const openByRecord = new Map();
    for (const s of dbHelpers.getSiteSurveys()) {
      if (s.record_id && s.status !== 'done' && s.source === 'request' && !openByRecord.has(s.record_id)) {
        openByRecord.set(s.record_id, s);
      }
    }
    let assigned = 0;
    let surveysCreated = 0;
    let surveysUpdated = 0;
    for (const id of ids) {
      const record = dbHelpers.getRecordById(Number(id));
      if (!record) continue;
      record.data.assigned_to = member.id;
      record.data.assigned_to_name = member.name;
      record.data.assigned_by = byName;
      record.data.assigned_at = now;
      if (!record.data.recee_status || record.data.recee_status === 'done') {
        record.data.recee_status = 'pending';
      }
      record.data.needs_recee = true;
      record.data.updated_at = now;
      assigned++;

      // Keep the recee's screen in step with the assignment. An open request
      // for this location is re-pointed to the new assignee; otherwise one is
      // created so the capture has the location's coordinates to verify against.
      // Only a recee-team assignee can act on it, so only then does a request
      // get created — assigning to anyone else just stamps the row.
      if (!['recee', 'recee_manager'].includes(member.role)) continue;
      const openRequest = openByRecord.get(record.id);
      if (openRequest) {
        dbHelpers.updateSiteSurvey(openRequest.id, {
          assigned_to_id: member.id,
          assigned_to_name: member.name,
          assigned_by_id: req.user?.id,
          assigned_by_name: byName,
          assigned_at: now,
          status: openRequest.status === 'in_progress' ? 'in_progress' : 'assigned',
        });
        openRequest.status = openRequest.status === 'in_progress' ? 'in_progress' : 'assigned';
        openRequest.assigned_to_id = member.id;
        surveysUpdated++;
      } else {
        const d = record.data || {};
        const targetLat = Number.isFinite(Number(d.lat)) ? Number(d.lat) : null;
        const targetLng = Number.isFinite(Number(d.lng)) ? Number(d.lng) : null;
        const created = dbHelpers.addSiteSurvey({
          title: d.name || d.apartment || `Location #${record.id}`,
          address: d.address || d.apartment || d.name || '',
          notes: '',
          services: recordServiceNames(d).map((name) => ({ name, available: null, price: null })),
          prices: {},
          target_lat: targetLat,
          target_lng: targetLng,
          record_id: record.id,
          target_source: dbHelpers.recordSource(record),
          radius_m: 200,
          status: targetLat == null ? 'no_target' : 'assigned',
          assigned_to_id: member.id,
          assigned_to_name: member.name,
          assigned_by_id: req.user?.id,
          assigned_by_name: byName,
          assigned_at: now,
          created_by_id: req.user?.id,
          created_by_name: byName,
          source: 'request',
        });
        openByRecord.set(record.id, created);
        surveysCreated++;
      }
    }
    if (assigned) dbHelpers.write();
    res.json({ success: true, assigned, member: { id: member.id, name: member.name }, surveys_created: surveysCreated, surveys_updated: surveysUpdated });
  } catch (error) {
    res.status(500).json({ error: 'Failed to assign records', details: error.message });
  }
});

// POST /api/admin/records/recee-status — bulk set recee_status (pending/in_progress/done)
router.post('/records/recee-status', requireStaff, (req, res) => {
  try {
    if (roleLevel(req.user.role) < 1) return res.status(403).json({ error: 'Only Manager+ can update recee status' });
    const { ids, status } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids are required' });
    const VALID = ['pending', 'in_progress', 'done'];
    if (!VALID.includes(status)) return res.status(400).json({ error: 'status must be pending | in_progress | done' });

    const now = new Date().toISOString();
    let updated = 0;
    for (const id of ids) {
      const record = dbHelpers.getRecordById(Number(id));
      if (!record) continue;
      record.data.recee_status = status;
      record.data.recee_status_at = now;
      record.data.recee_status_by = req.user?.name || 'Admin';
      record.data.updated_at = now;
      if (status === 'done') record.data.needs_recee = false;
      updated++;
    }
    if (updated) dbHelpers.write();
    res.json({ success: true, updated });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update recee status', details: error.message });
  }
});

export default router;