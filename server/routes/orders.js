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
import { optionalStaff, requireStaff } from '../middleware/staffAuth.js';

const router = express.Router();

// A signed-in customer (not staff). Same session table as /api/auth, so a
// customer token is enough to read back their own orders.
function resolveCustomer(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const session = token && dbHelpers.getSession(token);
  if (!session) return null;
  return dbHelpers.getUserById(session.user_id) || null;
}

// GET all orders — product shop orders only. The marketing tool
// pipeline is entirely in Leads; orders are only from products.
//
// Access: a staff member sees orders (role-scoped below). A signed-in
// *customer* sees only the orders carrying their own email or phone. An
// anonymous caller sees nothing — previously this route was readable by anyone
// and returned every customer's name, email, phone, address, items and total.
router.get('/', optionalStaff, (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    let orders = (dbHelpers.getShopOrders() || []).map((o) => ({ ...o, kind: 'shop' }));

    const role = req.staff ? req.staff.role : null;
    if (req.staff) {
      if (role === 'ops_executive' || role === 'member') {
        orders = orders.filter((o) => Number(o.assigned_to) === Number(req.staff.id));
      } else if (role === 'bd_executive' || role === 'bdm') {
        orders = [];
      }
    } else {
      const customer = resolveCustomer(req);
      if (!customer) {
        return res.status(401).json({ error: 'Sign in to view orders' });
      }
      const email = String(customer.email || '').toLowerCase();
      const phone = String(customer.phone || '').replace(/\D/g, '').slice(-10);
      orders = orders.filter((o) => {
        const oEmail = String(o.email || o.user?.email || o.contactEmail || '').toLowerCase();
        const oPhone = String(o.phone || o.user?.phone || o.address?.phone || '').replace(/\D/g, '').slice(-10);
        return (email && oEmail === email) || (phone && oPhone === phone);
      });
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

// PUT update order (product shop orders)
// Was unauthenticated: anyone could flip any order's status or assignment.
router.put('/:id', requireStaff, (req, res) => {
  try {
    const updates = req.body || {};
    const order = (dbHelpers.getShopOrders() || []).find(o => o.id === Number(req.params.id));
    if (!order) return res.status(404).json({ error: 'Order not found' });

    // Assignment must reference a real team member
    if (updates.assigned_to !== undefined && updates.assigned_to !== null && updates.assigned_to !== '') {
      const member = dbHelpers.getUserById(Number(updates.assigned_to));
      if (!member || !member.is_team) return res.status(400).json({ error: 'Assigned member not found' });
      const clean = { ...updates, assigned_to: Number(updates.assigned_to), assigned_at: new Date().toISOString() };
      if (updates.assigned_by !== undefined) clean.assigned_by = Number(updates.assigned_by);
      const updated = dbHelpers.updateShopOrder(req.params.id, clean);
      return res.json({ success: true, order: { ...updated, kind: 'shop' } });
    }
    if (updates.assigned_to === '' || updates.assigned_to === null) {
      updates.assigned_to = null;
      updates.assigned_by = updates.assigned_by !== undefined ? Number(updates.assigned_by) : null;
      updates.assigned_at = null;
    }

    const updated = dbHelpers.updateShopOrder(req.params.id, updates);
    res.json({ success: true, order: { ...updated, kind: 'shop' } });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update order', details: error.message });
  }
});

// DELETE order (product shop orders)
// Two bugs here: no auth, and it called deleteOrder, which filters
// db.data.orders — a different collection from the shop_orders this route
// lists. So it reported success while removing nothing.
router.delete('/:id', requireStaff, (req, res) => {
  try {
    const orders = dbHelpers.getShopOrders() || [];
    const order = orders.find((o) => o.id === Number(req.params.id));
    if (!order) return res.status(404).json({ error: 'Order not found' });
    dbHelpers.deleteShopOrder(order.id);
    res.json({ success: true, deleted: order.id });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete order', details: error.message });
  }
});

export default router;
