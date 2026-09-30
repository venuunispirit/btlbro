// Purchase Orders — committing money to a vendor before it is owed.
//
//   GET  /api/admin/pos          list, filterable          (payout role)
//   POST /api/admin/pos          raise a PO                (payout role)
//   GET  /api/admin/pos/:id      one PO + its bills        (payout role)
//   PUT  /api/admin/pos/:id      edit while still pending  (payout role)
//   PUT  /api/admin/pos/:id/approve                        (payout role)
//   PUT  /api/admin/pos/:id/reject                          (payout role)
//   POST /api/admin/pos/:id/bills  raise a bill against it (payout role)
//
// The flow the business asked for:
//
//   raise PO ──► approve ──► vendor delivers ──► bill (matched to the PO)
//                                                        ──► approve ──► pay
//
// Two rules make this worth having at all:
//
//  1. Server-owned money. A PO line is `service_id` + `qty` and nothing else.
//     The rate is read from the vendor's own service catalogue, never from the
//     request. GST is added on top at the store rate. The browser's idea of
//     the total is discarded — the same rule the marketing checkout uses, for
//     the same reason: a tampered amount must not become a real commitment.
//
//  2. Separation of duties. Whoever raises a PO cannot approve it, and only an
//     approved PO can be invoiced. Money leaving the business always passes
//     through two people.

import express from 'express';
import { dbHelpers } from '../db.js';
import { requirePayoutRole } from '../middleware/staffAuth.js';

const router = express.Router();

const PO_STATUSES = new Set([
  'pending', 'approved', 'part_billed', 'billed', 'completed', 'rejected', 'cancelled',
]);

// ---- input coercion --------------------------------------------------------

const str = (v, max) => String(v ?? '').trim().slice(0, max);
const money = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
};
const qty = (v) => {
  const n = Number(v);
  // Whole units only, and no silent rounding: `Math.floor(1.5)` would quietly
  // turn "one and a half standees" into one, which is worse than refusing.
  return Number.isInteger(n) && n > 0 ? n : 0;
};
const fail = (res, status, error) => res.status(status).json({ error });

// GST is a store-wide setting, read the same way the storefront reads it.
const gstRate = () => {
  const v = Number(dbHelpers.getSettings()?.store?.gst_rate);
  return Number.isFinite(v) && v >= 0 ? v : 18;
};

/**
 * Price a set of PO lines from the vendor's catalogue. This is the only place
 * a PO's money is computed. Returns the lines plus their totals, or throws
 * `{status, error}` for the first line that does not make sense.
 */
function pricePoLines(vendor, rawLines) {
  if (!Array.isArray(rawLines) || !rawLines.length) {
    throw { status: 400, error: 'A purchase order needs at least one line' };
  }
  const catalogue = new Map(
    dbHelpers.getVendorServices(vendor.id).filter((s) => s.is_active !== false)
      .map((s) => [Number(s.id), s]),
  );

  const lines = [];
  for (const raw of rawLines.slice(0, 100)) {
    const service = catalogue.get(Number(raw?.service_id));
    if (!service) {
      throw { status: 400, error: 'One of the services is not in this vendor’s current price list' };
    }
    const q = qty(raw?.qty);
    if (!q) {
      throw { status: 400, error: `Enter how many “${service.name}” to order` };
    }
    const rate = money(service.rate);
    if (rate <= 0) {
      throw { status: 400, error: `“${service.name}” has no rate set, so it cannot be ordered` };
    }
    lines.push({
      service_id: service.id,
      // Name/unit are copied so an old PO still reads correctly if the vendor
      // later renames the service or retires it.
      name: str(service.name, 120),
      unit: str(service.unit, 20) || 'unit',
      qty: q,
      rate,
      amount: money(rate * q),
    });
  }

  const subtotal = money(lines.reduce((s, l) => s + l.amount, 0));
  const rate = gstRate();
  const gst = money(subtotal * rate / 100);
  return { lines, subtotal, gst_rate: rate, gst, total: money(subtotal + gst) };
}

