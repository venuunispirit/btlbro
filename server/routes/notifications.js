// The staff notification feed (the bell in the top bar).
//
//   GET  /api/admin/notifications            recent events + unread count
//   PUT  /api/admin/notifications/:id/read   mark one read
//   PUT  /api/admin/notifications/read-all   mark the whole feed read
//
// Events are written by the ledger hook and by a few explicit callers (a vendor
// submitted a bill, a recee capture needs review), so this file is only the
// read side — it never invents an event.
//
// What it adds on top of the stored row is a place to click: every payment event
// carries a lead_id or order_id, so the client can turn that into a link into
// the record the event is about. A bell that tells you something happened but
// not where to look is only half a notification.

import express from 'express';
import { dbHelpers } from '../db.js';
import { requireStaff } from '../middleware/staffAuth.js';

const router = express.Router();

const MAX_ITEMS = 30;

/** Where an event should take you when it is clicked. */
function target(n) {
  if (n.lead_id) return { tab: 'leads', id: n.lead_id, label: `Lead #${n.lead_id}` };
  if (n.order_id) return { tab: 'orders', id: n.order_id, label: `Order #${n.order_id}` };
  if (n.vendor_id) return { tab: 'vendors', id: n.vendor_id, label: 'Vendor' };
  return null;
}

router.get('/admin/notifications', requireStaff, (req, res) => {
  try {
    const rows = dbHelpers.getNotifications({ audience: 'staff' });
    const unread = rows.filter((n) => !n.read).length;
    res.json({
      notifications: rows.slice(0, MAX_ITEMS).map((n) => ({
        id: n.id,
        type: n.type,
        tone: n.tone,
        title: n.title,
        body: n.body,
        amount: n.amount ?? null,
        direction: n.direction ?? null,
        reference: n.reference ?? null,
        read: !!n.read,
        created_at: n.created_at,
        target: target(n),
      })),
      unread,
      total: rows.length,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load notifications', details: error.message });
  }
});

router.put('/admin/notifications/:id/read', requireStaff, (req, res) => {
  const row = dbHelpers.getNotificationById(req.params.id);
  if (!row) return res.status(404).json({ error: 'No such notification' });
  if (row.audience !== 'staff') return res.status(403).json({ error: 'Not your notification' });
  const updated = dbHelpers.updateNotification(row.id, { read: true, read_at: new Date().toISOString() });
  res.json({ success: true, id: updated.id });
});

router.put('/admin/notifications/read-all', requireStaff, (req, res) => {
  try {
    const changed = dbHelpers.markNotificationsRead({ audience: 'staff' });
    res.json({ success: true, changed });
  } catch (error) {
    res.status(500).json({ error: 'Failed to mark notifications read', details: error.message });
  }
});

export default router;
