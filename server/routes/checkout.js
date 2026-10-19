// Public checkout payment API (mounted at /api/checkout).
//
//   POST /status/:reference   poll a payment request's state
//   POST /pay                  record a lead + build its collection request
//
// This is the seam between the public marketing funnel and the money ledger.
// The customer is not signed in, so two rules apply:
//
//   1. The amount is recomputed here from admin settings. The browser's
//      `amountPaid` is never trusted — otherwise anyone could POST their own
//      number and land a "paid ₹1" lead in the BDM's pipeline.
//   2. The lead payload is allowlisted field by field. `addLead` spreads
//      whatever it is given, so trusting the body would let a stranger write
//      `status: 'completed'` or overwrite `bd_exec_id` on their own lead.

import express from 'express';
import { dbHelpers, subscribePayment } from '../db.js';
import { createCollectRequest } from './upiPayments.js';

const router = express.Router();

// --- crude per-IP throttle -------------------------------------------------
// Public and unauthenticated, so without a cap one script could fill the
// ledger and the leads table with junk rows.
const HITS = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_HITS = 12;

function throttle(req, res, next) {
  const key = String(req.ip || req.socket?.remoteAddress || 'unknown');
  const now = Date.now();
  const entry = HITS.get(key);
  if (!entry || now > entry.start + WINDOW_MS) {
    HITS.set(key, { start: now, count: 1 });
    return next();
  }
  entry.count += 1;
  if (entry.count > MAX_HITS) {
    return res.status(429).json({ error: 'Too many attempts. Please try again shortly.' });
  }
  return next();
}

// Keep the throttle map from growing without bound.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of HITS) if (now > entry.start + WINDOW_MS) HITS.delete(key);
}, WINDOW_MS).unref?.();

// --- input coercion -------------------------------------------------------
const str = (v, max) => String(v ?? '').trim().slice(0, max);
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
};

function cleanLocations(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 500).map((loc) => {
    const l = loc && typeof loc === 'object' ? loc : {};
    const flat = (o) => {
      if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
      const out = {};
      for (const [k, v] of Object.entries(o).slice(0, 50)) out[str(k, 60)] = num(v);
      return out;
    };
    return {
      name: str(l.name, 150),
      type: str(l.type, 60),
      lat: Number(l.lat) || 0,
      lng: Number(l.lng) || 0,
      promotions: flat(l.promotions),
      prices: flat(l.prices),
      source: l.source === 'from google' ? 'from google' : 'inhouse',
    };
  });
}

function cleanInvoice(raw, computedTotal) {
  const inv = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const breakdown = {};
  if (inv.promoBreakdown && typeof inv.promoBreakdown === 'object' && !Array.isArray(inv.promoBreakdown)) {
    for (const [k, v] of Object.entries(inv.promoBreakdown).slice(0, 50)) {
      const b = v && typeof v === 'object' ? v : {};
      breakdown[str(k, 60)] = { count: num(b.count), price: num(b.price), total: num(b.total), label: str(b.label, 80) };
    }
  }
  return {
    locationCost: num(inv.locationCost),
    promoCost: num(inv.promoCost),
    agencyFee: num(inv.agencyFee),
    agencyFeePercent: num(inv.agencyFeePercent),
    gst: num(inv.gst),
    total: num(inv.total) || computedTotal,
    perLocation: num(inv.perLocation),
    promoBreakdown: breakdown,
  };
}


// --- authoritative pricing ---------------------------------------------------
// The sheet is the source of truth for prices, so the server prices the cart
// itself out of `records` and charges that number. Only the *selection* (which
// services on which location) comes from the browser — never a price, never a
// total. Anything the browser claims about money is display-only.
//
// Bookable locations are always sheet-backed: Google "On Request" rows are
// rendered but cannot be selected, so a selected location that we cannot find
// is a tampered or stale payload and is refused rather than guessed at.
const SERVICE_KEYS = ['digital promotion', 'lift promotion', 'stall space', 'digital screen', 'notice board'];