/** A PO as the client needs it: vendor, bills, and how much is still unbilled. */
function decorate(po) {
  const bills = dbHelpers.getVendorBills({ po_id: po.id })
    .filter((b) => !['cancelled', 'rejected'].includes(b.status));
  const billedQty = dbHelpers.getPoBilledQty(po.id);
  return {
    ...po,
    vendor: (() => {
      const v = dbHelpers.getVendorById(po.vendor_id);
      return v ? { id: v.id, name: v.name, business_name: v.business_name, upi_id: v.upi_id } : null;
    })(),
    lead: (() => {
      const l = po.lead_id ? dbHelpers.getLeadById?.(po.lead_id) : null;
      return l ? { id: l.id, name: l.business_name || l.contactName || l.contact_name || `Lead #${l.id}` } : null;
    })(),
    order: (() => {
      const o = po.order_id ? dbHelpers.getShopOrders().find((x) => x.id === Number(po.order_id)) : null;
      return o ? { id: o.id } : null;
    })(),
    bills,
    // Per-line: ordered vs invoiced. This is what stops a double billing.
    progress: (po.lines || []).map((l) => ({
      service_id: l.service_id,
      name: l.name,
      unit: l.unit,
      qty: l.qty,
      billed_qty: billedQty.get(Number(l.service_id)) || 0,
    })),
    billed_total: money(bills.reduce((s, b) => s + (Number(b.amount) || 0), 0)),
  };
}

// ---- list / read -----------------------------------------------------------

router.get('/admin/pos', requirePayoutRole, (req, res) => {
  const { status, vendor_id } = req.query;
  if (status && !PO_STATUSES.has(status)) return fail(res, 400, `Unknown status "${status}"`);
  const filter = {};
  if (status) filter.status = status;
  if (vendor_id) filter.vendor_id = vendor_id;
  const pos = dbHelpers.getPurchaseOrders(filter)
    .map(decorate)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json({ pos, statuses: [...PO_STATUSES] });
});

router.get('/admin/pos/:id', requirePayoutRole, (req, res) => {
  const po = dbHelpers.getPurchaseOrderById(req.params.id);
  if (!po) return fail(res, 404, 'No such purchase order');
  res.json({ po: decorate(po) });
});

// ---- raise -----------------------------------------------------------------

router.post('/admin/pos', requirePayoutRole, (req, res) => {
  const b = req.body || {};
  const vendor = dbHelpers.getVendorById(b.vendor_id);
  if (!vendor) return fail(res, 400, 'Choose a vendor');
  if (vendor.is_active === false) return fail(res, 400, 'That vendor is not active');

  let priced;
  try {
    priced = pricePoLines(vendor, b.lines);
  } catch (e) {
    if (e?.status) return fail(res, e.status, e.error);
    throw e;
  }

  const po = dbHelpers.addPurchaseOrder({
    vendor_id: vendor.id,
    lines: priced.lines,
    subtotal: priced.subtotal,
    gst_rate: priced.gst_rate,
    gst: priced.gst,
    total: priced.total,
    lead_id: b.lead_id ? Number(b.lead_id) : null,
    order_id: b.order_id ? Number(b.order_id) : null,
    expected_date: str(b.expected_date, 30),
    notes: str(b.notes, 500),
    raised_by: req.staff?.id || null,
    raised_by_name: str(req.staff?.name, 100),
  });
  res.json({ success: true, po: decorate(po) });
});

// ---- edit ------------------------------------------------------------------

router.put('/admin/pos/:id', requirePayoutRole, (req, res) => {
  const po = dbHelpers.getPurchaseOrderById(req.params.id);
  if (!po) return fail(res, 404, 'No such purchase order');
  // Once approved, a PO is a commitment. Editing it would let an approver
  // quietly widen scope after the fact, so changes require a new PO.
  if (po.status !== 'pending') {
    return fail(res, 400, 'Only a pending purchase order can be edited — cancel it and raise a new one instead');
  }
  const b = req.body || {};
  const updates = {};
  if (b.expected_date !== undefined) updates.expected_date = str(b.expected_date, 30);
  if (b.notes !== undefined) updates.notes = str(b.notes, 500);
  if (b.lines !== undefined) {
    const vendor = dbHelpers.getVendorById(po.vendor_id);
    let priced;
    try {
      priced = pricePoLines(vendor, b.lines);
    } catch (e) {
      if (e?.status) return fail(res, e.status, e.error);
      throw e;
    }
    Object.assign(updates, {
      lines: priced.lines,
      subtotal: priced.subtotal,
      gst_rate: priced.gst_rate,
      gst: priced.gst,
      total: priced.total,
    });
  }
  res.json({ success: true, po: decorate(dbHelpers.updatePurchaseOrder(po.id, updates)) });
});

// ---- approve / reject ------------------------------------------------------

router.put('/admin/pos/:id/approve', requirePayoutRole, (req, res) => {
  const po = dbHelpers.getPurchaseOrderById(req.params.id);
  if (!po) return fail(res, 404, 'No such purchase order');
  if (po.status !== 'pending') {
    return fail(res, 400, `This purchase order is ${po.status.replace(/_/g, ' ')} — it cannot be approved`);
  }
  // Separation of duties. If the same person raised it, approving it would
  // collapse the two-person check this whole flow exists to provide.
  if (req.staff?.id != null && po.raised_by != null && Number(req.staff.id) === Number(po.raised_by)) {
    return fail(res, 403, 'You raised this purchase order, so someone else has to approve it');
  }
  const po2 = dbHelpers.updatePurchaseOrder(po.id, {
    status: 'approved',
    approved_by: req.staff?.id || null,
    approved_by_name: str(req.staff?.name, 100),
    approved_at: new Date().toISOString(),
  });
  res.json({ success: true, po: decorate(po2) });
});

