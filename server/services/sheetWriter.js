// ============================================================
// SHEET WRITER — direct Google Sheets writes (no Apps Script)
// ============================================================
// Server-to-server write path for the sheet backfill queue. Authenticates as a
// Google Service Account (JWT) and writes straight into the master spreadsheet
// with the Sheets API — the webhook from sheetBackfill.js is no longer needed.
//
// Two modes (mirrors the old Apps Script in server/apps-script/SheetBackfill.gs):
//   1. google-catchment rows → upsert into a real catchment tab (e.g. "cafe")
//      with Source=google, sighting-counter name, empty prices.
//   2. Default backfill rows  → append to the "CRM Backfill" tab.
//
// Setup (one time):
//   1. Google Cloud Console → create a Service Account, enable the Sheets API.
//   2. Download its JSON key.
//   3. Share the master spreadsheet with the service-account email as Editor.
//   4. In server/.env either point GOOGLE_SERVICE_ACCOUNT_JSON at the key file,
//      or paste GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY.
//   5. Restart the server. POST /api/admin/sheet-backfill/flush now writes
//      straight to the sheet.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';
import { dbHelpers } from '../db.js';
import { buildGmapLink } from './gmapLink.js';
import { resolveSpreadsheetId } from './sheetSync.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BACKFILL_TAB = 'CRM Backfill';

// ---------- Auth ----------

