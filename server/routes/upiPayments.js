// Admin UPI money movements — the API behind the Payments tab.
//
//   GET  /config                     masked rail status + collection VPA
//   PUT  /config                     save collection VPA / PayU credentials
//   POST /decode                     authoritative parse of a scanned payload
//   POST /validate-vpa               format check (+ PayU existence check if configured)
//   POST /collect                    build a receive request (amount already fixed)
//   POST /send                       build + dispatch an outbound payment
//   GET  /ledger                     list movements
//   PUT  /ledger/:id                 update status / notes
//   POST /ledger/:id/reconcile       ask PayU what actually happened
//   GET  /summary                    totals
//
// Two rails, one page. Every route works with zero PayU credentials by
// composing a UPI intent locally; the gateway rails are an upgrade, never a
// prerequisite. Nothing here claims money moved unless something confirmed it.

import express from 'express';
import { dbHelpers } from '../db.js';
import { requirePayoutRole } from '../middleware/staffAuth.js';
import {
  buildUpiUri, formatAmount, parseUpiPayload, validateVpaFormat, MCC,
} from '../services/upi.js';
import {
  createDynamicQr, describeConfig, generateIntentLink, isPayoutsConfigured,
  isPayoutSuccess, payoutStatus, payoutTransfer, reverseHash, validateVpa, verifyPayment,
} from '../services/payu.js';

const router = express.Router();

const MAX_AMOUNT = 10000000;
const MIN_NOTE = 3;

// Money-moving gate. Deliberately narrower than `requireManager`, which only
// compares role *level* >= manager (1) and therefore also admits bd_executive,
// ops_executive and recee_manager. The Payments tab is hidden from those roles
// in the UI, so reusing it here would leave the actions reachable via curl.
// This list mirrors the `payments` entry in AdminPanel's allowedTabs.
function upiSettings() {
  return dbHelpers.getSettings()?.upi || {};
}

/**
 * Absolute base URL PayU should call back on. Prefers an explicit env value
 * (needed behind a tunnel/reverse proxy), otherwise reconstructs it from the
 * inbound request. Dynamic QR rejects requests without surl/furl (EX158).
 */