router.put('/admin/pos/:id/reject', requirePayoutRole, (req, res) => {
  const po = dbHelpers.getPurchaseOrderById(req.params.id);
  if (!po) return fail(res, 404, 'No such purchase order');
  if (po.status !== 'pending') {
    return fail(res, 400, `This purchase order is ${po.status.replace(/_/g, ' ')} — it cannot be rejected`);
  }
  const reason = str(req.body?.reason, 300);
  if (!reason) return fail(res, 400, 'Say why this is being rejected');
  const po2 = dbHelpers.updatePurchaseOrder(po.id, {
    status: 'rejected',
    rejected_by_name: str(req.staff?.name, 100),
    rejected_at: new Date().toISOString(),
    rejection_reason: reason,
  });
  res.json({ success: true, po: decorate(po2) });
});

// ---- bill against a PO -----------------------------------------------------

/**
 * Raise a bill for part (or all) of a PO, enforcing that it only claims
 * quantity that was ordered and not already invoiced.
 *
 * Exported because a vendor may submit a bill from their own portal, and that
 * path must obey exactly the same matching rules as the admin one — otherwise
 * the 3-way match is only half-enforced and a vendor could simply self-serve
 * their way around it.
 *
 * Throws `{status, error}` on the first line that does not reconcile.
 */
export function raiseBillAgainstPo(po, { lines: rawLines, description, source }) {
  if (!['approved', 'part_billed'].includes(po.status)) {
    throw { status: 400, error: `This purchase order is ${po.status.replace(/_/g, ' ')} — only an approved one can be billed` };
  }

  const byId = new Map((po.lines || []).map((l) => [Number(l.service_id), l]));
  const already = dbHelpers.getPoBilledQty(po.id);

  const lines = [];
  for (const raw of (Array.isArray(rawLines) ? rawLines : []).slice(0, 100)) {
    const poLine = byId.get(Number(raw?.service_id));
    if (!poLine) {
      throw { status: 400, error: 'One of the billed services was never ordered on this purchase order' };
    }
    const q = qty(raw?.qty);
    if (!q) throw { status: 400, error: `Enter how many “${poLine.name}” to bill` };
    const used = already.get(Number(poLine.service_id)) || 0;
    if (used + q > poLine.qty) {
      throw {
        status: 400,
        error: `“${poLine.name}” has already been billed for ${used} of ${poLine.qty} ${poLine.unit}s — you can bill ${Math.max(0, poLine.qty - used)} more`,
      };
    }
    lines.push({
      service_id: poLine.service_id,
      name: poLine.name,
      unit: poLine.unit,
      qty: q,
      // The rate is the PO's rate, never the request's. A vendor cannot raise
      // the price between order and invoice.
      rate: poLine.rate,
      amount: money(poLine.rate * q),
    });
  }
  if (!lines.length) throw { status: 400, error: 'A bill needs at least one line' };

  const subtotal = money(lines.reduce((s, l) => s + l.amount, 0));
  const rate = po.gst_rate ?? gstRate();
  const gst = money(subtotal * rate / 100);
  const bill = dbHelpers.addVendorBill({
    vendor_id: po.vendor_id,
    po_id: po.id,
    kind: po.lead_id ? 'lead' : po.order_id ? 'order' : 'manual',
    lead_id: po.lead_id || null,
    order_id: po.order_id || null,
    lines,
    amount: money(subtotal + gst),
    subtotal,
    gst_rate: rate,
    gst,
    description: str(description, 300) || `Bill against ${po.po_number}`,
    source: source || 'admin',
  });
  dbHelpers.syncPurchaseOrderStatus(po.id);
  return bill;
}

router.post('/admin/pos/:id/bills', requirePayoutRole, (req, res) => {
  const po = dbHelpers.getPurchaseOrderById(req.params.id);
  if (!po) return fail(res, 404, 'No such purchase order');
  const b = req.body || {};
  try {
    const bill = raiseBillAgainstPo(po, { lines: b.lines, description: b.description, source: 'admin' });
    res.json({ success: true, bill, po: decorate(dbHelpers.getPurchaseOrderById(po.id)) });
  } catch (e) {
    if (e?.status) return fail(res, e.status, e.error);
    throw e;
  }
});

export default router;
