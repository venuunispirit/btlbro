import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { EventEmitter } from 'node:events';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, 'data');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const defaultData = {
  integration: {
    id: 1,
    drive_url: null,
    folder_id: null,
    access_token: null,
    refresh_token: null,
    token_expiry: null,
    is_connected: false,
    auto_sync_enabled: false,
    sync_frequency: '15',
    last_sync_at: null,
    last_sync_status: null,
    last_sync_message: null,
    files_found: 0,
    records_imported: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  files: [],
  records: [],
  sync_history: [],
  sync_errors: [],
  orders: [],
  payments: [],
  leads: [],
  companies: [],
  conversations: [],
  team_messages: [],
  departments: [],
  users: [],
  sessions: [],
  // Vendors we pay for work done on a lead or an order (apartments, printing,
  // photography...). Bills accrue per lead/order line; the vendor submits and
  // an admin settles them. Their payouts are ordinary `payments` rows with
  // `vendor_id` + `direction: 'out'` set, so vendor money shows up in the same
  // ledger as everything else.
  vendors: [],
  vendor_sessions: [],
  vendor_bills: [],
  // Purchase Orders: a commitment to a vendor for work not yet delivered and
  // not yet payable. A PO carries line items priced from the vendor's own
  // service catalogue (`vendor.services`), and vendor bills are raised against
  // an approved PO rather than out of thin air — that link is what stops the
  // same work being invoiced twice.
  purchase_orders: [],
  // Every payment success/failure is recorded here so the UI has something to
  // show. Delivery adapters (WhatsApp, email) read these rather than sending
  // inline, so adding a channel never touches payment code.
  notifications: [],
  carts: [],
  wishlists: [],
  google_seen: {},
  shop_orders: [],
  products: [],
  site_content: {},
  site_surveys: [],
  settings: {
    per_location_price: 0,
    agency_fee: 10,
    payment: {
      gateway_enabled: false,
      gateway_provider: 'razorpay',
      min_amount: 1,
      // Booking/advance amount charged at checkout. Read by QuickCheckout
      // (was hardcoded to 999) — the single source of truth for the token
      // price a new campaign lead pays to confirm.
      min_booking: 999,
      key_id: '',
      key_secret: '',
      currency: 'INR',
    },
    store: {
      min_order_amount: 0,
      shipping_flat: 0,
      gst_rate: 18,
    },
    telephony: {
      enabled: false,
      provider: 'twilio',
      sid: '',
      token: '',
      from_number: '',
    },
    whatsapp: {
      enabled: false,
      phone_number_id: '',
      access_token: '',
      verify_token: '',
      business_name: 'BTLbro',
    },
    // Where admin UPI money movements are collected into (Payments tab setup).
    upi: {
      collection_vpa: '',
      collection_name: 'BTLbro',
      collection_mcc: '5411',
    },
    // PayU credentials. `key`/`salt` unlock the collection rail; the
    // `payout_*` fields belong to the separate Payouts product and unlock
    // automatic outbound transfers. Never expose any of this to the browser.
    payu: {
      test_mode: true,
      key: '',
      salt: '',
      payout_merchant_id: '',
      payout_client_id: '',
      payout_client_secret: '',
      payout_token_url: '',
    },
  },
};

const file = path.join(dataDir, 'db.json');
const adapter = new JSONFile(file);
const db = new Low(adapter, defaultData);

// Read or initialize database
await db.read();
if (!db.data) {
  db.data = defaultData;
  await db.write();
}

// Migration: installs created before these keys existed stored a `payment`
// group without them, so the booking amount silently fell back to a hardcoded
// 999 even though Settings had a field for it. Backfill from defaultData so
// the value the admin sees is the value the server charges.
{
  const s = db.data.settings;
  if (s) {
    let changed = false;
    for (const [group, defaults] of Object.entries(defaultData.settings)) {
      if (typeof defaults !== 'object' || defaults === null) continue;
      const cur = s[group] && typeof s[group] === 'object' ? s[group] : {};
      for (const [key, value] of Object.entries(defaults)) {
        if (cur[key] === undefined) { cur[key] = value; changed = true; }
      }
      s[group] = cur;
    }
    if (changed) await db.write();
  }
}

// Helper functions that mimic SQL operations

// The delivery channel is registered at boot by services/notify.js. db.js
// cannot import it directly (notify.js already imports db.js), so this one-way
// hook keeps the dependency pointing the right way. Until something registers,
// events are stored and simply not delivered — the in-app feed still works.
// Payment states after which no further settlement is expected.
const TERMINAL = new Set(['paid', 'failed', 'cancelled']);

let notificationDispatcher = null;
export function setNotificationDispatcher(fn) {
  notificationDispatcher = typeof fn === 'function' ? fn : null;
}

// Publish/subscribe for payment-row changes, so an open checkout screen can
// watch a reference and advance the instant the row settles (PayU callback,
// staff mark-paid, retargeted amount). Keyed by `reference` — the same
// capability token the public status endpoints accept.
//
// Deliberately lives here rather than a service module: db.js has no relative
// imports, which is what lets the test harness copy it standalone into a temp
// directory. It is also only useful to a browser that is open right now, so a
// missed event costs one fallback poll, never correctness.
const paymentEventBus = new EventEmitter();
// One listener per open checkout tab; a generous cap keeps a burst of stale
// listeners from tripping Node's "possible memory leak" warning.
paymentEventBus.setMaxListeners(200);

function emitPaymentChange(row) {
  if (!row || !row.reference) return;
  paymentEventBus.emit('change', row);
}

/** Watch one reference. Returns an unsubscribe function callers must invoke. */
export function subscribePayment(reference, listener) {
  const key = String(reference || '');
  if (!key) return () => {};
  const handler = (row) => {
    if (row.reference === key) listener(row);
  };
  paymentEventBus.on('change', handler);
  return () => paymentEventBus.off('change', handler);
}

/** A collection request was raised. Distinct from a settlement. */
function queuePaymentRequestedNotification(payment) {
  try {
    const amount = Number(payment.amount || 0);
    const money = `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const who = payment.counterparty_name || 'the customer';
    const ref = payment.reference || '';
    dbHelpers.addNotification({
      audience: 'staff',
      type: 'payment_requested',
      tone: 'info',
      title: `Payment requested — ${money}`,
      body: `${money} requested from ${who}${ref ? ` (${ref})` : ''}.`,
      payment_id: payment.id,
      lead_id: payment.lead_id ?? null,
      order_id: payment.order_id ?? null,
      vendor_id: payment.vendor_id ?? null,
      amount,
      direction: payment.direction,
      reference: ref,
    });
  } catch (error) {
    console.error('[notify] failed to record request notification:', error.message);
  }
}

// A new lead or order is an event the team wants to know about too — a payment
// notification alone means the bell only rings when money moves, which is not
// when a team most needs to look. Same pattern as the payment hook, and written
// here rather than imported so db.js keeps no dependency on the notify service.
function queueRecordNotification(kind, record) {
  try {
    const isLead = kind === 'lead';
    const who = isLead
      ? (record.contactName || record.contact_name || record.businessName || 'Someone')
      : (record.user?.name || record.user?.email || 'A customer');
    const what = isLead
      ? (record.businessName && record.businessName !== who ? ` — ${record.businessName}` : '')
      : '';
    const money = Number(record.amountPaid ?? record.total ?? 0) || 0;
    dbHelpers.addNotification({
      audience: 'staff',
      type: isLead ? 'lead_created' : 'order_created',
      tone: 'info',
      title: isLead ? 'New lead' : 'New order',
      body: `${who}${what}${isLead ? '' : ''}${money ? ` · ₹${money.toLocaleString('en-IN')}` : ''}`,
      ...(isLead ? { lead_id: record.id } : { order_id: record.id }),
    });
  } catch (error) {
    // A notification must never be able to fail the write that caused it.
    console.error('[notify] failed to record record notification:', error.message);
  }
}

// Called from dbHelpers.updatePayment whenever a movement settles. Writes to the
// notification feed; delivery adapters (WhatsApp, email) dispatch from there so
// no payment route needs to know which channels exist.
//
// Kept here rather than in a service because updatePayment is the single choke
// point every settlement path already funnels through — PayU callback, manual
// "mark paid", reconciliation, vendor payout, lead collection, shop order.
function queuePaymentNotification(payment, previousStatus) {
  const paid = payment.status === 'paid';
  const amount = Number(payment.amount || 0);
  const money = `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const who = payment.counterparty_name || 'Counterparty';
  const ref = payment.reference || '';

  const reason = String(payment.failure_reason || '').trim();
  const incoming = payment.direction !== 'out';
  // "Received" for money in, "sent" for money out — an admin reading the feed
  // must never see a payout described as a receipt.
  const verb = incoming ? 'received' : 'sent';
  const verbCap = incoming ? 'Received' : 'Sent';

  // Audience: the vendor is notified about their own money, staff see
  // everything. A customer is only addressable when we captured a phone.
  const base = {
    payment_id: payment.id,
    lead_id: payment.lead_id ?? null,
    order_id: payment.order_id ?? null,
    vendor_id: payment.vendor_id ?? null,
    amount,
    direction: payment.direction,
    reference: ref,
    previous_status: previousStatus || null,
  };

  const record = {
    ...base,
    audience: 'staff',
    type: paid ? 'payment_success' : 'payment_failed',
    title: paid
      ? `Payment ${verbCap} — ${money}`
      : `Payment failed — ${money}`,
    body: paid
      ? `${money} ${verb} ${incoming ? 'from' : 'to'} ${who}${ref ? ` (${ref})` : ''}.`
      : `${money} ${incoming ? 'from' : 'to'} ${who} did not go through${reason ? `: ${reason}` : '.'}${ref ? ` (${ref})` : ''}`,
    tone: paid ? 'ok' : 'bad',
  };

  const notes = [record];

  if (payment.vendor_id) {
    notes.push({
      ...base,
      audience: 'vendor',
      vendor_id: payment.vendor_id,
      type: paid ? 'payout_sent' : 'payout_failed',
      title: paid ? `Payout sent — ${money}` : `Payout failed — ${money}`,
      body: paid
        ? `We sent you ${money}${ref ? ` (${ref})` : ''}.`
        : `Your payout of ${money} did not go through${reason ? `: ${reason}` : '.'}`,
      tone: paid ? 'ok' : 'bad',
    });
  }

  try {
    for (const n of notes) {
      const stored = dbHelpers.addNotification(n);
      if (notificationDispatcher) {
        try { notificationDispatcher(stored); } catch { /* delivery is best-effort */ }
      }
    }
    dbHelpers.pruneNotifications();
  } catch (error) {
    // A notification must never be able to fail a payment.
    console.error('[notify] failed to record payment notification:', error.message);
  }
}

export const dbHelpers = {
  // Get integration settings
  getIntegration() {
    return db.data.integration;
  },

  // Update integration settings
  updateIntegration(updates) {
    Object.assign(db.data.integration, updates, { updated_at: new Date().toISOString() });
    return db.write();
  },

  // Get all files
  getFiles() {
    return db.data.files || [];
  },

  // Add a file
  addFile(fileData) {
    const id = Math.max(0, ...db.data.files.map(f => f.id || 0)) + 1;
    const record = { ...fileData, id, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    db.data.files.push(record);
    return { id, ...record };
  },

  // Clear all files
  clearFiles() {
    db.data.files = [];
    db.data.records = [];
    return db.write();
  },

  // Get records for a file
  getFileRecords(fileId, page = 1, limit = 50, search = '') {
    let records = (db.data.records || []).filter(r => r.file_id === fileId);

    // Hide records deactivated by sheet sync unless explicitly requested
    const includeInactive = search === '__all__';
    if (includeInactive) {
      search = '';
    } else {
      records = records.filter(r => !(r.data && r.data.is_active === false));
    }

    if (search) {
      const q = search.toLowerCase();
      records = records.filter(r => {
        const dataStr = JSON.stringify(r.data || {}).toLowerCase();
        return dataStr.includes(q);
      });
    }

    const total = records.length;
    const start = (page - 1) * limit;
    const paginated = records.slice(start, start + limit);

    return {
      records: paginated,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  },

  // Add records for a file
  addRecords(fileId, records) {
    let rowIndex = 0;
    const existingCount = db.data.records.filter(r => r.file_id === fileId).length;
    for (const record of records) {
      db.data.records.push({
        id: db.data.records.length + 1,
        file_id: fileId,
        row_index: existingCount + rowIndex,
        data: record,
        created_at: new Date().toISOString(),
      });
      rowIndex++;
    }
    return db.write();
  },

  // Get a single file by id
  getFileById(id) {
    return db.data.files.find(f => f.id === id);
  },

  // Get total record count
  getRecordStats() {
    const files = db.data.files || [];
    const totalFiles = files.length;
    const totalRecords = files.reduce((sum, f) => sum + (f.records_count || 0), 0);
    return { totalFiles, totalRecords };
  },

  // ===== Google Sheet sync helpers =====

  // The file entry representing the connected Google Sheet (source of truth)
  getSheetFile() {
    return (db.data.files || []).find(f => f.mime_type === 'text/csv' && f.file_type === 'Google Sheet') || null;
  },

  // All records for a file that are currently active (present in the Sheet)
  getActiveRecordsForFile(fileId) {
    return (db.data.records || []).filter(r => r.file_id === fileId && r.data && r.data.is_active !== false);
  },

  // All records for a file that were deactivated by a previous sync
  getInactiveRecordsForFile(fileId) {
    return (db.data.records || []).filter(r => r.file_id === fileId && r.data && r.data.is_active === false);
  },

  // Push a record into memory WITHOUT writing (used inside a sync transaction)
  appendRecord(fileId, data, syncId) {
    const record = {
      id: db.data.records.length + 1,
      file_id: fileId,
      row_index: db.data.records.filter(r => r.file_id === fileId).length,
      data,
      created_at: new Date().toISOString(),
    };
    if (syncId) record.sync_batch_id = syncId;
    db.data.records.push(record);
    return record;
  },

  // Find-or-create the Sheet file entry and refresh its metadata
  ensureSheetFile(spreadsheetId, csvSize, recordsCount, syncId) {
    let file = dbHelpers.getSheetFile();
    const now = new Date().toISOString();
    if (!file) {
      const id = Math.max(0, ...(db.data.files || []).map(f => f.id || 0)) + 1;
      file = {
        id,
        file_id: spreadsheetId,
        file_name: `Google Sheet (${recordsCount} records)`,
        file_type: 'Google Sheet',
        mime_type: 'text/csv',
        file_size: csvSize,
        drive_url: db.data.integration.drive_url || null,
        last_modified: now,
        records_count: recordsCount,
        status: 'synced',
        sync_batch_id: syncId,
        created_at: now,
        updated_at: now,
      };
      db.data.files.push(file);
    } else {
      Object.assign(file, {
        file_id: spreadsheetId,
        file_size: csvSize,
        drive_url: db.data.integration.drive_url || file.drive_url,
        last_modified: now,
        records_count: db.data.records.filter(r => r.file_id === file.id && r.data && r.data.is_active !== false).length,
        status: 'synced',
        sync_batch_id: syncId,
        updated_at: now,
      });
    }
    return file.id;
  },

  // Add sync history entry
  addSyncHistory(entry) {
    const id = Math.max(0, ...(db.data.sync_history || []).map(h => h.id || 0)) + 1;
    const record = { ...entry, id, started_at: new Date().toISOString(), admin: 'Admin' };
    db.data.sync_history.push(record);
    db.write();
    return id;
  },

  // Update sync history entry
  updateSyncHistory(id, updates) {
    const entry = db.data.sync_history.find(h => h.id === id);
    if (entry) {
      Object.assign(entry, updates, { completed_at: new Date().toISOString() });
      db.write();
    }
    return entry;
  },

  // Get sync history
  getSyncHistory(limit = 50) {
    return (db.data.sync_history || []).slice().reverse().slice(0, limit);
  },

  // ===== Customer orders (persisted in db.json — travel with the project) =====

  getOrders() {
    return db.data.orders || [];
  },

  addOrder(order) {
    if (!db.data.orders) db.data.orders = [];
    const id = Math.max(0, ...db.data.orders.map(o => o.id || 0)) + 1;
    const record = { ...order, id, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    db.data.orders.push(record);
    db.write();
    return record;
  },

  updateOrder(id, updates) {
    const order = (db.data.orders || []).find(o => o.id === Number(id));
    if (order) {
      Object.assign(order, updates, { updated_at: new Date().toISOString() });
      db.write();
    }
    return order;
  },

  deleteOrder(id) {
    if (!db.data.orders) db.data.orders = [];
    db.data.orders = db.data.orders.filter(o => o.id !== Number(id));
    return db.write();
  },

  // ===== Admin UPI money movements (send / receive ledger) =====

  getPayments() {
    if (!db.data.payments) db.data.payments = [];
    return db.data.payments;
  },

  addPayment(record) {
    if (!db.data.payments) db.data.payments = [];
    const id = Math.max(0, ...db.data.payments.map(p => p.id || 0)) + 1;
    const row = { ...record, id, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    db.data.payments.push(row);
    db.write();
    // Raising a request is its own event. The settlement hook in updatePayment
    // only fires on a terminal state, so asking a customer for money was silent
    // until they paid — and "we asked for ₹999" is exactly when a team wants to
    // know. addPayment is the single place every collection is created, so one
    // hook covers checkout, staff collection and vendor bill approval.
    if (row.status === 'awaiting' || row.status === 'pending') {
      queuePaymentRequestedNotification(row);
    }
    return row;
  },

  updatePayment(id, updates) {
    const row = (db.data.payments || []).find(p => p.id === Number(id));
    if (!row) return null;
    const before = row.status;
    Object.assign(row, updates, { updated_at: new Date().toISOString() });
    db.write();
    // Roll a lead/order payment_status up from its own ledger rows. A parent is
// 'paid' once nothing is outstanding, 'pending' while anything is still in
// flight, and 'failed' when a row failed with nothing left to collect.
function syncParentPayment(rows, apply) {
  const live = rows.filter(r => r.status !== 'cancelled');
  if (!live.length) return;
  const outstanding = live.filter(r => r.status !== 'paid');
  let status;
  if (!outstanding.length) status = 'paid';
  else if (outstanding.some(r => r.status === 'failed')) status = 'failed';
  else status = 'pending';

  const parentId = live[0].lead_id || live[0].order_id;
  const parent = live.find(r => (r.lead_id || r.order_id) === parentId);
  if (parent) apply(parent.lead_id || parent.order_id, { payment_status: status });
}

// One hook for every settlement path: PayU callback, manual mark, vendor
    // payout, lead collection, shop order. Anything that moves a row into a
    // terminal state gets a notification without any caller opting in.
    if (before !== row.status && (row.status === 'paid' || row.status === 'failed')) {
      queuePaymentNotification(row, before);
    }
    // A vendor bill follows its payment. Marking the ledger row paid settles
    // the bill; a failure puts it back in the queue so it is not stranded in
    // "approved" with no way to retry.
    if (row.vendor_bill_id && before !== row.status && TERMINAL.has(row.status)) {
      const bill = this.getVendorBillById(row.vendor_bill_id);
      if (bill && bill.status !== 'paid') {
        this.updateVendorBill(bill.id, {
          status: row.status === 'paid' ? 'paid' : 'pending',
          settled_payment_id: row.id,
          settled_at: new Date().toISOString(),
        });
      }
    }
    // A PO follows its bills the same way. When every matched bill is settled,
    // the commitment is fully delivered and paid — derived here rather than at
    // each call site so the PO can never be left looking half-billed.
    if (row.po_id && before !== row.status) this.syncPurchaseOrderStatus(row.po_id);
    // The parent record follows its money. Creating a collection request parks
    // the lead/order on 'pending'; only the settlement decides the final word,
    // otherwise the pipeline would keep showing "awaiting" after the customer
    // had already paid. Derived from the ledger so it can never disagree.
    if (before !== row.status && TERMINAL.has(row.status)) {
      if (row.lead_id) syncParentPayment(this.getPaymentsForLead(row.lead_id), (id, patch) => this.updateLead(id, patch));
      if (row.order_id) syncParentPayment(this.getPaymentsForOrder(row.order_id), (id, patch) => this.updateShopOrder(id, patch));
    }
    // Tell any open checkout tab watching this reference that the row moved.
    // Fired for every update (not just settlements) so a retargeted amount or
    // rebuilt QR reaches the customer mid-checkout too.
    emitPaymentChange(row);
    return row;
  },

  // Money attributable to one lead, one shop order or one vendor. This is what
  // the "lead based money spent / received" rollups read.
  getPaymentsForLead(leadId) {
    return this.getPayments().filter(p => p.lead_id === Number(leadId));
  },
  getPaymentsForOrder(orderId) {
    return this.getPayments().filter(p => p.order_id === Number(orderId));
  },
  getPaymentsForVendor(vendorId) {
    return this.getPayments().filter(p => p.vendor_id === Number(vendorId));
  },

  // ===== Vendors, their bills and their own sessions =====

  getVendors() {
    if (!db.data.vendors) db.data.vendors = [];
    return db.data.vendors;
  },

  getVendorById(id) {
    return this.getVendors().find(v => v.id === Number(id)) || null;
  },

  getVendorByEmail(email) {
    const key = String(email || '').trim().toLowerCase();
    return this.getVendors().find(v => String(v.email || '').toLowerCase() === key) || null;
  },

  addVendor(record) {
    if (!db.data.vendors) db.data.vendors = [];
    const id = Math.max(0, ...this.getVendors().map(v => v.id || 0)) + 1;
    const row = { id, is_active: true, created_at: new Date().toISOString(), ...record };
    db.data.vendors.push(row);
    db.write();
    return row;
  },

  updateVendor(id, updates) {
    const row = this.getVendorById(id);
    if (!row) return null;
    Object.assign(row, updates, { updated_at: new Date().toISOString() });
    db.write();
    return row;
  },

  getVendorSession(token) {
    if (!db.data.vendor_sessions) db.data.vendor_sessions = [];
    const s = db.data.vendor_sessions.find(s => s.token === token);
    if (!s) return null;
    if (new Date(s.expires_at) < new Date()) return null;
    return s;
  },

  addVendorSession(session) {
    if (!db.data.vendor_sessions) db.data.vendor_sessions = [];
    db.data.vendor_sessions.push(session);
    db.write();
    return session;
  },

  deleteVendorSession(token) {
    if (!db.data.vendor_sessions) db.data.vendor_sessions = [];
    db.data.vendor_sessions = db.data.vendor_sessions.filter(s => s.token !== token);
    return db.write();
  },

  getVendorBills(filter = {}) {
    if (!db.data.vendor_bills) db.data.vendor_bills = [];
    let rows = db.data.vendor_bills;
    if (filter.vendor_id != null) rows = rows.filter(b => b.vendor_id === Number(filter.vendor_id));
    if (filter.status) rows = rows.filter(b => b.status === filter.status);
    if (filter.lead_id != null) rows = rows.filter(b => b.lead_id === Number(filter.lead_id));
    if (filter.order_id != null) rows = rows.filter(b => b.order_id === Number(filter.order_id));
    if (filter.po_id != null) rows = rows.filter(b => b.po_id === Number(filter.po_id));
    return rows;
  },

  getVendorBillById(id) {
    return this.getVendorBills().find(b => b.id === Number(id)) || null;
  },

  addVendorBill(record) {
    if (!db.data.vendor_bills) db.data.vendor_bills = [];
    const id = Math.max(0, ...this.getVendorBills().map(b => b.id || 0)) + 1;
    const row = { id, status: 'pending', created_at: new Date().toISOString(), ...record };
    db.data.vendor_bills.push(row);
    db.write();
    return row;
  },

  updateVendorBill(id, updates) {
    const row = this.getVendorBillById(id);
    if (!row) return null;
    Object.assign(row, updates, { updated_at: new Date().toISOString() });
    db.write();
    return row;
  },

  // ===== Vendor service catalogue =====

  // A vendor sells several things at several rates ("standee @ Rs.250/piece",
  // "photography @ Rs.4,500/day"), so a single flat rate on the vendor record
  // cannot express a real price list. Services live as a sub-array on the
  // vendor: they are only ever read and written together with it, so a separate
  // top-level collection would only add joins.
  getVendorServices(vendorId) {
    const v = this.getVendorById(vendorId);
    if (!v || !Array.isArray(v.services)) return [];
    return v.services;
  },

  addVendorService(vendorId, record) {
    const v = this.getVendorById(vendorId);
    if (!v) return null;
    if (!Array.isArray(v.services)) v.services = [];
    const id = Math.max(0, ...v.services.map((x) => x.id || 0)) + 1;
    const row = { id, is_active: true, created_at: new Date().toISOString(), ...record };
    v.services.push(row);
    db.write();
    return row;
  },

  updateVendorService(vendorId, serviceId, updates) {
    const row = this.getVendorServices(vendorId).find((x) => x.id === Number(serviceId));
    if (!row) return null;
    Object.assign(row, updates, { updated_at: new Date().toISOString() });
    db.write();
    return row;
  },

  // Retired rather than deleted: a PO or an old bill may still quote this
  // service, and those historical prices must stay readable.
  removeVendorService(vendorId, serviceId) {
    const row = this.getVendorServices(vendorId).find((x) => x.id === Number(serviceId));
    if (!row) return null;
    row.is_active = false;
    row.retired_at = new Date().toISOString();
    db.write();
    return row;
  },

  // ===== Purchase Orders =====

  getPurchaseOrders(filter = {}) {
    if (!db.data.purchase_orders) db.data.purchase_orders = [];
    let rows = db.data.purchase_orders;
    if (filter.vendor_id != null) rows = rows.filter((p) => p.vendor_id === Number(filter.vendor_id));
    if (filter.lead_id != null) rows = rows.filter((p) => p.lead_id === Number(filter.lead_id));
    if (filter.status) rows = rows.filter((p) => p.status === filter.status);
    return rows;
  },

  getPurchaseOrderById(id) {
    return this.getPurchaseOrders().find((p) => p.id === Number(id)) || null;
  },

  // Human-readable, monotonic, and prefixed by year so POs sort chronologically
  // and a glance tells you which financial year a commitment belongs to.
  nextPoNumber() {
    const year = new Date().getFullYear();
    const prefix = `PO-${year}-`;
    const used = this.getPurchaseOrders()
      .map((p) => String(p.po_number || ''))
      .filter((n) => n.startsWith(prefix))
      .map((n) => Number(n.slice(prefix.length)) || 0);
    return prefix + String(Math.max(0, ...used) + 1).padStart(4, '0');
  },

  addPurchaseOrder(record) {
    if (!db.data.purchase_orders) db.data.purchase_orders = [];
    const id = Math.max(0, ...this.getPurchaseOrders().map((p) => p.id || 0)) + 1;
    const row = {
      id,
      po_number: this.nextPoNumber(),
      status: 'pending',
      created_at: new Date().toISOString(),
      ...record,
    };
    db.data.purchase_orders.push(row);
    db.write();
    return row;
  },

  updatePurchaseOrder(id, updates) {
    const row = this.getPurchaseOrderById(id);
    if (!row) return null;
    Object.assign(row, updates, { updated_at: new Date().toISOString() });
    db.write();
    return row;
  },

  // How much of a PO has been invoiced, per line. This is the 3-way match: a
  // bill may only claim quantity that was ordered and not already billed, so
  // the same standees cannot be invoiced twice against one PO.
  getPoBilledQty(poId) {
    const po = this.getPurchaseOrderById(poId);
    if (!po) return new Map();
    const billed = new Map();
    for (const bill of this.getVendorBills({ po_id: po.id })) {
      // Cancelled and rejected bills release their claim back to the PO.
      if (bill.status === 'cancelled' || bill.status === 'rejected') continue;
      for (const line of bill.lines || []) {
        const key = Number(line.service_id);
        billed.set(key, (billed.get(key) || 0) + (Number(line.qty) || 0));
      }
    }
    return billed;
  },

  // Roll the PO's own status up from its bills. Only ever moves a PO forward
  // out of the approved/pending-approval states, so it can never resurrect a
  // rejected or cancelled commitment.
  syncPurchaseOrderStatus(poId) {
    const po = this.getPurchaseOrderById(poId);
    if (!po) return null;
    if (!['approved', 'part_billed', 'billed'].includes(po.status)) return po;

    const bills = this.getVendorBills({ po_id: po.id })
      .filter((b) => !['cancelled', 'rejected'].includes(b.status));

    // Every bill was rejected or cancelled, so the commitment is untouched and
    // the PO goes back to being simply "approved" — the vendor may bill it
    // again. This is a move backwards, so it is handled explicitly rather than
    // by the forward-only rollup below.
    if (!bills.length) {
      return po.status === 'approved' ? po : this.updatePurchaseOrder(po.id, { status: 'approved' });
    }

    const billed = this.getPoBilledQty(po.id);
    const fullyInvoiced = (po.lines || []).every(
      (l) => (billed.get(Number(l.service_id)) || 0) >= (Number(l.qty) || 0),
    );
    const allPaid = bills.every((b) => b.status === 'paid');
    const anyInvoiced = (billed.size > 0);

    let status = po.status;
    if (allPaid && fullyInvoiced) status = 'completed';
    else if (fullyInvoiced) status = 'billed';
    else if (anyInvoiced) status = 'part_billed';

    return status === po.status ? po : this.updatePurchaseOrder(po.id, { status });
  },

  // ===== Geo =====
  //
  // The 200m check for a recee capture. Lives here rather than in the route so
  // the browser and the server can be made to agree on one definition — a
  // client-side-only check is just a suggestion, and the server recomputes it
  // from the reported coordinates regardless.

  /** Great-circle distance in metres between two lat/lng points. */
  distanceMeters(aLat, aLng, bLat, bLng) {
    const toRad = (d) => (Number(d) * Math.PI) / 180;
    const R = 6371000; // mean earth radius, metres
    const dLat = toRad(bLat - aLat);
    const dLng = toRad(bLng - aLng);
    const lat1 = toRad(aLat);
    const lat2 = toRad(bLat);
    const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
    return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
  },

  /**
   * Whether a capture is close enough to the assigned location.
   *
   * The GPS device reports its own error margin (`accuracy`), typically 5-30m
   * outdoors but much worse indoors — a lift lobby can read 150m. Comparing the
   * raw distance to a flat 200m threshold would therefore reject staff who are
   * genuinely standing at the door, so the device's own error is added to the
   * measured distance before comparing. The claim being accepted is "the target
   * is within 200m, give or take the accuracy the GPS itself reports".
   */
  isWithinCaptureRadius(targetLat, targetLng, lat, lng, accuracyM, radiusM = 200) {
    if ([targetLat, targetLng, lat, lng].some((v) => !Number.isFinite(Number(v)))) {
      return { ok: false, distance_m: null, reason: 'missing_coordinates' };
    }
    const distance = this.distanceMeters(lat, lng, targetLat, targetLng);
    const accuracy = Number.isFinite(Number(accuracyM)) ? Math.max(0, Number(accuracyM)) : 0;
    // An accuracy far worse than the radius itself means the fix is worthless,
    // not merely imprecise — treat that as out of range rather than pretending
    // a 5km-wide error circle proves anything.
    if (accuracy > radiusM) {
      return { ok: false, distance_m: distance, accuracy_m: accuracy, reason: 'accuracy_too_low' };
    }
    const effective = distance + accuracy;
    return {
      ok: effective <= radiusM,
      distance_m: distance,
      accuracy_m: accuracy,
      effective_m: Math.round(effective),
      radius_m: radiusM,
    };
  },

  // ===== Notifications (in-app feed; delivery adapters read these) =====

  getNotifications(filter = {}) {
    if (!db.data.notifications) db.data.notifications = [];
    let rows = db.data.notifications;
    if (filter.audience) rows = rows.filter(n => n.audience === filter.audience);
    if (filter.vendor_id != null) rows = rows.filter(n => n.vendor_id === Number(filter.vendor_id));
    if (filter.read !== undefined) rows = rows.filter(n => !!n.read === !!filter.read);
    return rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  },

  addNotification(record) {
    if (!db.data.notifications) db.data.notifications = [];
    const id = Math.max(0, ...db.data.notifications.map(n => n.id || 0)) + 1;
    const row = { id, read: false, created_at: new Date().toISOString(), ...record };
    db.data.notifications.push(row);
    db.write();
    return row;
  },

  getNotificationById(id) {
    return (db.data.notifications || []).find((n) => n.id === Number(id)) || null;
  },

  updateNotification(id, updates) {
    const row = this.getNotificationById(id);
    if (!row) return null;
    Object.assign(row, updates);
    db.write();
    return row;
  },

  markNotificationsRead(filter = {}) {
    let changed = 0;
    for (const n of this.getNotifications(filter)) {
      if (!n.read) { n.read = true; changed++; }
    }
    if (changed) db.write();
    return changed;
  },

  // Cap the feed so a busy month cannot grow db.json without bound. Read
  // receipts are far less useful than the last few hundred events.
  pruneNotifications(keep = 500) {
    if (!db.data.notifications) return 0;
    const rows = this.getNotifications();
    if (rows.length <= keep) return 0;
    const drop = new Set(rows.slice(keep).map(n => n.id));
    db.data.notifications = db.data.notifications.filter(n => !drop.has(n.id));
    db.write();
    return drop.size;
  },

  deletePayment(id) {
    db.data.payments = (db.data.payments || []).filter(p => p.id !== Number(id));
    return db.write();
  },

  // ===== Admin settings (agency fee, per-location price) =====

  getSettings() {
    if (!db.data.settings) db.data.settings = { per_location_price: 0, agency_fee: 10 };
    return db.data.settings;
  },

  updateSettings(updates) {
    if (!db.data.settings) db.data.settings = { per_location_price: 0, agency_fee: 10 };
    const clean = {};
    if (typeof updates.agency_fee === 'number' && !isNaN(updates.agency_fee)) clean.agency_fee = updates.agency_fee;
    if (typeof updates.per_location_price === 'number' && !isNaN(updates.per_location_price)) clean.per_location_price = updates.per_location_price;
    Object.assign(db.data.settings, clean, { updated_at: new Date().toISOString() });
    db.write();
    return db.data.settings;
  },

  // ===== Shop: users, sessions, carts, wishlists, shop orders =====

getUserByEmail(email) {
    return (db.data.users || []).find((u) => String(u.email).toLowerCase() === String(email).toLowerCase()) || null;
  },

  getAllUsers() {
    return db.data.users || [];
  },

  getUserById(id) {
    return (db.data.users || []).find((u) => u.id === id);
  },

  // ===== Team members (staff users with roles) =====
  getTeamMembers() {
    return (db.data.users || []).filter((u) => u.is_team).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  },

  // ===== Departments =====

  getDepartments() {
    return (db.data.departments || []).sort((a, b) => a.name.localeCompare(b.name));
  },

  getDepartmentById(id) {
    return (db.data.departments || []).find((d) => d.id === Number(id));
  },

  addDepartment(data) {
    if (!db.data.departments) db.data.departments = [];
    const id = Math.max(0, ...(db.data.departments || []).map((d) => d.id || 0)) + 1;
    const record = {
      id,
      name: data.name || '',
      description: data.description || '',
      is_active: data.is_active !== false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    db.data.departments.push(record);
    db.write();
    return record;
  },

  updateDepartment(id, updates) {
    const dept = (db.data.departments || []).find((d) => d.id === Number(id));
    if (!dept) return null;
    Object.assign(dept, updates, { updated_at: new Date().toISOString() });
    db.write();
    return dept;
  },

  deleteDepartment(id) {
    // Unassign users from this department before deleting. Compare
    // numerically: rows written before the department_id coercion could hold a
    // string, and a strict === would leave them pointing at a deleted dept.
    for (const u of (db.data.users || [])) {
      if (u.department_id != null && Number(u.department_id) === Number(id)) u.department_id = null;
    }
    db.data.departments = (db.data.departments || []).filter((d) => d.id !== Number(id));
    db.write();
  },

  getUsersByDepartment(deptId) {
    // Numeric comparison on purpose — see deleteDepartment. This powers the
    // disable-cascade, so a member whose id is the wrong type would silently
    // escape being deactivated with their department.
    return (db.data.users || []).filter(
      (u) => u.is_team && u.department_id != null && Number(u.department_id) === Number(deptId),
    );
  },

  // ===== Team members (staff users with roles) =====

  // Staff list compatible with /api/auth/me shape but includes role metadata.
  getStaffUserById(id) {
    const u = dbHelpers.getUserById(id);
    return u && u.is_team ? u : null;
  },

  addUser({ name, email, password_salt, password_hash, password_enc, phone, designation, role, is_team, device_number, department_id, locations }) {
    if (!db.data.users) db.data.users = [];
    const user = {
      id: Math.max(0, ...db.data.users.map((u) => u.id || 0)) + 1,
      name, email: String(email).toLowerCase(), password_salt, password_hash,
      password_enc: password_enc || null,
      phone: phone || '',
      designation: designation || '',
      role: role || (is_team ? 'member' : 'user'),
      is_team: !!is_team,
      device_number: device_number || '',
      department_id: department_id || null,
      locations: locations || '',
      is_active: true,
      created_at: new Date().toISOString(),
    };
    db.data.users.push(user);
    db.write();
    return user;
  },

  updateUser(id, updates) {
    const user = (db.data.users || []).find((u) => u.id === Number(id));
    if (!user) return null;
    Object.assign(user, updates, { updated_at: new Date().toISOString() });
    db.write();
    return user;
  },

  getSession(token) {
    const s = (db.data.sessions || []).find((s) => s.token === token);
    if (!s) return null;
    if (new Date(s.expires_at) < new Date()) return null; // expired
    return s;
  },

  addSession(session) {
    if (!db.data.sessions) db.data.sessions = [];
    db.data.sessions.push(session);
    db.write();
    return session;
  },

  deleteSession(token) {
    if (!db.data.sessions) db.data.sessions = [];
    db.data.sessions = db.data.sessions.filter((s) => s.token !== token);
    return db.write();
  },

  getCart(userId) {
    return (db.data.carts || []).find((c) => c.user_id === userId)?.items || [];
  },

  setCart(userId, items) {
    if (!db.data.carts) db.data.carts = [];
    let entry = db.data.carts.find((c) => c.user_id === userId);
    if (entry) { entry.items = items; entry.updated_at = new Date().toISOString(); }
    else db.data.carts.push({ user_id: userId, items, updated_at: new Date().toISOString() });
    db.write();
    return items;
  },

  getWishlist(userId) {
    return (db.data.wishlists || []).find((w) => w.user_id === userId)?.items || [];
  },

  setWishlist(userId, items) {
    if (!db.data.wishlists) db.data.wishlists = [];
    let entry = db.data.wishlists.find((w) => w.user_id === userId);
    if (entry) { entry.items = items; entry.updated_at = new Date().toISOString(); }
    else db.data.wishlists.push({ user_id: userId, items, updated_at: new Date().toISOString() });
    db.write();
    return items;
  },

  addShopOrder(order) {
    if (!db.data.shop_orders) db.data.shop_orders = [];
    const record = {
      id: Math.max(0, ...db.data.shop_orders.map((o) => o.id || 0)) + 1,
      ...order,
      created_at: new Date().toISOString(),
    };
    db.data.shop_orders.push(record);
    db.write();
    queueRecordNotification('order', record);
    return record;
  },

  updateShopOrder(id, updates) {
    const order = (db.data.shop_orders || []).find((o) => o.id === Number(id));
    if (order) {
      Object.assign(order, updates);
      db.write();
    }
    return order;
  },

  getShopOrders() {
    return (db.data.shop_orders || []).slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  },

  deleteShopOrder(id) {
    const before = (db.data.shop_orders || []).length;
    db.data.shop_orders = (db.data.shop_orders || []).filter(o => o.id !== Number(id));
    if (db.data.shop_orders.length === before) return null;
    db.write();
    return true;
  },

  getShopOrdersByUser(userId) {
    return (db.data.shop_orders || []).filter((o) => o.user_id === userId).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  },

  // Distinct tab names among active records (for catchment-tab resolution)
  getActiveTabNames() {
    const tabs = new Set();
    for (const r of (db.data.records || [])) {
      if (r.data && r.data.is_active !== false && r.data.tab_name) tabs.add(r.data.tab_name);
    }
    return [...tabs];
  },

  // Check if a place name exists as an active inhouse record (source !== 'google')
  isNameInhouse(name) {
    const base = name.replace(/\s+\(\d+\)\s*$/, '').toLowerCase().trim();
    for (const r of (db.data.records || [])) {
      if (r.data && r.data.is_active !== false && r.data.name) {
        const rBase = r.data.name.replace(/\s+\(\d+\)\s*$/, '').toLowerCase().trim();
        if (rBase === base && r.data.source !== 'google') return true;
      }
    }
    return false;
  },

  // ===== Google Nearby sighting counters =====

  bumpGoogleSeen(key) {
    if (!db.data.google_seen) db.data.google_seen = {};
    const prev = db.data.google_seen[key] || 0;
    const next = prev + 1;
    db.data.google_seen[key] = next;
    db.write();
    return next;
  },

  getGoogleSeenCount(key) {
    return (db.data.google_seen || {})[key] || 0;
  },

  // ===== Sheet backfill queue (customer selections → Google Sheet) =====

  // All queued rows (oldest first)
  getAllBackfill() {
    return db.data.backfill || [];
  },

  // Rows still waiting to be pushed to the sheet
  getPendingBackfill() {
    return (db.data.backfill || []).filter((r) => r.status === 'pending');
  },

  addBackfillRow(row) {
    if (!db.data.backfill) db.data.backfill = [];
    db.data.backfill.push(row);
    db.write();
    return row;
  },

  updateBackfillRow(id, updates) {
    const row = (db.data.backfill || []).find((r) => r.id === id);
    if (row) {
      Object.assign(row, updates);
      db.write();
    }
    return row;
  },

  // Add sync error
  addSyncError(syncId, error) {
    db.data.sync_errors.push({
      id: db.data.sync_errors.length + 1,
      sync_id: syncId,
      ...error,
      created_at: new Date().toISOString(),
    });
    return db.write();
  },

  // ===== Site surveys (recee team submissions) =====

  getSiteSurveys() {
    return (db.data.site_surveys || []).slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  },

  addSiteSurvey(data) {
    if (!db.data.site_surveys) db.data.site_surveys = [];
    const id = Math.max(0, ...db.data.site_surveys.map((s) => s.id || 0)) + 1;
    const record = {
      id,
      ...data,
      status: data.status || 'new',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    db.data.site_surveys.push(record);
    db.write();
    return record;
  },

  updateSiteSurvey(id, updates) {
    const survey = (db.data.site_surveys || []).find((s) => s.id === Number(id));
    if (!survey) return null;
    Object.assign(survey, updates, { updated_at: new Date().toISOString() });
    db.write();
    return survey;
  },

  deleteSiteSurvey(id) {
    const before = (db.data.site_surveys || []).length;
    db.data.site_surveys = (db.data.site_surveys || []).filter((s) => s.id !== Number(id));
    if (db.data.site_surveys.length === before) return false;
    db.write();
    return true;
  },

  // ===== Products (website management) =====

  getProducts() {
    return db.data.products || [];
  },

  getProductById(id) {
    return (db.data.products || []).find((p) => p.id === Number(id));
  },

  addProduct(product) {
    if (!db.data.products) db.data.products = [];
    const record = {
      id: Math.max(0, ...db.data.products.map((p) => p.id || 0)) + 1,
      ...product,
      is_active: product.is_active !== false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    db.data.products.push(record);
    db.write();
    return record;
  },

  updateProduct(id, updates) {
    const product = dbHelpers.getProductById(id);
    if (!product) return null;
    Object.assign(product, updates, { updated_at: new Date().toISOString() });
    db.write();
    return product;
  },

  deleteProduct(id) {
    db.data.products = (db.data.products || []).filter((p) => p.id !== Number(id));
    return db.write();
  },

  // ===== Leads (CRM pipeline) =====

  getLeads() {
    return db.data.leads || [];
  },

  getLeadById(id) {
    return (db.data.leads || []).find((l) => l.id === Number(id));
  },

  addLead(leadData) {
    if (!db.data.leads) db.data.leads = [];
    const id = Math.max(0, ...(db.data.leads || []).map((l) => l.id || 0)) + 1;
    const record = {
      id,
      ...leadData,
      status: leadData.status || 'new',
      cold_flag: leadData.cold_flag || false,
      cold_reason: leadData.cold_reason || '',
      notes: leadData.notes || [],
      activities: leadData.activities || [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    db.data.leads.push(record);
    db.write();
    queueRecordNotification('lead', record);
    return record;
  },

  updateLead(id, updates) {
    const lead = (db.data.leads || []).find((l) => l.id === Number(id));
    if (!lead) return null;
    Object.assign(lead, updates, { updated_at: new Date().toISOString() });
    db.write();
    return lead;
  },

  deleteLead(id) {
    db.data.leads = (db.data.leads || []).filter((l) => l.id !== Number(id));
    return db.write();
  },

  addLeadActivity(leadId, activity) {
    const lead = (db.data.leads || []).find((l) => l.id === Number(leadId));
    if (!lead) return null;
    if (!lead.activities) lead.activities = [];
    lead.activities.push({
      id: lead.activities.length + 1,
      ...activity,
      timestamp: new Date().toISOString(),
    });
    lead.updated_at = new Date().toISOString();
    db.write();
    return lead;
  },

  addLeadNote(leadId, note) {
    const lead = (db.data.leads || []).find((l) => l.id === Number(leadId));
    if (!lead) return null;
    if (!lead.notes) lead.notes = [];
    lead.notes.push({
      id: lead.notes.length + 1,
      ...note,
      timestamp: new Date().toISOString(),
    });
    lead.updated_at = new Date().toISOString();
    db.write();
    return lead;
  },

  // ===== Companies (customer accounts — the spine of the CRM) =====
  //
  // A company is a *customer account*, not the BTLbro agency itself. Leads are
  // the individual enquiries/campaigns a company submits; payments, chat and
  // activity all hang off the company so one drill-down shows the whole story.
  //
  // `name_key` is the dedupe key. Two leads saying "Cafe Coffee House" and
  // "cafe coffee house pvt ltd" are the same account, so the key strips case,
  // punctuation and common legal suffixes. First name seen wins as the display
  // name; we never silently rewrite it.

  getCompanies() {
    if (!db.data.companies) db.data.companies = [];
    return db.data.companies;
  },

  getCompanyById(id) {
    return (db.data.companies || []).find((c) => c.id === Number(id));
  },

  getCompanyByNameKey(key) {
    if (!key) return null;
    return (db.data.companies || []).find((c) => c.name_key === key);
  },

  // Normalized dedupe key. Deliberately conservative: it only removes noise
  // (case, punctuation, spacing, legal suffixes) — it never fuzzy-matches, so
  // "Cafe Coffee" and "Cafe Cofee" stay separate rather than being merged wrong.
  companyKey(name) {
    return String(name || '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\b(pvt|private|ltd|limited|llp|inc|incorporated|co|company|and|the|india|indian)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  },

  addCompany(companyData) {
    if (!db.data.companies) db.data.companies = [];
    const id = Math.max(0, ...db.data.companies.map((c) => c.id || 0)) + 1;
    const now = new Date().toISOString();
    const record = {
      id,
      name: companyData.name || '',
      name_key: companyData.name_key || dbHelpers.companyKey(companyData.name),
      contact_name: companyData.contact_name || '',
      phone: companyData.phone || '',
      email: companyData.email || '',
      category: companyData.category || '',
      pincode: companyData.pincode || '',
      is_active: companyData.is_active !== false,
      created_at: now,
      updated_at: now,
    };
    db.data.companies.push(record);
    db.write();
    return record;
  },

  updateCompany(id, updates) {
    const company = (db.data.companies || []).find((c) => c.id === Number(id));
    if (!company) return null;
    Object.assign(company, updates, { updated_at: new Date().toISOString() });
    if (updates.name && !('name_key' in updates)) {
      company.name_key = dbHelpers.companyKey(updates.name);
    }
    db.write();
    return company;
  },

  // Resolve a company from a lead-shaped payload. Returns the existing company
  // when the name_key matches, otherwise creates one. Contact details are only
  // filled in when currently blank — the first person who introduced the
  // account stays the representative until someone edits it deliberately.
  findOrCreateCompany({ businessName, contactName, phone, email, category, pincode } = {}) {
    const name = String(businessName || '').trim();
    const key = dbHelpers.companyKey(name);
    if (!key) return null;

    let company = dbHelpers.getCompanyByNameKey(key);
    if (!company) {
      company = dbHelpers.addCompany({
        name,
        name_key: key,
        contact_name: String(contactName || '').trim(),
        phone: String(phone || '').trim(),
        email: String(email || '').trim(),
        category: String(category || '').trim(),
        pincode: String(pincode || '').trim(),
      });
      return company;
    }

    const patch = {};
    if (!company.contact_name && contactName) patch.contact_name = String(contactName).trim();
    if (!company.phone && phone) patch.phone = String(phone).trim();
    if (!company.email && email) patch.email = String(email).trim();
    if (!company.category && category) patch.category = String(category).trim();
    if (Object.keys(patch).length > 0) return dbHelpers.updateCompany(company.id, patch);
    return company;
  },

  // Attach a lead to a company, resolving the company from the lead's own
  // businessName. Safe to call repeatedly — already-linked leads are a no-op
  // unless their company was cleared.
  linkLeadToCompany(leadId) {
    const lead = dbHelpers.getLeadById(leadId);
    if (!lead) return null;
    const company = dbHelpers.findOrCreateCompany({
      businessName: lead.businessName,
      contactName: lead.contactName,
      phone: lead.phone,
      email: lead.email,
      category: lead.category,
      pincode: lead.pincode,
    });
    if (!company) return null;
    if (lead.company_id !== company.id) {
      Object.assign(lead, { company_id: company.id, updated_at: new Date().toISOString() });
      db.write();
    }
    return company;
  },

  getCompaniesForLead(leadId) {
    return (db.data.companies || []).filter((c) =>
      (db.data.leads || []).some((l) => Number(l.company_id) === Number(c.id) && Number(l.id) === Number(leadId))
    );
  },

  // One-shot migration for leads that predate the companies collection.
  backfillCompanies() {
    let linked = 0;
    let created = 0;
    const before = (db.data.companies || []).length;
    for (const lead of db.data.leads || []) {
      if (lead.company_id) continue;
      const company = dbHelpers.linkLeadToCompany(lead.id);
      if (company) {
        linked += 1;
        if ((db.data.companies || []).length > before) created += 1;
      }
    }
    if (linked > 0) db.write();
    return { linked, created, total: (db.data.companies || []).length };
  },

  // ===== Conversations (WhatsApp chat) =====

  getConversations() {
    return db.data.conversations || [];
  },

  getConversationByLeadId(leadId) {
    return (db.data.conversations || []).find((c) => c.lead_id === Number(leadId));
  },

  getConversationByPhone(phone) {
    return (db.data.conversations || []).find((c) => c.customer_phone === phone);
  },

  addConversation(convData) {
    if (!db.data.conversations) db.data.conversations = [];
    const id = Math.max(0, ...(db.data.conversations || []).map((c) => c.id || 0)) + 1;
    const record = {
      id,
      ...convData,
      messages: convData.messages || [],
      last_msg_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };
    db.data.conversations.push(record);
    db.write();
    return record;
  },

  addMessageToConversation(convId, message) {
    const conv = (db.data.conversations || []).find((c) => c.id === Number(convId));
    if (!conv) return null;
    if (!conv.messages) conv.messages = [];
    conv.messages.push({
      id: conv.messages.length + 1,
      ...message,
      timestamp: new Date().toISOString(),
    });
    conv.last_msg_at = new Date().toISOString();
    db.write();
    return conv;
  },

  // Flip a message's delivery state once the provider actually answers.
  //
  // Without this a message stayed "pending" forever: the row was written before
  // WhatsApp was called, and nothing ever came back to change it. A failed send
  // therefore rendered in the thread exactly like a delivered one.
  updateMessageStatus(convId, messageId, patch = {}) {
    const conv = (db.data.conversations || []).find((c) => c.id === Number(convId));
    if (!conv || !conv.messages) return null;
    const msg = conv.messages.find((m) => m.id === Number(messageId));
    if (!msg) return null;
    Object.assign(msg, patch);
    db.write();
    return msg;
  },

  // ===== Internal team chat (socket.io) =====

  getTeamMessages(room) {
    if (!db.data.team_messages) db.data.team_messages = [];
    return (db.data.team_messages || [])
      .filter((m) => m.room === room)
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  },

  addTeamMessage(msgData) {
    if (!db.data.team_messages) db.data.team_messages = [];
    const id = Math.max(0, ...(db.data.team_messages || []).map((m) => m.id || 0)) + 1;
    const record = { id, ...msgData, timestamp: msgData.timestamp || new Date().toISOString() };
    db.data.team_messages.push(record);
    db.write();
    return record;
  },

  // ===== Website content (section-by-section managed via admin) =====

  getSiteContent() {
    if (!db.data.site_content) db.data.site_content = {};
    return db.data.site_content;
  },

  getContentBlock(key) {
    return dbHelpers.getSiteContent()[key];
  },

  setContentBlock(key, value) {
    const content = dbHelpers.getSiteContent();
    content[key] = { ...(content[key] || {}), ...value, updated_at: new Date().toISOString() };
    db.write();
    return content[key];
  },

  // ===== Inline record editing (data tab, sheet-style) =====

  getRecordById(id) {
    return (db.data.records || []).find((r) => r.id === Number(id));
  },

  getAllRecords() {
    return (db.data.records || []).filter((r) => r.data && r.data.is_active !== false);
  },

  getAllRecordsRaw() {
    return (db.data.records || []).filter((r) => r.data);
  },

  // Find-or-create a single record by its sheet_id, attached to the connected
  // Google Sheet file. Used to surface a searched location in the Data tab
  // immediately (the sheet remains the source of truth — the next sync
  // reconciles this row). Returns the record.
  upsertRecord(data) {
    const sheetId = String(data?.sheet_id || '').trim();
    const found = (db.data.records || []).find(
      (r) => r.data && String(r.data.sheet_id || '').trim() === sheetId
    );
    if (found) {
      Object.assign(found.data, data);
      found.updated_at = new Date().toISOString();
      db.write();
      return found;
    }
    const file = this.getSheetFile();
    const fileId = file ? file.id : null;
    const record = this.appendRecord(fileId, data);
    db.write();
    return record;
  },

  // A record's source is the single fact the field team cares about: has
  // someone physically been there (inhouse) or are we trusting Google's word
  // (google)? Historically it was written inconsistently ('Inhouse', 'google',
  // 'from google'), so read it through one normaliser.
  recordSource(record) {
    const v = String(record?.data?.source || '').trim().toLowerCase();
    if (v === 'google' || v === 'from google' || v === 'gplace') return 'google';
    if (v === 'inhouse' || v === 'in-house') return 'inhouse';
    return v || 'unknown';
  },

  // Apply a completed survey to the location row it was captured for.
  //
  // Two things happen, and both are wanted:
  //   1. `source` flips google -> inhouse, because someone has now stood there.
  //   2. the recee's per-service prices are written onto the row.
  //
  // Crucially the provenance is NOT thrown away: original_source, who surveyed
  // it and when are all kept, so "how do we know this is inhouse" stays
  // answerable. Without that, an inhouse flag is indistinguishable from a row
  // that was always ours.
  //
  // A price of 0 is not "unknown", it is a deliberate answer: the recee went
  // there and confirmed the service is not offered at that location. The
  // checkout pricer already treats a 0 price as "not offered here, charge
  // nothing", so the two agree.
  applySurveyToRecord(recordId, { services, survey, byName, byId }) {
    const record = this.getRecordById(recordId);
    if (!record) return null;
    const d = record.data;

    const from = this.recordSource(record);
    const patch = {};

    if (services && typeof services === 'object') {
      const existing = (d.services && typeof d.services === 'object' && !Array.isArray(d.services)) ? d.services : {};
      patch.services = { ...existing };
      for (const [name, price] of Object.entries(services)) {
        const key = String(name).trim();
        if (!key) continue;
        patch.services[key] = Math.max(0, Math.round(Number(price) || 0));
      }
    }

    // Only promote the row once it actually has a price list. A row with no
    // priced service is not sellable, and flipping the flag early would push
    // an unpriceable location into checkout.
    const priced = Object.values(patch.services || d.services || {}).some((v) => Number(v) > 0);
    if (from === 'google' && priced) {
      patch.source = 'inhouse';
      patch.original_source = 'google';
    }

    patch.verified = true;
    patch.verification_method = 'site_survey';
    patch.surveyed_by = byName || survey?.submitted_by || null;
    patch.surveyed_by_id = byId || survey?.submitted_by_id || null;
    patch.surveyed_at = survey?.completed_at || new Date().toISOString();
    if (survey?.id) patch.survey_id = survey.id;
    if (survey?.photos?.length) patch.survey_photos = survey.photos.slice(0, 12);
    if (survey?.manager_name || survey?.manager_phone) {
      patch.manager_contact = {
        name: survey.manager_name || d.manager_contact?.name || '',
        phone: survey.manager_phone || d.manager_contact?.phone || '',
      };
    }

    // The row and the recee assignment move together: a promoted row is a done
    // recee, so the Data section stops showing it as pending.
    patch.recee_status = 'done';
    patch.recee_status_at = patch.surveyed_at;
    patch.recee_status_by = byName || survey?.submitted_by || null;
    patch.needs_recee = false;

    return this.updateRecordData(record.id, patch);
  },

  updateRecordData(id, updates) {
    const record = (db.data.records || []).find((r) => r.id === Number(id));
    if (!record) return null;
    if (!record.data) record.data = {};
    Object.assign(record.data, updates, { edited_locally: true, edited_at: new Date().toISOString() });
    record.updated_at = new Date().toISOString();
    db.write();
    return record;
  },

  // Update the inner fields of a record.data object wholesale
  patchRecordData(id, dataPatch) {
    const record = (db.data.records || []).find((r) => r.id === Number(id));
    if (!record) return null;
    record.data = { ...record.data, ...dataPatch, edited_locally: true, edited_at: new Date().toISOString() };
    record.updated_at = new Date().toISOString();
    db.write();
    return record;
  },

  // ===== Expanded settings (transitional: read keeps legacy flat keys) =====

  updateSettingsExtended(updates) {
    if (!db.data.settings) db.data.settings = {};
    const clean = { ...updates };
    delete clean.updated_at;
    Object.assign(db.data.settings, clean, { updated_at: new Date().toISOString() });
    db.write();
    return db.data.settings;
  },

  // Save/write to disk
  write() {
    return db.write();
  },
};

export default db;