function callbackBase(req) {
  const configured = String(process.env.PAYU_CALLBACK_BASE || '').trim();
  if (configured) return configured.replace(/\/+$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return host ? `${proto}://${host}` : '';
}

function fail(res, status, message) {
  return res.status(status).json({ error: message });
}

/** PayU transaction ids must be <40 chars, alphanumeric + `_`, unique once used. */
function makeRef(direction) {
  const d = new Date();
  const stamp = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const rand = Math.random().toString(36).slice(2, 8);
  return `btl_${direction}_${stamp}_${rand}`;
}

function validateAmount(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return { ok: false, reason: 'Enter an amount greater than zero' };
  if (n > MAX_AMOUNT) return { ok: false, reason: `Amount cannot exceed ${MAX_AMOUNT}` };
  const fixed = Number(formatAmount(n));
  // Money must be exact. Sub-paisa input is rejected instead of rounded,
  // otherwise the QR we hand the payee quietly asks for a different sum.
  if (fixed !== n) return { ok: false, reason: 'Amount is limited to 2 decimal places' };
  return { ok: true, amount: fixed };
}

// --- PayU Dynamic QR circuit breaker ---------------------------------------
// When the merchant account isn't set up for UPI QR (the usual cause is the
// DBQR flag not being enabled), PayU answers every request with "Merchant
// Integration Exception". Left alone, every customer checkout would pay that
// round-trip's latency and hammer PayU with requests that cannot succeed. Three
// consecutive failures open the circuit for a cooling-off window; a success
// closes it again. The locally-built UPI rail is unaffected either way, so a
// broken PayU account never stops the business taking money.
const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 15 * 60 * 1000;
let qrFailStreak = 0;
let qrBlockedUntil = 0;

function qrRailAvailable() {
  return Date.now() >= qrBlockedUntil;
}

function noteQrSuccess() {
  qrFailStreak = 0;
  qrBlockedUntil = 0;
}

function noteQrFailure() {
  qrFailStreak += 1;
  if (qrFailStreak >= BREAKER_THRESHOLD) qrBlockedUntil = Date.now() + BREAKER_COOLDOWN_MS;
}

// ------------------------------------------------------------------ config --

router.get('/config', requirePayoutRole, (req, res) => {
  try {
    res.json({
      upi: upiSettings(),
      rails: describeConfig(),
      // What the tab should default to when collecting.
      receive_ready: Boolean(upiSettings().collection_vpa),
      send_rail: isPayoutsConfigured() ? 'payouts' : 'approval',
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load payment config', details: error.message });
  }
});

router.put('/config', requirePayoutRole, (req, res) => {
  try {
    const body = req.body || {};
    const current = dbHelpers.getSettings() || {};

    const nextUpi = { ...(current.upi || {}) };
    if (body.collection_vpa !== undefined) {
      const check = validateVpaFormat(body.collection_vpa);
      if (body.collection_vpa && !check.valid) {
        return fail(res, 400, `Collection VPA is invalid — ${check.reason}`);
      }
      nextUpi.collection_vpa = check.vpa || '';
    }
    if (body.collection_name !== undefined) nextUpi.collection_name = String(body.collection_name || '').slice(0, 50);
    if (body.collection_mcc !== undefined) {
      const mcc = String(body.collection_mcc || '').trim();
      if (mcc && !/^\d{4}$/.test(mcc)) return fail(res, 400, 'Merchant category code must be 4 digits');
      nextUpi.collection_mcc = mcc || MCC.GENERIC;
    }

    // Secrets are write-only. An empty string means "leave as is" so the
    // browser never has to hold a live secret to avoid wiping it.
    const nextPayu = { ...(current.payu || {}) };
    if (body.test_mode !== undefined) nextPayu.test_mode = !!body.test_mode;
    for (const field of ['key', 'salt', 'payout_merchant_id', 'payout_client_id', 'payout_client_secret', 'payout_token_url']) {
      if (body[field] !== undefined && String(body[field]).trim()) {
        nextPayu[field] = String(body[field]).trim();
      }
    }

    const settings = dbHelpers.updateSettingsExtended({ upi: nextUpi, payu: nextPayu });

    res.json({
      success: true,
      // Deliberately hand-picked, never the raw settings object.
      upi: settings.upi,
      rails: describeConfig(),
      receive_ready: Boolean(settings.upi?.collection_vpa),
      send_rail: isPayoutsConfigured() ? 'payouts' : 'approval',
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save payment config', details: error.message });
  }
});

// ------------------------------------------------------------------ decode --

// The browser decodes the QR image, but the server re-parses what it decoded so
// a tampered or buggy client can never hand us a VPA we did not author.
router.post('/decode', requirePayoutRole, (req, res) => {
  try {
    const parsed = parseUpiPayload(req.body?.payload);
    if (!parsed.ok) return fail(res, 400, parsed.reason);
    res.json({ success: true, intent: parsed });
  } catch (error) {
    res.status(500).json({ error: 'Failed to read the UPI code', details: error.message });
  }
});

router.post('/validate-vpa', requirePayoutRole, async (req, res) => {
  try {
    const check = validateVpaFormat(req.body?.vpa);
    if (!check.valid) {
      return res.json({ success: true, valid: false, reason: check.reason, vpa: check.vpa });
    }

    // Format is proven locally; existence needs the issuer bank. Ask PayU only
    // when it is actually configured — otherwise say so instead of guessing.
    const rails = describeConfig();
    if (!rails.payments.configured) {
      return res.json({
        success: true,
        valid: true,
        vpa: check.vpa,
        format_only: true,
        payer_name: '',
        reason: 'Format is valid. Add PayU credentials to verify this handle actually exists.',
      });
    }

    const result = await validateVpa(check.vpa);
    if (!result.ok) {
      return res.json({
        success: true, valid: true, vpa: check.vpa, format_only: true,
        payer_name: '', reason: `Format is valid, but PayU could not confirm the handle — ${result.reason}`,
      });
    }
    res.json({
      success: true,
      valid: result.data.is_valid,
      vpa: result.data.vpa,
      autopay_valid: result.data.autopay_valid,
      payer_name: result.data.payer_name,
      format_only: false,
      reason: result.data.is_valid ? '' : 'No bank is issuing this UPI handle.',
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to validate the VPA', details: error.message });
  }
});

// ----------------------------------------------------------------- collect --

/**
 * Build a receive request for a fixed amount and record it in the ledger.
 *
 * Shared by the admin Payments tab and the public checkout so there is exactly
 * one definition of "a collection request" — if the QR shape, the reference
 * format or the PayU upgrade path ever changes, both callers change together.
 *
 * Returns `{ error, status, code }` on failure instead of writing a response, so
 * the caller decides the HTTP shape and the wording — the admin tab and the
 * public checkout want different messages for the same condition.
 */
export async function createCollectRequest({
  amount: rawAmount,
  note,
  customerName,
  customerPhone,
  customerEmail,
  trackWithPayu = true,
  callbackBase: base,
  createdBy = null,
  createdByName = '',
  // Attribution: which lead / shop order / vendor this money belongs to. Kept
  // as explicit links so "money spent vs received on this lead" is a query,
  // not a guess from the counterparty name.
  links = {},
  noVpaError = {
    status: 400,
    message: 'Set your collection VPA in the UPI setup card before generating a request.',
  },
} = {}) {
  const upi = upiSettings();
  if (!upi.collection_vpa) {
    return { error: noVpaError.message, status: noVpaError.status, code: 'no_collection_vpa' };
  }

  const amount = validateAmount(rawAmount);
  if (!amount.ok) return { error: amount.reason, status: 400 };

  const cleanNote = String(note || '').trim().slice(0, 100);
  const name = String(customerName || '').trim().slice(0, 50);
  const phone = String(customerPhone || '').replace(/\D/g, '').slice(0, 10);
  const email = String(customerEmail || '').trim().slice(0, 50);

  const reference = makeRef('in');
  const intentUri = buildUpiUri({
    vpa: upi.collection_vpa,
    payeeName: upi.collection_name || '',
    amount: amount.amount,
    note: cleanNote || `Payment to ${upi.collection_name || 'BTLbro'}`,
    txnRef: reference,
    mcc: upi.collection_mcc || MCC.GENERIC,
  });

  const row = dbHelpers.addPayment({
    direction: 'in',
    status: 'awaiting',
    amount: amount.amount,
    currency: 'INR',
    vpa: upi.collection_vpa,
    counterparty_name: name,
    counterparty_phone: phone,
    counterparty_email: email,
    note: cleanNote,
    reference,
    intent_uri: intentUri,
    rail: 'local',
    mcc: upi.collection_mcc || MCC.GENERIC,
    created_by: createdBy,
    created_by_name: createdByName,
    lead_id: links.lead_id ?? null,
    order_id: links.order_id ?? null,
    vendor_id: links.vendor_id ?? null,
    // Shop orders intentionally never get a company: a product purchase is not
    // a customer relationship, so it must not appear in Companies or receivables.
    company_id: links.company_id ?? null,
  });

  // Optional: let PayU track this so the status can be reconciled later.
  let payu = null;
  if (trackWithPayu && describeConfig().payments.configured) {
    if (!qrRailAvailable()) {
      payu = {
        error: 'PayU QR is temporarily paused after repeated failures. The UPI request below is still fully valid — share it as normal.',
        paused: true,
      };
    } else {
      const qr = await createDynamicQr({
        txnid: reference,
        amount: amount.amount,
        note: cleanNote || 'Payment',
        payeeName: upi.collection_name || 'BTLbro',
        email,
        phone,
        callbackBase: base || '',
      });
      if (qr.ok) {
        noteQrSuccess();
        payu = { ...qr.data, qr_string: '' };
        const link = await generateIntentLink({
          txnId: reference,
          amount: amount.amount,
          note: cleanNote || 'Payment',
          merchantVpa: qr.data.merchant_vpa,
        });
        if (link.ok) payu.link = link.data.link;
        dbHelpers.updatePayment(row.id, {
          rail: 'payu',
          payu_txnid: qr.data.payu_txnid,
          payu_payment_id: qr.data.payment_id,
          payu_qr_string: qr.data.qr_string,
          payu_link: payu.link || '',
          payu_merchant_vpa: qr.data.merchant_vpa,
        });
      } else {
        noteQrFailure();
        payu = { error: qr.reason };
      }
    }
  }

  return {
    payment: dbHelpers.getPayments().find(p => p.id === row.id),
    intent_uri: intentUri,
    payu,
  };
}

// Collect against a specific lead or shop order, so the money is attributable
// the moment it is requested. The Leads and Orders tabs call this instead of
// the generic /collect, which has no idea what it is collecting for.
//
//   POST /collect/for  { kind: 'lead' | 'order', id, amount, note? }
router.post('/collect/for', requirePayoutRole, async (req, res) => {
  try {
    const kind = req.body?.kind === 'order' ? 'order' : 'lead';
    const id = Number(req.body?.id);
    if (!Number.isFinite(id) || id <= 0) {
      return fail(res, 400, 'Which lead or order is this for?');
    }

    let customer = { name: '', phone: '', email: '' };
    if (kind === 'lead') {
      const lead = dbHelpers.getLeadById(id);
      if (!lead) return fail(res, 404, 'No such lead');
      customer = {
        name: lead.contact_name || lead.business_name || '',
        phone: lead.phone || '',
        email: lead.email || '',
      };
    } else {
      const order = (dbHelpers.getShopOrders() || []).find((o) => o.id === id);
      if (!order) return fail(res, 404, 'No such order');
      customer = {
        name: order.user?.name || '',
        phone: order.address?.phone || order.phone || '',
        email: order.user?.email || order.email || '',
      };
    }

    const result = await createCollectRequest({
      amount: req.body?.amount,
      note: req.body?.note,
      customerName: customer.name,
      customerPhone: customer.phone,
      customerEmail: customer.email,
      trackWithPayu: req.body?.track_with_payu !== false,
      callbackBase: callbackBase(req),
      createdBy: req.staff?.id || null,
      createdByName: req.staff?.name || '',
      links: kind === 'lead' ? { lead_id: id } : { order_id: id },
    });
    if (result.error) return fail(res, result.status || 400, result.error);

    // Reflect the request on the parent record so the pipeline shows that
    // money is outstanding rather than "no payment info".
    if (kind === 'order') {
      const order = (dbHelpers.getShopOrders() || []).find((o) => o.id === id);
      if (order) {
        dbHelpers.updateShopOrder(id, {
          payment_status: 'pending',
          gateway: result.payment?.rail || 'local',
          gateway_payment_id: result.payment?.reference || '',
        });
      }
    } else {
      const lead = dbHelpers.getLeadById(id);
      if (lead) {
        dbHelpers.updateLead(id, {
          payment_status: 'pending',
          payment_reference: result.payment?.reference || '',
        });
      }
    }

    res.json({ success: true, kind, id, ...result });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create the collection request', details: error.message });
  }
});

// Money in vs money out for one lead or one order. This is the rollup the
// pipeline shows so a team can see what a lead has actually cost us.
router.get('/for/:kind/:id', requirePayoutRole, (req, res) => {
  try {
    const kind = req.params.kind === 'order' ? 'order' : 'lead';
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return fail(res, 400, 'Bad id');

    const rows = kind === 'lead' ? dbHelpers.getPaymentsForLead(id) : dbHelpers.getPaymentsForOrder(id);
    const sum = (list) => Math.round(list.reduce((s, p) => s + (Number(p.amount) || 0), 0) * 100) / 100;
    const paid = rows.filter((p) => p.status === 'paid');
    const incoming = rows.filter((p) => p.direction !== 'out');
    const outgoing = rows.filter((p) => p.direction === 'out');

    res.json({
      kind,
      id,
      count: rows.length,
      received: sum(paid.filter((p) => p.direction !== 'out')),
      spent: sum(paid.filter((p) => p.direction === 'out')),
      pending_in: sum(incoming.filter((p) => p.status !== 'paid')),
      pending_out: sum(outgoing.filter((p) => p.status !== 'paid')),
      // Net is signed: positive means we are in the black on this record.
      net: Math.round((sum(paid.filter((p) => p.direction !== 'out')) - sum(paid.filter((p) => p.direction === 'out'))) * 100) / 100,
      payments: rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)),
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load the rollup', details: error.message });
  }
});

router.post('/collect', requirePayoutRole, async (req, res) => {
  try {
    const result = await createCollectRequest({
      amount: req.body?.amount,
      note: req.body?.note,
      customerName: req.body?.customer_name,
      customerPhone: req.body?.customer_phone,
      customerEmail: req.body?.customer_email,
      trackWithPayu: req.body?.track_with_payu !== false,
      callbackBase: callbackBase(req),
      createdBy: req.staff?.id || null,
      createdByName: req.staff?.name || '',
    });
    if (result.error) return fail(res, result.status || 400, result.error);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create the collection request', details: error.message });
  }
});

// -------------------------------------------------------------------- send --

router.post('/send', requirePayoutRole, async (req, res) => {
  try {
    const upi = upiSettings();
    const check = validateVpaFormat(req.body?.vpa);
    if (!check.valid) return fail(res, 400, `Payee UPI ID is invalid — ${check.reason}`);

    const amount = validateAmount(req.body?.amount);
    if (!amount.ok) return fail(res, 400, amount.reason);

    const payeeName = String(req.body?.payee_name || '').trim().slice(0, 50);

    // The description is optional in the form, but a payment carrying no note
    // at all cannot be traced later — which is the whole reason MIN_NOTE
    // exists. A blank one therefore falls back to a generated line instead of
    // being stored empty. A *short* (non-blank) note is still rejected, so
    // nothing MIN_NOTE already covered gets weaker.
    const typed = String(req.body?.note || '').trim();
    const note = typed || `Payment to ${payeeName || check.vpa}`;
    if (note.length < MIN_NOTE) {
      return fail(res, 400, `Add a short note (at least ${MIN_NOTE} characters) so this payment can be traced later.`);
    }

    const mode = req.body?.mode === 'auto' ? 'auto' : 'approval';

    const reference = makeRef('out');
    const intentUri = buildUpiUri({
      vpa: check.vpa,
      payeeName,
      amount: amount.amount,
      note: note.slice(0, 100),
      txnRef: reference,
    });

    const row = dbHelpers.addPayment({
      direction: 'out',
      status: 'awaiting',
      amount: amount.amount,
      currency: 'INR',
      vpa: check.vpa,
      counterparty_name: payeeName,
      counterparty_phone: String(req.body?.payee_phone || '').replace(/\D/g, '').slice(0, 10),
      counterparty_email: String(req.body?.payee_email || '').trim().slice(0, 50),
      note: note.slice(0, 100),
      reference,
      intent_uri: intentUri,
      rail: mode === 'auto' ? 'payouts' : 'approval',
      created_by: req.staff?.id || null,
      created_by_name: req.staff?.name || '',
    });

    // Approval rail: the intent is handed back and the admin approves it in
    // their own UPI app, then flips the row to paid. No gateway involved.
    if (mode !== 'auto') {
      return res.json({
        success: true,
        payment: row,
        intent_uri: intentUri,
        dispatch: { ok: false, pending_user_approval: true },
      });
    }

    if (!isPayoutsConfigured()) {
      dbHelpers.updatePayment(row.id, { status: 'awaiting', rail: 'approval' });
      return res.json({
        success: true,
        payment: dbHelpers.getPayments().find(p => p.id === row.id),
        intent_uri: intentUri,
        dispatch: {
          ok: false,
          pending_user_approval: true,
          reason: 'PayU Payouts is not configured, so this was queued for you to approve in your UPI app instead.',
        },
      });
    }

    const sent = await payoutTransfer({
      merchantRefId: reference,
      vpa: check.vpa,
      name: payeeName,
      email: row.counterparty_email,
      phone: row.counterparty_phone,
      amount: amount.amount,
      purpose: note.slice(0, 100),
    });

    if (!sent.ok) {
      dbHelpers.updatePayment(row.id, { status: 'failed', failure_reason: sent.reason });
      return res.json({
        success: false,
        payment: dbHelpers.getPayments().find(p => p.id === row.id),
        dispatch: { ok: false, reason: sent.reason },
      });
    }

    // Payouts is async — poll `txnStatus` for the real outcome.
    const settled = await payoutStatus(reference);
    let status = 'processing';
    if (settled.ok && isPayoutSuccess(settled.data.txn_status)) status = 'paid';
    else if (settled.ok && /fail|reject/i.test(settled.data.txn_status || '')) status = 'failed';

    const updated = dbHelpers.updatePayment(row.id, {
      status,
      payu_payout_ref: reference,
      payu_status: settled.ok ? settled.data.txn_status : '',
      bank_ref: settled.ok ? settled.data.bank_ref : '',
      failure_reason: status === 'failed' ? (settled.data?.status_description || 'Payout rejected') : '',
    });

    res.json({
      success: status !== 'failed',
      payment: updated,
      intent_uri: intentUri,
      dispatch: { ok: true, status, detail: settled.ok ? settled.data : null },
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to send the payment', details: error.message });
  }
});

// ------------------------------------------------------------------ ledger --

router.get('/ledger', requirePayoutRole, (req, res) => {
  try {
    const { direction, status, limit } = req.query || {};
    let rows = dbHelpers.getPayments();
    if (direction && direction !== 'all') rows = rows.filter(p => p.direction === direction);
    if (status && status !== 'all') rows = rows.filter(p => p.status === status);
    rows = [...rows].sort((a, b) => (b.id || 0) - (a.id || 0));
    const cap = Math.min(Number(limit) || 200, 500);
    res.json({ payments: rows.slice(0, cap), total: rows.length });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load the ledger', details: error.message });
  }
});

const ALLOWED_STATUS = ['awaiting', 'processing', 'paid', 'failed', 'cancelled'];

router.put('/ledger/:id', requirePayoutRole, (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = dbHelpers.getPayments().find(p => p.id === id);
    if (!existing) return fail(res, 404, 'Payment not found');

    const updates = {};
    const { status, note } = req.body || {};
    if (status !== undefined) {
      if (!ALLOWED_STATUS.includes(status)) return fail(res, 400, `Unknown status “${status}”`);
      updates.status = status;
      if (status === 'paid') updates.paid_at = new Date().toISOString();
      if (status === 'failed' || status === 'cancelled') {
        updates.failure_reason = String(req.body?.reason || '').slice(0, 200);
      }
    }
    if (note !== undefined) updates.note = String(note).slice(0, 100);
    if (req.body?.reconciled !== undefined) updates.reconciled = !!req.body.reconciled;

    // Attach (or detach) the movement to a customer account. Linking is always
    // explicit from the Accounts tab — never inferred from the counterparty
    // name, because guessing here would silently mis-file real money.
    if (req.body?.company_id !== undefined) {
      const raw = req.body.company_id;
      if (raw === null || raw === '') {
        updates.company_id = null;
      } else {
        const company = dbHelpers.getCompanyById(Number(raw));
        if (!company) return fail(res, 400, 'No such company');
        updates.company_id = company.id;
      }
    }

    res.json({ success: true, payment: dbHelpers.updatePayment(id, updates) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update the payment', details: error.message });
  }
});

router.post('/ledger/:id/reconcile', requirePayoutRole, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const row = dbHelpers.getPayments().find(p => p.id === id);
    if (!row) return fail(res, 404, 'Payment not found');
    if (!row.payu_txnid) {
      return fail(res, 400, 'This request was never registered with PayU, so there is nothing to reconcile.');
    }
    if (!describeConfig().payments.configured) {
      return fail(res, 400, 'Add PayU credentials to reconcile payments.');
    }

    const result = await verifyPayment(row.payu_txnid);
    if (!result.ok) return fail(res, 502, result.reason);

    const s = result.data.status;
    let status = row.status;
    if (s === 'captured' || s === 'success') status = 'paid';
    else if (s === 'failed' || s === 'failure' || s === 'cancelled') status = 'failed';
    else if (s === 'pending') status = 'processing';

    const updated = dbHelpers.updatePayment(id, {
      status,
      reconciled: true,
      payu_status: s,
      payu_mihpayid: result.data.mihpayid,
      bank_ref: result.data.bank_ref || row.bank_ref || '',
      failure_reason: result.data.error_message || (status === 'failed' ? result.data.error : ''),
      paid_at: status === 'paid' ? (row.paid_at || new Date().toISOString()) : row.paid_at,
    });

    res.json({ success: true, payment: updated, gateway: result.data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to reconcile the payment', details: error.message });
  }
});

router.get('/summary', requirePayoutRole, (req, res) => {
  try {
    const rows = dbHelpers.getPayments();
    const sum = (list) => list.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
    const byStatus = {};
    for (const s of ALLOWED_STATUS) byStatus[s] = 0;
    for (const p of rows) byStatus[p.status] = (byStatus[p.status] || 0) + 1;

    res.json({
      count: rows.length,
      in_total: sum(rows.filter(p => p.direction === 'in')),
      out_total: sum(rows.filter(p => p.direction === 'out')),
      in_paid: sum(rows.filter(p => p.direction === 'in' && p.status === 'paid')),
      out_paid: sum(rows.filter(p => p.direction === 'out' && p.status === 'paid')),
      in_pending: sum(rows.filter(p => p.direction === 'in' && (p.status === 'awaiting' || p.status === 'processing'))),
      out_pending: sum(rows.filter(p => p.direction === 'out' && (p.status === 'awaiting' || p.status === 'processing'))),
      // Failed money is in `*_total` but in neither paid nor pending. Without
      // these the totals silently don't add up, which is the worst way to
      // report a payment that did not go through.
      in_failed: sum(rows.filter(p => p.direction === 'in' && p.status === 'failed')),
      out_failed: sum(rows.filter(p => p.direction === 'out' && p.status === 'failed')),
      by_status: byStatus,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to summarise payments', details: error.message });
  }
});

// ----------------------------------------------------------------- callback --

// PayU hits this server-to-server (surl/furl) when a QR payment settles. It is
// intentionally PUBLIC — PayU cannot present a staff session — so every write
// is gated on a reverse-hash check against our own salt, and the txnid must
// match a row we actually created. An unsigned or mismatched callback is
// ignored rather than trusted.
const callbackRouter = express.Router();

/** PayU may send urlencoded, JSON, or base64-encoded JSON. Normalise all three. */
function readCallbackBody(req) {
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  const fromQuery = { ...(req.query || {}) };
  let fromBody = {};
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    fromBody = { ...req.body };
  } else if (typeof raw === 'string' && raw.trim()) {
    const text = raw.trim();
    try {
      fromBody = JSON.parse(text);
    } catch {
      try {
        fromBody = JSON.parse(Buffer.from(text, 'base64').toString('utf8'));
      } catch {
        fromBody = Object.fromEntries(new URLSearchParams(text));
      }
    }
  }
  // Some callbacks nest the payload one level down.
  const inner = fromBody && typeof fromBody === 'object' ? (fromBody.data || fromBody.result || fromBody) : {};
  return { ...fromQuery, ...fromBody, ...(inner && typeof inner === 'object' ? inner : {}) };
}

function callbackReply(res, { title, message, tone }) {
  const bg = tone === 'ok' ? '#F0FDF4' : tone === 'bad' ? '#FEF2F2' : '#FAF9F7';
  const fg = tone === 'ok' ? '#047857' : tone === 'bad' ? '#B42318' : '#4A4A4A';
  res.status(200).type('html').send(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<title>${title}</title></head><body style="margin:0;min-height:100vh;display:grid;place-items:center;`
    + `font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:${bg};color:#161616">`
    + `<div style="text-align:center;padding:32px;max-width:420px">`
    + `<div style="font-size:40px;line-height:1">${tone === 'ok' ? '&#10003;' : tone === 'bad' ? '&#10007;' : '&#8987;'}</div>`
    + `<h1 style="font-size:19px;margin:14px 0 8px">${title}</h1>`
    + `<p style="color:${fg};font-size:14px;margin:0">${message}</p>`
    + `</div></body></html>`,
  );
}

// Mounted at /api/payments/callback (see index.js), so the route is '/'.
callbackRouter.all('/', async (req, res) => {
  try {
    const body = readCallbackBody(req);
    const txnid = String(body.txnid || body.txn_id || body.txnId || '').trim();
    if (!txnid) return callbackReply(res, { title: 'Nothing to confirm', message: 'No transaction id in this notification.', tone: 'neutral' });

    const row = dbHelpers.getPayments().find(p => p.reference === txnid || p.payu_txnid === txnid);
    if (!row) return callbackReply(res, { title: 'Unknown transaction', message: 'We have no record of this payment.', tone: 'bad' });

    // Authenticate before trusting anything. A missing hash must be REFUSED,
    // never treated as trusted: otherwise anyone who guessed a txnid could mark
    // a payment received. When PayU is configured, only a correctly signed
    // callback may settle a row; anything else is left for a human to confirm.
    const cfg = describeConfig();
    if (!cfg.payments.configured) {
      return callbackReply(res, { title: 'Not configured', message: 'PayU is not configured, so this notification was ignored.', tone: 'neutral' });
    }
    const provided = String(body.hash || '').trim();
    if (!provided) {
      return callbackReply(res, { title: 'Could not verify', message: 'This notification was not signed, so it was ignored.', tone: 'bad' });
    }
    const expected = reverseHash({
      key: process.env.PAYU_MERCHANT_KEY || '',
      salt: process.env.PAYU_MERCHANT_SALT || '',
      status: body.status || '',
      txnid,
      // Must be byte-identical to what PayU signed: our rows hold amount as a
      // number (12), PayU signs the 2dp string ("12.00").
      amount: body.amount || formatAmount(row.amount),
      email: body.email || row.counterparty_email || '',
      firstname: body.firstname || row.counterparty_name || '',
      productinfo: 'UPI Collection',
    });
    if (expected.hash !== provided) {
      return callbackReply(res, { title: 'Could not verify', message: 'This notification failed its security check and was ignored.', tone: 'bad' });
    }

    const rawStatus = String(body.unmappedstatus || body.status || body.txn_status || '').toLowerCase();
    const paid = /success|paid|complete/.test(rawStatus);
    const failed = /fail|reject|cancel|error/.test(rawStatus);
    // Never downgrade a row that is already settled.
    if (row.status === 'paid' || (paid && !failed)) {
      if (row.status !== 'paid') {
        dbHelpers.updatePayment(row.id, {
          status: 'paid',
          bank_ref: String(body.bank_ref_no || body.bank_ref || ''),
          payu_status: rawStatus,
          paid_at: new Date().toISOString(),
        });
      }
    } else if (failed && row.status !== 'paid') {
      dbHelpers.updatePayment(row.id, { status: 'failed', failure_reason: 'Declined or failed at the bank', payu_status: rawStatus });
    }

    return callbackReply(res, paid
      ? { title: 'Payment received', message: 'Thank you — your payment has reached us.', tone: 'ok' }
      : failed
        ? { title: 'Payment failed', message: 'The payment did not go through. Any debited amount is reversed by your bank.', tone: 'bad' }
        : { title: 'Payment pending', message: 'We are still waiting for confirmation from your bank.', tone: 'neutral' });
  } catch (error) {
    return callbackReply(res, { title: 'Something went wrong', message: 'We could not process this notification.', tone: 'bad' });
  }
});

export { callbackRouter };
export default router;
