// ============================================================
// SHEET BACKFILL — two-way sync (DB → Google Sheet)
// ============================================================
// Customer selections from the Marketing Tool must reach the master
// Google Sheet, not just db.json. Especially places found via Google Places
// (not yet in the sheet) get appended so the agency team can price and
// onboard them.
//
// Because the sheet is read by the sync through the PUBLIC export (no OAuth),
// writes go through a tiny Google Apps Script Web App bound to the same
// spreadsheet (the only Google-sanctioned way to write without setting up a
// GCP service account). The script appends a row to the "CRM Backfill" tab:
//
//   Name | Type | Lat | Lng | GMap Link | Source | Selected At
//                                                        ^ last col
//
// Set SHEET_BACKFILL_WEBHOOK_URL in server/.env to the deployed Web App URL
// (must be "Anyone" access). Until then, rows queue in db.json and can be
// exported as CSV from the Admin Panel (Sheet Backfill card on the Drive tab).
//
// Queue lives in db.json → survives restarts; every queued row carries
// `source: 'inhouse' | 'from google'` and is marked done after a 200 from
// the webhook (retries up to 3 times with backoff).

import { dbHelpers } from '../db.js';

const WEBHOOK_URL = () => (process.env.SHEET_BACKFILL_WEBHOOK_URL || '').trim();
const MAX_ATTEMPTS = 3;
const BACKFILL_TAB = 'CRM Backfill';

// Queue a location for backfill. Accepts the shape MarketingTool/checkout send:
// { name, type, lat, lng, source } (+ optional distance_km, pin_code)
export function queueBackfill(entries) {
  const list = Array.isArray(entries) ? entries : [entries];
  const queued = [];
  list.forEach((e) => {
    const name = String(e.name || '').trim();
    if (!name) return; // nothing identifiable — skip
    const source = e.source === 'from google' || e.source === 'google'
      ? 'from google'
      : 'inhouse';
    const row = {
      id: `bf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      type: String(e.type || '').trim(),
      lat: Number(e.lat) || 0,
      lng: Number(e.lng) || 0,
      distance_km: Number(e.distance_km) || 0,
      pin_code: String(e.pin_code || '').replace(/\s+/g, ''),
      source,
      gmap_link: e.lat && e.lng
        ? `https://www.google.com/maps?q=${e.lat},${e.lng}`
        : '',
      status: 'pending',
      attempts: 0,
      last_error: '',
      created_at: new Date().toISOString(),
    };
    dbHelpers.addBackfillRow(row);
    queued.push(row);
  });
  return queued;
}

// POST one row to the Apps Script webhook. Returns true on success.
async function pushRow(row) {
  const url = WEBHOOK_URL();
  if (!url) throw new Error('SHEET_BACKFILL_WEBHOOK_URL not configured');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' }, // avoids Apps Script CORS preflight
      body: JSON.stringify({
        secret: process.env.SHEET_BACKFILL_SECRET || '',
        tab: BACKFILL_TAB,
        row: {
          Name: row.name,
          Type: row.type,
          Lat: row.lat,
          Lng: row.lng,
          'GMap Link': row.gmap_link,
          Source: row.source, // ← the last-column category
          'Selected At': row.created_at,
        },
      }),
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();
    if (text && !/ok|success|"/i.test(text)) throw new Error(`Unexpected response: ${text.slice(0, 80)}`);
    return true;
  } finally {
    clearTimeout(timeout);
  }
}

// Flush the queue: push every pending row. Called by POST /api/admin/sheet-backfill/flush
// (admin button) and best-effort right after an order is placed.
export async function flushBackfill() {
  const pending = dbHelpers.getPendingBackfill();
  if (pending.length === 0) return { pushed: 0, failed: 0, remaining: 0, configured: !!WEBHOOK_URL() };
  // No webhook yet → no-op. Rows stay queued (attempts NOT burned) so the
  // agency can set the URL later or export the CSV manually.
  if (!WEBHOOK_URL()) return { pushed: 0, failed: 0, remaining: pending.length, configured: false };

  let pushed = 0, failed = 0;
  for (const row of pending) {
    try {
      await pushRow(row);
      dbHelpers.updateBackfillRow(row.id, { status: 'synced', last_error: '', attempts: row.attempts + 1 });
      pushed++;
    } catch (err) {
      const attempts = (row.attempts || 0) + 1;
      const dead = attempts >= MAX_ATTEMPTS;
      dbHelpers.updateBackfillRow(row.id, {
        attempts,
        status: dead ? 'failed' : 'pending',
        last_error: String(err.message || err).slice(0, 200),
      });
      failed++;
      if (dead) console.warn(`[SheetBackfill] Row ${row.name} failed ${MAX_ATTEMPTS}x: ${err.message}`);
    }
  }
  const remaining = dbHelpers.getPendingBackfill().length;
  return { pushed, failed, remaining, configured: !!WEBHOOK_URL() };
}

// CSV of the whole queue — manual fallback while the webhook is not configured
// (or when the agency wants to paste rows into the sheet themselves).
export function backfillCsv() {
  const rows = dbHelpers.getAllBackfill();
  const headers = ['Name', 'Type', 'Lat', 'Lng', 'GMap Link', 'Source', 'Selected At', 'Status'];
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(',')];
  rows.forEach((r) => {
    lines.push([r.name, r.type, r.lat, r.lng, r.gmap_link, r.source, r.created_at, r.status].map(esc).join(','));
  });
  return lines.join('\n');
}
