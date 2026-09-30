// Vendors we pay for work done against a lead or an order.
//
//   POST /api/vendors/register      vendor signs themselves up (public)
//   POST /api/vendors/login         vendor signs in           (public)
//   POST /api/vendors/logout        vendor signs out
//   GET  /api/vendors/me            own bills + payouts       (vendor token)
//   POST /api/vendors/bills         submit an ad-hoc bill      (vendor token)
//
//   GET  /api/admin/vendors         list + money rollup        (payout role)
//   POST /api/admin/vendors         register on a vendor's behalf
//   PUT  /api/admin/vendors/:id     edit details / rate / status
//   GET  /api/admin/vendors/bills   all bills, filterable      (payout role)
//   POST /api/admin/vendors/bills   raise a bill manually
//   PUT  /api/admin/vendors/bills/:id/approve   → ledger row
//   PUT  /api/admin/vendors/bills/:id/reject
//   GET  /api/admin/notify/channels delivery channel status
//
// Money model: a bill is what a vendor is owed; approving it writes a normal
// `payments` ledger row with direction 'out', so vendor payouts land in the
// same ledger as collections and can be rolled up per lead or per order.
// PayU Payouts is not enabled on this account, so approval uses the local
// approval rail — the employee approves in their own UPI app, then flips the
// row to paid. That flip goes through dbHelpers.updatePayment, which is also
// what fires the success/failure notification.

import express from 'express';
import crypto from 'crypto';
import { dbHelpers } from '../db.js';
import { requirePayoutRole } from '../middleware/staffAuth.js';
import { buildUpiUri, validateVpaFormat, MCC } from '../services/upi.js';
import { raiseBillAgainstPo } from './purchaseOrders.js';
import { listChannels, record as recordNotification } from '../services/notify.js';

const router = express.Router();

const BILL_STATUSES = new Set(['pending', 'approved', 'rejected', 'paid', 'cancelled']);

// ---- auth helpers (vendors are NOT staff — separate store, separate token) ----

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(String(password), salt, 64).toString('hex') };
}