function loadServiceAccount() {
  const jsonPath = (process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim();
  if (jsonPath) {
    const abs = path.isAbsolute(jsonPath) ? jsonPath : path.resolve(__dirname, '..', jsonPath);
    if (!fs.existsSync(abs)) throw new Error(`GOOGLE_SERVICE_ACCOUNT_JSON not found: ${abs}`);
    const parsed = JSON.parse(fs.readFileSync(abs, 'utf8'));
    return {
      clientEmail: parsed.client_email,
      privateKey: parsed.private_key.replace(/\\n/g, '\n'),
    };
  }
  const email = (process.env.GOOGLE_CLIENT_EMAIL || '').trim();
  const key = (process.env.GOOGLE_PRIVATE_KEY || '').trim();
  if (email && key) return { clientEmail: email, privateKey: key.replace(/\\n/g, '\n') };
  return null;
}

export function isSheetWriterConfigured() {
  return Boolean(loadServiceAccount());
}

// Lazily built JWT auth + sheets client. Never shared across requests (JWT token
// cache would be fine—but cheap to rebuild).
export function getSheetsClient() {
  const creds = loadServiceAccount();
  if (!creds) throw new Error('Sheet writer not configured: set GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_CLIENT_EMAIL/GOOGLE_PRIVATE_KEY');
  const auth = new google.auth.JWT({
    email: creds.clientEmail,
    key: creds.privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

// Resolve the spreadsheet that owns the backfill. Fall back to the sync target —
// the sheet the admin connected / GOOGLE_SHEET_ID.
export async function resolveSpreadsheetForBackfill() {
  const integration = dbHelpers.getIntegration();
  if (integration.backfill_sheet_id) return integration.backfill_sheet_id;
  return resolveSpreadsheetId();
}

// ---------- Tab / header detection (mirrors Apps Script) ----------

async function listTabs(sheets, spreadsheetId) {
  const res = await sheets.spreadsheets.get({
    spreadsheetId,
    ranges: [],
    fields: 'sheets.properties.title',
  });
  return (res.data.sheets || []).map((s) => String(s.properties && s.properties.title || ''));
}

function findTab(tabs, tabName) {
  const target = String(tabName || '').trim().toLowerCase();
  return (tabs || []).find((t) => String(t).trim().toLowerCase() === target) || null;
}

// Detect column indexes for a catchment tab by scanning the first rows' headers.
function detectColumns(values) {
  let nameCol = -1, slCol = -1, gmapCol = -1, latCol = -1, lngCol = -1, sourceCol = -1;

  for (let r = 0; r < Math.min(values.length, 6); r++) {
    for (let c = 0; c < (values[r] || []).length; c++) {
      const h = String(values[r][c] || '').trim().toLowerCase();
      if (!h) continue;
      if (sourceCol === -1 && h === 'source') { sourceCol = c; continue; }
      if (slCol === -1 && (h === 'sl no' || h === 'sl' || h === 's no' || h === 'sr no' || /^sl\s/.test(h))) { slCol = c; continue; }
      if (gmapCol === -1 && (h.includes('gmap') || h.includes('google map') || (h.includes('map') && h.includes('link')))) { gmapCol = c; continue; }
      if (latCol === -1 && (h === 'latittude' || h === 'latitude' || h === 'lat')) { latCol = c; continue; }
      if (lngCol === -1 && (h === 'longitude' || h === 'lng' || h === 'long')) { lngCol = c; continue; }
      if (nameCol === -1 && (h.includes('name') || h.includes('apartment') || h.includes('cafe') || h.includes('station') || h.includes('metro'))) { nameCol = c; continue; }
    }
    if (nameCol !== -1 && gmapCol !== -1) break;
  }

  if (nameCol === -1) nameCol = 1;
  if (gmapCol === -1) gmapCol = Math.max(6, values[0].length - 2);
  if (latCol === -1) latCol = Math.max(7, values[0].length - 1);
  if (lngCol === -1) lngCol = Math.max(8, values[0].length);
  if (sourceCol === -1) sourceCol = Math.max(values[0].length - 1, 6);

  return { nameCol, slCol, gmapCol, latCol, lngCol, sourceCol };
}

function findDataStart(values, slCol) {
  for (let d = 0; d < Math.min(values.length, 6); d++) {
    const slVal = values[d] && values[d][slCol];
    if (slVal !== undefined && slVal !== null && String(slVal).trim() !== '' && !Number.isNaN(Number(slVal))) {
      return d;
    }
  }
  return 2;
}

function stripCounter(name) {
  return String(name || '').replace(/\s*\(\d+\)\s*$/, '').trim();
}

// ---------- google-catchment upsert ----------

// Fetch a full tab's values (all rows/cols) via the API.
async function getTabValues(sheets, spreadsheetId, tab, range) {
  const reply = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tab}!${range}`,
    valueRenderOption: 'UNFORMATTED_VALUE',
    majorDimension: 'ROWS',
  });
  return reply.data.values || [];
}

// Upsert a google-catchment row into its catchment tab; source=google, empty prices.
export async function upsertGoogleCatchment({ spreadsheetId, tab, baseName, name, lat, lng }) {
  if (!spreadsheetId) throw new Error('no spreadsheet configured for backfill');
  if (!tab) throw new Error('missing tab for google-catchment write');
  if (!baseName) throw new Error('missing baseName for google-catchment write');

  const sheets = getSheetsClient();
  const tabs = await listTabs(sheets, spreadsheetId);
  const sheetName = findTab(tabs, tab);
  if (!sheetName) throw new Error(`tab_not_found: ${tab}`);

  const lastRow = (await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A1:A`,
  })).data.values || [];
  const rowCount = Math.max(lastRow.length, 1);

  // Read the whole tab once.
  let values = [];
  try {
    values = await getTabValues(sheets, spreadsheetId, sheetName, `A1:Z${Math.max(rowCount, 1)}`);
  } catch (err) {
    throw new Error(`read_tab_failed: ${err.message}`);
  }
  if (!values.length) throw new Error('empty_sheet');

  const cols = detectColumns(values);
  const { nameCol, slCol, gmapCol, latCol, lngCol, sourceCol } = cols;
  const dataStart = findDataStart(values, slCol);

  // Match existing row by base name.
  let matchRow = -1;
  let matchSource = '';
  for (let i = dataStart; i < values.length; i++) {
    const cellName = String(values[i][nameCol] || '').trim();
    if (!cellName) continue;
    if (stripCounter(cellName).toLowerCase() === baseName.toLowerCase()) {
      matchRow = i;
      matchSource = sourceCol >= 0 ? String(values[i][sourceCol] || '').trim().toLowerCase() : '';
      break;
    }
  }

  const display = String(name || baseName || '').trim();
  const gmapLink = buildGmapLink({ name: display, lat, lng });

  // Existing inhouse row → never touch.
  if (matchRow !== -1 && matchSource.includes('inhouse')) {
    return { action: 'skipped_inhouse', row: matchRow + 1 };
  }

  if (matchRow !== -1) {
    // Update name + coords (single batch call).
    const updates = [];
    const cell = (r, c) => `${sheetName}!${String.fromCharCode(64 + c + 1)}${r + 1}`;
    updates.push({ range: cell(matchRow, nameCol), values: [[display]] });
    if (gmapLink) updates.push({ range: cell(matchRow, gmapCol), values: [[gmapLink]] });
    if (lat) updates.push({ range: cell(matchRow, latCol), values: [[lat]] });
    if (lng) updates.push({ range: cell(matchRow, lngCol), values: [[lng]] });
    updates.push({ range: cell(matchRow, sourceCol), values: [['from google']] });
    await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, resource: { valueInputOption: 'USER_ENTERED', data: updates } });
    return { action: 'updated', row: matchRow + 1, name: stripCounter(display) };
  }

  // Find last row with any data so we append cleanly below it.
  let appendAfter = dataStart;
  for (let a = values.length - 1; a >= dataStart; a--) {
    if ((values[a] || []).some((v) => String(v ?? '').trim() !== '')) { appendAfter = a; break; }
  }
  const lastCol = Math.max(...values.map((r) => r.length), 1);
  let maxSl = 0;
  for (let s = dataStart; s <= appendAfter; s++) {
    const n = Number(values[s][slCol]);
    if (!Number.isNaN(n) && n > maxSl) maxSl = n;
  }
  const newRow = new Array(lastCol).fill('');
  if (slCol >= 0) newRow[slCol] = maxSl + 1;
  newRow[nameCol] = display;
  if (gmapCol >= 0) newRow[gmapCol] = gmapLink;
  if (latCol >= 0) newRow[latCol] = lat || '';
  if (lngCol >= 0) newRow[lngCol] = lng || '';
  if (sourceCol >= 0) newRow[sourceCol] = 'from google';

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A${appendAfter + 2}:${String.fromCharCode(64 + lastCol)}${appendAfter + 2}`,
    valueInputOption: 'USER_ENTERED',
    resource: { values: [newRow] },
  });
  return { action: 'appended', row: appendAfter + 2, name: stripCounter(display) };
}

function displayName(name) {
  return String(name || '').trim();
}

// ---------- CRM Backfill tab ----------

// Ensure the "CRM Backfill" tab exists with a header row.
async function ensureBackfillTab(sheets, spreadsheetId) {
  const tabs = await listTabs(sheets, spreadsheetId);
  if (findTab(tabs, BACKFILL_TAB)) return;

  // Create the tab.
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    resource: {
      requests: [{ addSheet: { properties: { title: BACKFILL_TAB } } }],
    },
  });
  const headers = ['Name', 'Type', 'Lat', 'Lng', 'GMap Link', 'Source', 'Selected At'];
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${BACKFILL_TAB}!A1:G1`,
    valueInputOption: 'USER_ENTERED',
    resource: { values: [headers] },
  });
}

// Append a default (CRM) backfill row.
export async function appendCrmRow({ spreadsheetId, row }) {
  if (!spreadsheetId) throw new Error('no spreadsheet configured for backfill');
  const sheets = getSheetsClient();
  await ensureBackfillTab(sheets, spreadsheetId);

  const values = [[
    row.name || '',
    row.type || '',
    row.lat || '',
    row.lng || '',
    row.gmap_link || '',
    row.source || 'inhouse',
    row.created_at || new Date().toISOString(),
  ]];
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${BACKFILL_TAB}!A1`,
    valueInputOption: 'USER_ENTERED',
    resource: { values },
  });
  return { action: 'appended' };
}

// ---------- Test connectivity ----------

export async function testConnection() {
  try {
    const sheets = getSheetsClient();
    const spreadsheetId = await resolveSpreadsheetForBackfill();
    if (!spreadsheetId) return { ok: false, error: 'No spreadsheet configured (GOOGLE_SHEET_ID or Admin → Drive URL).' };
    const tabs = await listTabs(sheets, spreadsheetId);
    return { ok: true, spreadsheetId, tabs: tabs.slice(0, 50), tabCount: tabs.length };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}