/** Pull a rupee number out of "₹10,000" / "10000" / 10000. */
function money(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = Number(String(v ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** Canonical per-service prices for one record, keyed by normalised service name. */
function servicePricesOf(record) {
  const out = {};
  const d = record?.data || {};
  if (d.services && typeof d.services === 'object' && !Array.isArray(d.services)) {
    for (const [k, v] of Object.entries(d.services)) {
      const key = String(k).toLowerCase().trim().replace(/_/g, ' ');
      // Some sheets keep a price map per service, others a flat number.
      const price = money(v && typeof v === 'object' ? (v.price ?? v.amount) : v);
      if (key) out[key] = price;
    }
  }
  for (const key of SERVICE_KEYS) {
    if (out[key] != null) continue;
    const flat = d[key] ?? d[key.replace(/ /g, '_')];
    if (flat != null) out[key] = money(flat);
  }
  return out;
}

/**
 * Find the record a selected location refers to. Mirrors the containment rule
 * the checkout UI already uses when it resolves a selection to a sheet row
 * (a location may arrive as "A-101, Sunrise Residency" where the sheet says
 * "A-101"), so a legitimate selection is never priced as unknown. Exact
 * matches always win, and the catchment type has to agree when both know it.
 */
function findRecord(locations, name, type) {
  const want = String(name || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const wantType = String(type || '').toLowerCase().trim();
  if (!want) return null;
  const typeOk = (rType) => !wantType || !rType || rType === wantType;

  let fuzzy = null;
  for (const l of locations) {
    const d = l?.data || {};
    const rName = String(d.name ?? l.name ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
    const rType = String(d.type ?? '').toLowerCase().trim();
    if (!rName || !typeOk(rType)) continue;
    if (rName === want) return l;
    if (!fuzzy && (want.includes(rName) || rName.includes(want))) fuzzy = l;
  }
  return fuzzy;
}

/**
 * Price the cart from server-side data. Throws { status, error } when the
 * payload cannot be corroborated, so a tampered total can never become a
 * charge. `selections` is [{ name, type, services: [serviceKey, ...] }].
 */
function priceCart({ locations, selections, durationMonths }) {
  const months = Math.max(1, Math.min(24, Math.round(Number(durationMonths) || 1)));
  if (!Array.isArray(selections) || !selections.length) {
    throw { status: 400, error: 'No locations were selected for this campaign' };
  }

  // getAllRecords() already drops deactivated rows.
  const records = dbHelpers.getAllRecords();
  const settings = dbHelpers.getSettings() || {};

  let promoCost = 0;
  let anySheetPrice = false;
  const breakdown = {};
  // Locations we have no sheet row for. Reported back so the gap is visible in
  // the admin instead of silently costing the customer nothing.
  const unpriced = [];

  for (const sel of selections.slice(0, 500)) {
    const rec = findRecord(records, sel?.name, sel?.type);
    if (!rec) {
      // No sheet row for this location is a gap in OUR data, not something the
      // customer did wrong. Rejecting the checkout here meant an un-synced
      // building could not be paid for at all, which lost real revenue over a
      // missing spreadsheet row. It now contributes nothing to the quote and
      // the campaign still proceeds on the booking amount; the recee team adds
      // the pricing afterwards and bills the balance from the Accounts tab.
      unpriced.push(String(sel?.name || '').slice(0, 60));
      continue;
    }
    const prices = servicePricesOf(rec);
    const keys = Array.isArray(sel.services) ? sel.services : [];
    for (const rawKey of keys.slice(0, 50)) {
      const key = String(rawKey).toLowerCase().replace(/[\s_]+/g, ' ').trim();
      if (!(key in prices)) continue;          // not offered here — never charge for it
      const price = prices[key];
      if (!(price > 0)) continue;              // no price on the sheet — nothing to charge
      anySheetPrice = true;
      const line = price * months;
      promoCost += line;
      if (!breakdown[key]) breakdown[key] = { count: 0, price, total: 0 };
      breakdown[key].count += 1;
      breakdown[key].total += line;
    }
  }

  // Locations priced from the sheet don't pay a separate base location fee,
  // mirroring the checkout UI. per_location_price is admin-controlled.
  const perLocation = anySheetPrice ? 0 : (Number(settings.per_location_price) || 0);
  const locationCost = perLocation * selections.length * months;

  const agencyFeePercent = Number(settings.agency_fee) || 0;
  const agencyFee = Math.round((locationCost + promoCost) * agencyFeePercent / 100);
  const subtotal = locationCost + promoCost + agencyFee;
  const gst = Math.round(subtotal * 0.18);
  const total = subtotal + gst;

  return {
    locationCost, promoCost, agencyFee, agencyFeePercent, gst, total,
    perLocation, promoBreakdown: breakdown, months, unpriced,
  };
}

/** Booking amount comes from admin settings, never the client. */
function bookingAmount() {
  const v = Number(dbHelpers.getSettings()?.payment?.min_booking);
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : 999;
}

// ------------------------------------------------------------------ status --

/**
 * Public status poll for a checkout payment. Deliberately narrow: status and
 * amount only, no counterparty details — the reference is the capability.
 */
function statusPayload(row) {
  return {
    reference: row.reference,
    status: row.status,
    amount: row.amount,
    rail: row.rail,
    // Sent so a customer whose booking amount was retargeted mid-checkout can
    // re-render the QR with the new amount instead of paying the stale figure.
    intent_uri: row.intent_uri || '',
    paid: row.status === 'paid',
  };
}

const TERMINAL_PAYMENT = new Set(['paid', 'failed', 'cancelled']);

router.get('/status/:reference', (req, res) => {
  try {
    const reference = str(req.params.reference, 60);
    const row = dbHelpers.getPayments().find(p => p.reference === reference);
    if (!row) return res.status(404).json({ error: 'Unknown payment reference' });
    res.json(statusPayload(row));
  } catch (error) {
    res.status(500).json({ error: 'Failed to read payment status', details: error.message });
  }
});

/**
 * Live status stream (Server-Sent Events) for a checkout payment. Same trust
 * model as the poll above — the reference is the capability — but pushes the
 * new state the moment the gateway callback or a staff mark-paid settles the
 * row, so the checkout screen can advance without waiting for a poll tick.
 *
 * The stream is self-terminating: it closes on a terminal status, on a hard
 * lifetime cap, and when the client disconnects. A heartbeat comment keeps
 * proxies from buffering or dropping the idle connection.
 */
router.get('/status/stream/:reference', (req, res) => {
  const reference = str(req.params.reference, 60);
  const row = dbHelpers.getPayments().find(p => p.reference === reference);
  if (!row) return res.status(404).json({ error: 'Unknown payment reference' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const send = (payload) => {
    try {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch {
      /* client went away; close() below tears down */
    }
  };

  let closed = false;
  let unsubscribe = () => {};
  let heartbeat = null;
  let lifetime = null;
  function close() {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    if (lifetime) clearTimeout(lifetime);
    unsubscribe();
    try {
      res.end();
    } catch {
      /* already ended */
    }
  }

  // Snapshot immediately so the client can render before the first change.
  send(statusPayload(row));
  // Nothing to stream if it is already settled — hand over and close.
  if (TERMINAL_PAYMENT.has(row.status)) {
    return close();
  }

  unsubscribe = subscribePayment(reference, (updated) => {
    send(statusPayload(updated));
    if (TERMINAL_PAYMENT.has(updated.status)) close();
  });

  // Keep proxies from buffering/dropping the idle connection, and cap the
  // stream's lifetime so an abandoned tab cannot hold a listener forever.
  heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      /* ignore — close handler cleans up */
    }
  }, 15000);
  lifetime = setTimeout(() => close(), 30 * 60 * 1000);

  req.on('close', close);
  return undefined;
});

// --------------------------------------------------------------------- pay --

router.post('/pay', throttle, async (req, res) => {
  const b = req.body || {};

  const contactName = str(b.contactName, 100);
  const email = str(b.email, 100);
  const phone = str(b.phone, 20);
  if (!contactName || !phone) {
    return res.status(400).json({ error: 'Name and phone are required' });
  }

  // Server-side truth on what this charge is.
  //
  // Checkout is the FIRST touch of money in the marketing funnel, and that
  // first touch is always the booking amount. The remainder of the campaign
  // total is collected later, against the lead, as the work progresses
  // (`POST /api/admin/payments/collect/for`). So a `full` choice is not a
  // cheaper path or a faster one — it is not a path at all: we ignore it and
  // charge the booking amount. A booking-only flow also means the balance is
  // never claimed before any work is done.
  const paymentChoice = 'booking';

  // The browser's invoice is display-only. We price the cart ourselves from the
  // synced records, so a tampered `invoice.total` cannot become a charge.
  let priced;
  try {
    priced = priceCart({
      locations: b.selectedLocations,
      selections: b.selections,
      durationMonths: b.duration_months,
    });
  } catch (e) {
    if (e && e.status) return res.status(e.status).json({ error: e.error });
    throw e;
  }

  // Keep the customer's own breakdown for the record, but overwrite the money
  // fields with what we actually computed.
  const invoice = { ...cleanInvoice(b.invoice, priced.total), ...priced };
  const quotedTotal = priced.total;
  // Always the booking amount — see the paymentChoice note above. The quoted
  // total is still computed and stored above, purely as the balance the
  // Accounts team will request later.
  const amountDue = bookingAmount();
  if (!Number.isFinite(amountDue) || amountDue <= 0) {
    // Only reachable when the booking amount is zero or negative in Settings —
    // an admin misconfiguration. It has nothing to do with whether the sheet
    // has prices, so the message must not blame the customer's campaign.
    return res.status(400).json({ error: 'Payments are temporarily unavailable. Please contact us.' });
  }

  // The lead is recorded whether or not the gateway is reachable — a customer
  // who reached the payment screen is a lead even if the QR fails to build.
  const lead = dbHelpers.addLead({
    businessName: str(b.businessName, 100),
    contactName,
    email,
    phone,
    category: str(b.category, 100),
    locations: str(b.locations, 20),
    radius: str(b.radius, 20),
    pincode: str(b.pincode, 100),
    zone: str(b.zone, 50),
    duration: str(b.duration, 50),
    startDate: str(b.startDate, 30),
    message: str(b.message, 1000),
    budget: str(b.budget, 50),
    selectedLocations: cleanLocations(b.selectedLocations),
    invoice,
    paymentMethod: str(b.paymentMethod, 30) || 'upi',
    paymentChoice,
    amountPaid: amountDue,
    amountQuoted: quotedTotal,
    bookingAmount: bookingAmount(),
    // Which selected locations had no sheet row, so the recee team can price
    // them and bill the balance rather than the gap disappearing silently.
    unpricedLocations: priced.unpriced || [],
    status: 'new',
    source: 'checkout',
    submittedAt: new Date().toISOString(),
  });

  let payment = null;
  let intentUri = null;
  let payu = null;
  let paymentError = null;

  try {
    const built = await createCollectRequest({
      amount: amountDue,
      note: paymentChoice === 'booking' ? 'Campaign booking amount' : 'Campaign full payment',
      customerName: contactName,
      customerPhone: phone,
      customerEmail: email,
      trackWithPayu: true,
      // The admin tab's wording ("set your collection VPA…") means nothing to
      // a customer mid-checkout, so the public rail gets its own message.
      noVpaError: { status: 503, message: 'Payments are not switched on yet. Please contact us.' },
      callbackBase: process.env.PAYU_CALLBACK_BASE
        ? String(process.env.PAYU_CALLBACK_BASE).replace(/\/+$/, '')
        : `${req.protocol}://${req.headers.host || ''}`,
      createdByName: 'Checkout',
      // Attribute the booking payment to the lead it just created. Without this
      // the "money on this lead" rollup starts empty and every later balance
      // request would look like the first payment ever received.
      links: { lead_id: lead.id },
    });
    if (built.error) {
      paymentError = built.error;
    } else {
      payment = built.payment;
      intentUri = built.intent_uri;
      payu = built.payu;
    }
  } catch (error) {
    paymentError = error.message;
  }

  // Link the two so the BDM sees payment state on the lead itself, and attach
  // the lead to its customer account so the CRM timeline has a single spine.
  if (payment) {
    dbHelpers.updateLead(lead.id, {
      payment_id: payment.id,
      payment_reference: payment.reference,
      payment_status: payment.status,
    });
  }
  const company = dbHelpers.linkLeadToCompany(lead.id);

  res.json({
    success: true,
    lead_id: lead.id,
    company_id: company?.id || null,
    amount: amountDue,
    // The campaign total and what is still outstanding after this booking.
    // The client shows this as "balance due later" — it is not collectable now.
    quoted_total: quotedTotal,
    balance_due: Math.max(0, Math.round((quotedTotal - amountDue) * 100) / 100),
    reference: payment?.reference || null,
    intent_uri: intentUri,
    payu,
    payment_error: paymentError,
  });
});

export default router;
