// Customer orders API.
//
//   GET    /api/orders      → all orders
//   POST   /api/orders      → create order (called by checkout / customize form)
//   PUT    /api/orders/:id  → update order (status, read flag, admin edits)
//   DELETE /api/orders/:id  → delete order
//
// Orders are stored in db.json (server) so they persist across machines,
// instead of living only in the admin browser's localStorage.

import express from 'express';
import { dbHelpers } from '../db.js';
import { queueBackfill, flushBackfill } from '../services/sheetBackfill.js';
import { optionalStaff } from '../middleware/staffAuth.js';

const router = express.Router();

// GET all orders — staff-scoped: members see ONLY their assigned orders,
// managers/super admins (or no staff session) see all.
router.get('/', optionalStaff, (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    let orders = dbHelpers.getOrders();
    const role = req.staff ? req.staff.role : null;
    if (req.staff && role === 'member') {
      orders = orders.filter((o) => Number(o.assigned_to) === Number(req.staff.id));
    }
    res.json({ orders });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load orders', details: error.message });
  }
});

// POST create order
router.post('/', (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ error: 'Invalid order payload' });
    }
    const order = dbHelpers.addOrder(req.body);

    // Two-way sync: every selected location reaches the Google Sheet backfill
    // queue. Sheet rows → "inhouse"; places we found live on Google →
    // "from google" (flagged for the agency to price and onboard).
    let backfillQueued = 0;
    try {
      const locs = Array.isArray(order.selectedLocations) ? order.selectedLocations : [];
      const entries = locs.map((loc) => ({
        name: loc.fullName || loc.name,
        type: loc.type,
        lat: loc.lat,
        lng: loc.lng,
        source: loc.source, // 'inhouse' | 'from google' — tagged by MarketingTool
        pin_code: req.body.pincode,
      })).filter((e) => e.name);
      if (entries.length > 0) {
        backfillQueued = queueBackfill(entries).length;
        // Best-effort push; admin can also flush manually from the Drive tab
        flushBackfill().catch(() => {});
      }
    } catch (bfErr) {
      console.warn('[Orders] backfill queue failed:', bfErr.message);
    }

    res.json({ success: true, order, backfillQueued });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save order', details: error.message });
  }
});

// PUT update order
router.put('/:id', (req, res) => {
  try {
    const updates = req.body || {};
    const order = dbHelpers.getOrders().find(o => o.id === Number(req.params.id));
    if (!order) return res.status(404).json({ error: 'Order not found' });

    // Assignment must reference a real team member
    if (updates.assigned_to !== undefined && updates.assigned_to !== null && updates.assigned_to !== '') {
      const member = dbHelpers.getUserById(Number(updates.assigned_to));
      if (!member || !member.is_team) return res.status(400).json({ error: 'Assigned member not found' });
      const clean = { ...updates, assigned_to: Number(updates.assigned_to), assigned_at: new Date().toISOString() };
      if (updates.assigned_by !== undefined) clean.assigned_by = Number(updates.assigned_by);
      const updated = dbHelpers.updateOrder(req.params.id, clean);
      return res.json({ success: true, order: updated });
    }
    if (updates.assigned_to === '' || updates.assigned_to === null) {
      updates.assigned_to = null;
      updates.assigned_by = updates.assigned_by !== undefined ? Number(updates.assigned_by) : null;
      updates.assigned_at = null;
    }

    const updated = dbHelpers.updateOrder(req.params.id, updates);
    res.json({ success: true, order: updated });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update order', details: error.message });
  }
});

// DELETE order
router.delete('/:id', (req, res) => {
  try {
    dbHelpers.deleteOrder(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete order', details: error.message });
  }
});

export default router;