function verifyPassword(password, salt, expectedHash) {
  const { hash } = hashPassword(password, salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(String(expectedHash || ''), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

function tokenExpiry() {
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
}

function requireVendor(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const session = token && dbHelpers.getVendorSession(token);
  if (!session) return res.status(401).json({ error: 'Vendor sign-in required' });
  const vendor = dbHelpers.getVendorById(session.vendor_id);
  if (!vendor || vendor.is_active === false) {
    return res.status(401).json({ error: 'Vendor account is not active' });
  }
  req.vendor = vendor;
  req.vendorToken = token;
  next();
}

function str(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

function publicVendor(v, { withSecret = false } = {}) {
  if (!v) return null;
  const out = {
    id: v.id,
    name: v.name,
    business_name: v.business_name,
    email: v.email,
    phone: v.phone,
    upi_id: v.upi_id,
    upi_name: v.upi_name,
    category: v.category,
    // Legacy single-rate field, kept so existing accrual rules keep working.
    // New work reads the service catalogue below instead.
    rate: v.rate ?? null,
    // What this vendor sells and at what price per unit. Purchase orders are
    // priced from this list.
    services: Array.isArray(v.services) ? v.services : [],
    is_active: v.is_active !== false,
    created_at: v.created_at,
  };
  if (!withSecret) delete out.password_hash;
  return out;
}

// What a vendor owes vs has been paid. Billed is pending+approved; paid comes
// from settled outbound ledger rows, never from the bill's own status field.
function vendorTotals(vendorId) {
  const bills = dbHelpers.getVendorBills({ vendor_id: vendorId });
  const payouts = dbHelpers.getPaymentsForVendor(vendorId).filter(p => p.direction === 'out');
  const sum = (rows, field = 'amount') => rows.reduce((s, r) => s + (Number(r[field]) || 0), 0);
  return {
    pending: sum(bills.filter(b => b.status === 'pending')),
    approved_unpaid: sum(bills.filter(b => b.status === 'approved')),
    rejected: sum(bills.filter(b => b.status === 'rejected')),
    paid: sum(payouts.filter(p => p.status === 'paid')),
    in_flight: sum(payouts.filter(p => p.status === 'awaiting' || p.status === 'processing')),
    bill_count: bills.length,
  };
}

function leadLabel(lead) {
  if (!lead) return null;
  return {
    id: lead.id,
    name: lead.business_name || lead.contact_name || `Lead #${lead.id}`,
    pincode: lead.pincode || '',
    phone: lead.phone || '',
  };
}

// ---- vendor-facing (public auth) ----

router.post('/vendors/register', (req, res) => {
  const b = req.body || {};
  const name = str(b.name, 100);
  const email = str(b.email, 120).toLowerCase();
  const password = String(b.password || '');

  if (!name || !email || password.length < 6) {
    return res.status(400).json({ error: 'Name, email and a password of at least 6 characters are required' });
  }
  if (dbHelpers.getVendorByEmail(email)) {
    return res.status(409).json({ error: 'A vendor with this email already exists' });
  }
  // A UPI id is what we actually pay to, so validate it up front rather than
  // discovering at payout time that the money cannot be sent.
  const upi_id = str(b.upi_id, 100);
  if (upi_id) {
    const check = validateVpaFormat(upi_id);
    if (!check.valid) {
      return res.status(400).json({ error: `That UPI ID looks wrong: ${check.reason || 'unrecognised format'}` });
    }
  }

  const { salt, hash } = hashPassword(password);
  const vendor = dbHelpers.addVendor({
    name,
    business_name: str(b.business_name, 120) || name,
    email,
    phone: str(b.phone, 20).replace(/\D/g, '').slice(0, 15),
    upi_id,
    upi_name: str(b.upi_name, 100) || name,
    category: str(b.category, 60),
    rate: money(b.rate),
    password_hash: hash,
    password_salt: salt,
  });

  const token = newToken();
  dbHelpers.addVendorSession({ token, vendor_id: vendor.id, expires_at: tokenExpiry(), created_at: new Date().toISOString() });

  recordNotification({
    type: 'vendor_registered',
    title: 'New vendor registered',
    body: `${vendor.name} (${vendor.business_name}) signed up and is awaiting a rate.`,
  });

  res.json({ success: true, vendor: publicVendor(vendor), token });
});

router.post('/vendors/login', (req, res) => {
  const b = req.body || {};
  const vendor = dbHelpers.getVendorByEmail(str(b.email, 120));
  if (!vendor || !verifyPassword(String(b.password || ''), vendor.password_salt, vendor.password_hash)) {
    // Same message either way so the form cannot be used to enumerate vendors.
    return res.status(401).json({ error: 'Email or password is incorrect' });
  }
  if (vendor.is_active === false) {
    return res.status(403).json({ error: 'This vendor account has been deactivated. Please contact us.' });
  }
  const token = newToken();
  dbHelpers.addVendorSession({ token, vendor_id: vendor.id, expires_at: tokenExpiry(), created_at: new Date().toISOString() });
  res.json({ success: true, vendor: publicVendor(vendor), token });
});

router.post('/vendors/logout', requireVendor, (req, res) => {
  dbHelpers.deleteVendorSession(req.vendorToken);
  res.json({ success: true });
});

router.get('/vendors/me', requireVendor, (req, res) => {
  const vendor = req.vendor;
  const bills = dbHelpers.getVendorBills({ vendor_id: vendor.id })
    .map((b) => ({ ...b, lead: leadLabel(b.lead_id ? dbHelpers.getLeadById?.(b.lead_id) : null) }))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const payouts = dbHelpers.getPaymentsForVendor(vendor.id)
    .filter(p => p.direction === 'out')
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  res.json({
    vendor: publicVendor(vendor),
    totals: vendorTotals(vendor.id),
    bills,
    payouts: payouts.map((p) => ({
      id: p.id, amount: p.amount, status: p.status, reference: p.reference,
      note: p.note, paid_at: p.paid_at || null, created_at: p.created_at,
    })),
  });
});

// A vendor can raise work they were not auto-billed for (a rush job, a
// correction). It lands as `pending` and waits for an admin to approve.
// A vendor bills against a purchase order, not against a number they type. The
// rate comes from the PO and the quantity is checked against what is still
// unbilled, so a vendor cannot invent a price or invoice the same work twice.
router.post('/vendors/bills', requireVendor, (req, res) => {
  const b = req.body || {};
  const po = dbHelpers.getPurchaseOrderById(b.po_id);
  if (!po) return res.status(400).json({ error: 'Choose a purchase order to bill against' });
  if (po.vendor_id !== req.vendor.id) return res.status(403).json({ error: 'That purchase order is not yours' });

  let bill;
  try {
    bill = raiseBillAgainstPo(po, { lines: b.lines, description: b.description, source: 'vendor' });
  } catch (e) {
    if (e?.status) return res.status(e.status).json({ error: e.error });
    throw e;
  }

  recordNotification({
    type: 'bill_submitted',
    title: `Bill submitted — ₹${bill.amount.toLocaleString('en-IN')}`,
    body: `${req.vendor.name} billed against ${po.po_number} for ₹${bill.amount.toLocaleString('en-IN')}.`,
    vendor_id: req.vendor.id,
    po_id: po.id,
  });

  res.json({ success: true, bill });
});

// ---- admin-facing ----

router.get('/admin/vendors', requirePayoutRole, (req, res) => {
  const vendors = dbHelpers.getVendors().map((v) => ({
    ...publicVendor(v),
    totals: vendorTotals(v.id),
  }));
  res.json({ vendors });
});

router.post('/admin/vendors', requirePayoutRole, (req, res) => {
  const b = req.body || {};
  const name = str(b.name, 100);
  const email = str(b.email, 120).toLowerCase();
  const password = String(b.password || '');
  if (!name || !email || password.length < 6) {
    return res.status(400).json({ error: 'Name, email and a password of at least 6 characters are required' });
  }
  if (dbHelpers.getVendorByEmail(email)) {
    return res.status(409).json({ error: 'A vendor with this email already exists' });
  }
  const upi_id = str(b.upi_id, 100);
  if (upi_id) {
    const check = validateVpaFormat(upi_id);
    if (!check.valid) return res.status(400).json({ error: `That UPI ID looks wrong: ${check.reason || 'unrecognised format'}` });
  }

  const { salt, hash } = hashPassword(password);
  const vendor = dbHelpers.addVendor({
    name,
    business_name: str(b.business_name, 120) || name,
    email,
    phone: str(b.phone, 20).replace(/\D/g, '').slice(0, 15),
    upi_id,
    upi_name: str(b.upi_name, 100) || name,
    category: str(b.category, 60),
    rate: money(b.rate),
    password_hash: hash,
    password_salt: salt,
  });
  res.json({ success: true, vendor: publicVendor(vendor) });
});

router.put('/admin/vendors/:id', requirePayoutRole, (req, res) => {
  const vendor = dbHelpers.getVendorById(req.params.id);
  if (!vendor) return res.status(404).json({ error: 'No such vendor' });

  const b = req.body || {};
  const updates = {};
  for (const key of ['name', 'business_name', 'upi_name', 'category']) {
    if (b[key] !== undefined) updates[key] = str(b[key], 120);
  }
  if (b.phone !== undefined) updates.phone = str(b.phone, 20).replace(/\D/g, '').slice(0, 15);
  if (b.email !== undefined) {
    const email = str(b.email, 120).toLowerCase();
    const clash = dbHelpers.getVendorByEmail(email);
    if (clash && clash.id !== vendor.id) return res.status(409).json({ error: 'Another vendor already uses this email' });
    updates.email = email;
  }
  if (b.upi_id !== undefined) {
    const upi_id = str(b.upi_id, 100);
    if (upi_id) {
      const check = validateVpaFormat(upi_id);
      if (!check.valid) return res.status(400).json({ error: `That UPI ID looks wrong: ${check.reason || 'unrecognised format'}` });
    }
    updates.upi_id = upi_id;
  }
  if (b.rate !== undefined) updates.rate = money(b.rate); // null clears it
  if (b.is_active !== undefined) updates.is_active = !!b.is_active;
  if (b.password) {
    if (String(b.password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const { salt, hash } = hashPassword(String(b.password));
    updates.password_salt = salt;
    updates.password_hash = hash;
  }

  res.json({ success: true, vendor: publicVendor(dbHelpers.updateVendor(vendor.id, updates)) });
});

// ---- the vendor's service catalogue ----
//
// A vendor sells more than one thing at more than one price, so the price list
// is its own thing rather than the single flat `rate` the vendor record used to
// carry. These live on the vendor (directory) tab; POs on the Accounts tab draw
// their rates from here.

/** Validate and normalise one catalogue entry. */
function serviceInput(body) {
  const name = str(body?.name, 120);
  if (!name) return { error: 'Give the service a name' };
  const rate = money(body?.rate);
  if (rate <= 0) return { error: `Enter a rate for “${name}” greater than zero` };
  return {
    value: {
      name,
      unit: str(body?.unit, 20) || 'unit',
      rate,
      description: str(body?.description, 200),
    },
  };
}

router.get('/admin/vendors/:id/services', requirePayoutRole, (req, res) => {
  const vendor = dbHelpers.getVendorById(req.params.id);
  if (!vendor) return res.status(404).json({ error: 'No such vendor' });
  res.json({ services: dbHelpers.getVendorServices(vendor.id) });
});

router.post('/admin/vendors/:id/services', requirePayoutRole, (req, res) => {
  const vendor = dbHelpers.getVendorById(req.params.id);
  if (!vendor) return res.status(404).json({ error: 'No such vendor' });
  const { value, error } = serviceInput(req.body);
  if (error) return res.status(400).json({ error });
  res.json({ success: true, service: dbHelpers.addVendorService(vendor.id, value) });
});

router.put('/admin/vendors/:id/services/:sid', requirePayoutRole, (req, res) => {
  const vendor = dbHelpers.getVendorById(req.params.id);
  if (!vendor) return res.status(404).json({ error: 'No such vendor' });
  const { value, error } = serviceInput(req.body);
  if (error) return res.status(400).json({ error });
  const updated = dbHelpers.updateVendorService(vendor.id, req.params.sid, value);
  if (!updated) return res.status(404).json({ error: 'No such service' });
  res.json({ success: true, service: updated });
});

// Retired, not deleted — old POs and bills still quote these by name and rate.
router.delete('/admin/vendors/:id/services/:sid', requirePayoutRole, (req, res) => {
  const vendor = dbHelpers.getVendorById(req.params.id);
  if (!vendor) return res.status(404).json({ error: 'No such vendor' });
  const removed = dbHelpers.removeVendorService(vendor.id, req.params.sid);
  if (!removed) return res.status(404).json({ error: 'No such service' });
  res.json({ success: true, service: removed });
});

router.get('/admin/vendors/bills', requirePayoutRole, (req, res) => {
  const { status, vendor_id, lead_id, order_id } = req.query;
  const filter = {};
  if (status) {
    if (!BILL_STATUSES.has(status)) return res.status(400).json({ error: `Unknown status "${status}"` });
    filter.status = status;
  }
  if (vendor_id) filter.vendor_id = vendor_id;
  if (lead_id) filter.lead_id = lead_id;
  if (order_id) filter.order_id = order_id;

  const bills = dbHelpers.getVendorBills(filter)
    .map((b) => ({
      ...b,
      vendor: publicVendor(dbHelpers.getVendorById(b.vendor_id)),
      lead: b.lead_id ? leadLabel(dbHelpers.getLeadById?.(b.lead_id)) : null,
      po: b.po_id ? (() => {
        const po = dbHelpers.getPurchaseOrderById(b.po_id);
        return po ? { id: po.id, po_number: po.po_number, status: po.status } : null;
      })() : null,
      payment: b.payment_id ? dbHelpers.getPayments().find(p => p.id === b.payment_id) || null : null,
    }))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  res.json({ bills, statuses: [...BILL_STATUSES] });
});

// Admins raise bills the same way vendors do: against an approved PO, priced
// from the PO's own rates. One code path means the 3-way match cannot be
// bypassed just by choosing a different screen.
router.post('/admin/vendors/bills', requirePayoutRole, (req, res) => {
  const b = req.body || {};
  const po = dbHelpers.getPurchaseOrderById(b.po_id);
  if (!po) return res.status(400).json({ error: 'Choose a purchase order to bill against' });

  try {
    const bill = raiseBillAgainstPo(po, { lines: b.lines, description: b.description, source: 'admin' });
    res.json({ success: true, bill });
  } catch (e) {
    if (e?.status) return res.status(e.status).json({ error: e.error });
    throw e;
  }
});

// Approving a bill is what actually moves money: it writes the outbound ledger
// row and hands the employee a UPI intent to approve in their own app.
router.put('/admin/vendors/bills/:id/approve', requirePayoutRole, (req, res) => {
  const bill = dbHelpers.getVendorBillById(req.params.id);
  if (!bill) return res.status(404).json({ error: 'No such bill' });
  if (bill.status === 'paid') return res.status(400).json({ error: 'This bill has already been paid' });
  if (bill.status === 'cancelled') return res.status(400).json({ error: 'This bill was cancelled' });
  if (bill.status === 'rejected') return res.status(400).json({ error: 'This bill was rejected — raise a new one instead' });

  // Re-approving a bill that already has an unpaid movement would pay the
  // vendor twice. Only a dead payment (failed/cancelled) may be retried.
  if (bill.payment_id) {
    const existing = dbHelpers.getPayments().find((p) => p.id === bill.payment_id);
    if (existing && !['failed', 'cancelled'].includes(existing.status)) {
      return res.status(400).json({
        error: `This bill already has a payment in flight (${existing.reference}, ${existing.status}). Settle or cancel that one first.`,
        payment: existing,
      });
    }
  }

  const vendor = dbHelpers.getVendorById(bill.vendor_id);
  if (!vendor) return res.status(400).json({ error: 'This bill has no vendor' });
  if (!vendor.upi_id) {
    return res.status(400).json({ error: `${vendor.name} has no UPI ID on file — add one before paying` });
  }
  if (vendor.is_active === false) {
    return res.status(400).json({ error: `${vendor.name} is deactivated — reactivate before paying` });
  }

  // The admin may adjust the amount at approval (the vendor's default rate and
  // the billed amount are starting points, not the final figure).
  const amount = money(req.body?.amount) || money(bill.amount);
  if (!amount) return res.status(400).json({ error: 'Enter an amount greater than zero' });

  const settings = dbHelpers.getSettings() || {};
  const reference = `btl_vout_${String(Date.now()).slice(-8)}${crypto.randomBytes(2).toString('hex')}`;
  const note = str(req.body?.note, 100) || bill.description || `Vendor payment — ${vendor.name}`;
  const mcc = MCC.SERVICES;

  const intentUri = buildUpiUri({
    vpa: vendor.upi_id,
    payeeName: vendor.upi_name || vendor.name,
    amount,
    note,
    txnRef: reference,
    mcc,
  });

  const row = dbHelpers.addPayment({
    direction: 'out',
    status: 'awaiting',
    amount,
    currency: 'INR',
    vpa: vendor.upi_id,
    counterparty_name: vendor.name,
    counterparty_phone: vendor.phone || '',
    counterparty_email: vendor.email || '',
    note,
    reference,
    intent_uri: intentUri,
    // 'approval' = employee approves in their UPI app. Would be 'payouts' once
    // PayU Payouts is enabled for this merchant.
    rail: 'approval',
    mcc,
    vendor_id: vendor.id,
    vendor_bill_id: bill.id,
    // Carried through so the PO follows its money: when this row settles, the
    // PO is re-synced and can reach 'completed'.
    po_id: bill.po_id || null,
    lead_id: bill.lead_id || null,
    order_id: bill.order_id || null,
    // Company is deliberately NOT set: a vendor is a supplier, never a
    // customer, so it must not appear as a Companies row or a receivable.
    company_id: null,
    created_by: req.staff?.id || null,
    created_by_name: req.staff?.name || '',
  });

  const updated = dbHelpers.updateVendorBill(bill.id, {
    status: 'approved',
    amount,
    payment_id: row.id,
    approved_by: req.staff?.id || null,
    approved_by_name: req.staff?.name || '',
    approved_at: new Date().toISOString(),
  });

  res.json({
    success: true,
    bill: updated,
    payment: row,
    intent_uri: intentUri,
    dispatch: { ok: false, pending_user_approval: true },
  });
});

router.put('/admin/vendors/bills/:id/reject', requirePayoutRole, (req, res) => {
  const bill = dbHelpers.getVendorBillById(req.params.id);
  if (!bill) return res.status(404).json({ error: 'No such bill' });
  if (bill.status === 'paid') return res.status(400).json({ error: 'This bill has already been paid' });

  const updated = dbHelpers.updateVendorBill(bill.id, {
    status: 'rejected',
    rejection_reason: str(req.body?.reason, 300),
    decided_by: req.staff?.id || null,
    decided_by_name: req.staff?.name || '',
    decided_at: new Date().toISOString(),
  });
  // Rejecting a bill hands its claimed quantity back to the PO, so the vendor
  // can invoice that work again once it is redone. Without this the PO would
  // still read as fully billed and reject the corrected bill.
  if (updated.po_id) dbHelpers.syncPurchaseOrderStatus(updated.po_id);
  res.json({ success: true, bill: updated });
});

router.get('/admin/notify/channels', requirePayoutRole, (req, res) => {
  res.json({ channels: listChannels() });
});

export default router;
