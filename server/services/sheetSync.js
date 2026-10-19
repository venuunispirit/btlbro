// Google Sheet → Database synchronization service.
//
// Implements the master-prompt flow:
//   Fetch CSV → parse → VALIDATE ALL ROWS → diff against DB
//   → insert new / update changed / deactivate removed → atomic write.
//
// lowdb holds the whole dataset in memory and writes a single JSON file, so a
// full diff + one db.write() at the end is our "transaction": nothing is
// persisted unless the whole sync succeeds.
//
// The Google Sheet is the master source of truth. Manual DB edits are
// overwritten on the next sync. Removed rows are DEACTIVATED (isActive=false),
// never hard-deleted, to prevent accidental data loss.

import { dbHelpers } from '../db.js';
import { parseSpreadsheetCSV, parseWorkbook } from './spreadsheetParser.js';
import { SheetSyncError } from './sheetSyncError.js';
import { geocodePlaceVariants } from './geocode.js';

// Fields compared during diff (name is compared too: renaming CAFE001 must
// update the existing record, not create a new one).
// `services` holds the dynamic per-catchment service prices — compared as JSON.
const DIFF_FIELDS = [
  'name', 'type', 'pin_code', 'distance_km', 'address', 'zone', 'city', 'phone', 'lat', 'lng',
  'gmap_link', 'services', 'source',
  'digital_promotion', 'lift_promotion', 'stall_space', 'digital_screen', 'notice_board',
];

const PIN_CODE_RE = /^[1-9][0-9]{5}$/;

// ---------- Fetch ----------

// Resolve the spreadsheet to sync: env var takes precedence, then the admin's
// connected Drive URL. Never hard-code the Sheet ID in source.
export function resolveSpreadsheetId() {
  const fromEnv = (process.env.GOOGLE_SHEET_ID || '').trim();
  if (fromEnv) return fromEnv;
  const integration = dbHelpers.getIntegration();
  const url = integration.drive_url || '';
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

// Worksheet selection: GOOGLE_SHEET_GID (env) or ?gid= in the stored URL.
// Public CSV export supports single-worksheet fetch via gid.
export function resolveSheetGid() {
  const fromEnv = (process.env.GOOGLE_SHEET_GID || '').trim();
  if (fromEnv) return fromEnv;
  const integration = dbHelpers.getIntegration();
  const match = (integration.drive_url || '').match(/[?#&]gid=([0-9]+)/);
  return match ? match[1] : '0';
}

export async function fetchSheetCsv(spreadsheetId, gid) {
  // Same data via two Google endpoints — when Google throttles the plain
  // /export endpoint (intermittent HTTP 400/429 bursts), the gviz endpoint
  // often still works (separate rate-limit pool).
  const TARGETS = [
    {
      label: 'export',
      url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${encodeURIComponent(gid)}`,
      attempts: 2,
    },
    {
      label: 'gviz',
      url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&gid=${encodeURIComponent(gid)}`,
      attempts: 2,
    },
  ];
  const RETRY_STATUS = new Set([400, 408, 429, 500, 502, 503, 504]);
  let lastStatus = null;

  for (const target of TARGETS) {
    for (let attempt = 1; attempt <= target.attempts; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000); // network/timeout guard
      let response;
      try {
        response = await fetch(target.url, {
          redirect: 'follow',
          signal: controller.signal,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BTLbroSync/1.0)' },
        });
      } catch (err) {
        clearTimeout(timeout);
        if (attempt < target.attempts) {
          await new Promise((r) => setTimeout(r, 2000 * attempt)); // 2s, 4s backoff
          continue;
        }
        if (err.name === 'AbortError') throw new SheetSyncError('timeout', 'Google Sheets did not respond within 20 seconds.');
        throw new SheetSyncError('network', `Could not reach Google Sheets: ${err.message}`);
      }
      clearTimeout(timeout);

      if (response.ok) {
        const csv = await response.text();
        // Google returns an HTML login page for non-public sheets — detect it.
        if (csv.trimStart().startsWith('<')) {
          throw new SheetSyncError('permission', 'The sheet is not publicly readable. Share it as "Anyone with the link can view".');
        }
        console.log(`[SheetSync] Fetched CSV via ${target.label} endpoint`);
        return csv;
      }

      if (response.status === 404) throw new SheetSyncError('sheet_not_found', 'Sheet not found. Check GOOGLE_SHEET_ID / the connected URL.');
      if (response.status === 401 || response.status === 403) {
        throw new SheetSyncError('permission', 'Permission denied. Share the sheet as "Anyone with the link can view".');
      }

      lastStatus = response.status;
      // Transient Google error → retry with backoff, then fall through to the next endpoint
      if (RETRY_STATUS.has(response.status) && attempt < target.attempts) {
        console.warn(`[SheetSync] ${target.label} attempt ${attempt} failed (HTTP ${response.status}) — retrying…`);
        await new Promise((r) => setTimeout(r, 2000 * attempt)); // 2s, 4s backoff
        continue;
      }
    }
  }

  throw new SheetSyncError('google_api', `Google Sheets export failed (HTTP ${lastStatus}) on both endpoints. This is usually temporary rate limiting — try again in a minute.`);
}

// Fetch the ENTIRE workbook (every tab) as XLSX. Each tab is a catchment
// ("Apartment services", "cafe", "metro station"…) parsed by parseWorkbook.
// Retries transient Google failures; on final failure callers fall back to the
// legacy single-tab CSV fetch (fetchSheetCsv).
export async function fetchWorkbook(spreadsheetId) {
  const ATTEMPTS = 5;
  const RETRY_STATUS = new Set([400, 408, 429, 500, 502, 503, 504]);
  const MIN_SIZE = 50000; // A real workbook with any data is >50KB; throttled responses are ~17KB
  let lastStatus = null;

  // Two Google endpoints to try — they use separate rate-limit pools
  const TARGETS = [
    { label: 'export', base: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export` },
    { label: 'gviz', base: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq` },
  ];

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const target = TARGETS[(attempt - 1) % TARGETS.length];
    const cacheBuster = `_nocache=${Date.now()}`;
    const url = target.label === 'export'
      ? `${target.base}?format=xlsx&${cacheBuster}`
      : `${target.base}?tqx=out:xlsx&${cacheBuster}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    let response;
    try {
      response = await fetch(url, {
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; BTLbroSync/1.0)',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
        },
      });
    } catch (err) {
      clearTimeout(timeout);
      if (attempt < ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 3000 * attempt));
        continue;
      }
      if (err.name === 'AbortError') throw new SheetSyncError('timeout', 'Google Sheets did not respond within 30 seconds.');
      throw new SheetSyncError('network', `Could not reach Google Sheets: ${err.message}`);
    }
    clearTimeout(timeout);

    if (response.ok) {
      const buf = Buffer.from(await response.arrayBuffer());
      // Google returns an HTML login page for non-public sheets — detect it.
      if (buf.length > 0 && buf[0] === 0x3c /* '<' */) {
        throw new SheetSyncError('permission', 'The sheet is not publicly readable. Share it as "Anyone with the link can view".');
      }
      // Google sometimes returns a truncated/partial XLSX when rate-limiting (~17KB vs 180KB+).
      if (buf.length < MIN_SIZE && attempt < ATTEMPTS) {
        console.warn(`[SheetSync] ${target.label} attempt ${attempt} returned truncated response (${buf.length} bytes < ${MIN_SIZE}) — retrying with ${TARGETS[attempt % TARGETS.length].label}…`);
        await new Promise((r) => setTimeout(r, 3000 * attempt));
        continue;
      }
      console.log(`[SheetSync] Fetched workbook via ${target.label} (${buf.length} bytes)`);
      return buf;
    }

    if (response.status === 404) throw new SheetSyncError('sheet_not_found', 'Sheet not found. Check GOOGLE_SHEET_ID / the connected URL.');
    if (response.status === 401 || response.status === 403) {
      throw new SheetSyncError('permission', 'Permission denied. Share the sheet as "Anyone with the link can view".');
    }

    lastStatus = response.status;
    if (RETRY_STATUS.has(response.status) && attempt < ATTEMPTS) {
      console.warn(`[SheetSync] workbook attempt ${attempt} failed (HTTP ${response.status}) — retrying…`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }

  throw new SheetSyncError('google_api', `Google Sheets export failed (HTTP ${lastStatus}) after ${ATTEMPTS} attempts. This is usually temporary rate limiting — try again in a minute.`);
}

// ---------- Validation ----------

// Validates every row. Returns { errors, warnings }. Sync is stopped when
// `errors` is non-empty — invalid data must never partially corrupt the DB.
export function validateRecords(records) {
  const errors = [];
  const warnings = [];
  const seenIds = new Map();

  records.forEach((rec) => {
    const row = rec.source_row;
    const tab = rec.tab_name ? `Tab "${rec.tab_name}", ` : '';
    const where = `${tab}row ${row}`;
    const id = (rec.sheet_id || '').trim();
    if (!id) {
      errors.push(`${where}: ID is required`);
      return;
    }
    if (seenIds.has(id)) {
      errors.push(`${where}: Duplicate ID ${id} found in Google Sheet (also on ${seenIds.get(id)})`);
      return;
    }
    seenIds.set(id, where);

    if (!rec.name || !rec.name.trim()) errors.push(`${where}: Name is required`);

    // PIN code: only relevant when the sheet actually has a PIN column
    const pin = (rec.pin_code || '').trim();
    if (rec.has_pin_column) {
      if (pin) {
        if (!PIN_CODE_RE.test(pin)) errors.push(`${where}: Invalid PIN Code "${pin}"`);
      } else {
        warnings.push(`${where}: PIN Code is empty`);
      }
    }

    // Distance: only validated when the sheet provides a Distance column —
    // otherwise it is computed at runtime from the PIN code's nominal point.
    if (rec.has_distance_column) {
      const d = rec.distance_km;
      if (d == null || Number.isNaN(d) || d < 0) errors.push(`${where}: Distance KM must be a number >= 0`);
    }

    // Dynamic catchment services ("notice board", "standee", "train branding"…)
    if (rec.services && typeof rec.services === 'object') {
      Object.entries(rec.services).forEach(([svc, v]) => {
        if (v == null || Number.isNaN(Number(v)) || Number(v) < 0) {
          errors.push(`${where}: ${svc} must be a number >= 0`);
        }
      });
    }

    // Legacy flat price columns (single-tab sheets) — validated when present
    ['digital_promotion', 'lift_promotion', 'stall_space', 'digital_screen', 'notice_board'].forEach((p) => {
      if (rec[p] === undefined) return;
      const v = rec[p];
      if (v == null || Number.isNaN(v) || v < 0) errors.push(`${where}: ${p.replace(/_/g, ' ')} must be a number >= 0`);
    });
  });

  return { errors, warnings };
}

// ---------- Geocoding ----------

// Fill in lat/lng for places whose GMaps link has no embedded coordinates,
// by geocoding the link's place query via Nominatim (rate-limited, cached).
// A time budget keeps each sync responsive; remaining places are geocoded on
// subsequent sync runs (results are cached forever, so this converges fast).
export async function geocodeRecords(records, budgetMs = 60000) {
  const pending = records.filter((r) => !(r.lat && r.lng) && r.gmap_query);
  if (pending.length === 0) return { geocoded: 0, failed: 0 };

  const startedAt = Date.now();
  let geocoded = 0;
  let failed = 0;

  for (const rec of pending) {
    if (Date.now() - startedAt > budgetMs) {
      console.log(`[Geocode] Time budget reached — ${pending.length - geocoded - failed} place(s) will be geocoded on the next sync`);
      break;
    }
    const hit = await geocodePlaceVariants(rec.gmap_query);
    if (hit) {
      rec.lat = hit.lat;
      rec.lng = hit.lng;
      geocoded++;
    } else {
      failed++;
      console.warn(`[Geocode] Could not locate: "${rec.gmap_query}"`);
    }
  }

  if (geocoded || failed) console.log(`[Geocode] Resolved ${geocoded} place(s), ${failed} not found`);
  return { geocoded, failed };
}

// ---------- Diff ----------

// Compares validated sheet records against ACTIVE db records (matched by
// sheet_id). Returns { toAdd, toUpdate, unchanged, toDeactivate, changedFields }.
export function computeDiff(sheetRecords, activeDbRecords, inactiveDbRecords = []) {
  const dbBySheetId = new Map(activeDbRecords.map((r) => [r.data.sheet_id, r]));
  const inactiveBySheetId = new Map(inactiveDbRecords.map((r) => [r.data.sheet_id, r]));
  const seenSheetIds = new Set();

  const toAdd = [];
  const toUpdate = [];
  const toReactivate = [];
  let unchanged = 0;

  for (const rec of sheetRecords) {
    const key = rec.sheet_id;
    seenSheetIds.add(key);
    const existing = dbBySheetId.get(key);

    // Row exists in DB but is deactivated → reactivate it (unique row per ID,
    // keeps created_at history instead of piling duplicates).
    if (!existing && inactiveBySheetId.has(key)) {
      toReactivate.push({ record: inactiveBySheetId.get(key), data: rec });
      continue;
    }

    if (!existing) {
      toAdd.push(rec);
      continue;
    }

    const changes = {};
    let hasChange = false;
    for (const field of DIFF_FIELDS) {
      const nextVal = rec[field];
      const curVal = existing.data[field];
      // Compare canonically: numbers as numbers, objects (services) as JSON,
      // everything else as trimmed strings
      const same = typeof nextVal === 'number' || typeof curVal === 'number'
        ? Number(nextVal || 0) === Number(curVal || 0)
        : typeof nextVal === 'object' || typeof curVal === 'object'
          ? JSON.stringify(nextVal ?? null) === JSON.stringify(curVal ?? null)
          : String(nextVal ?? '').trim() === String(curVal ?? '').trim();
      if (!same) {
        changes[field] = { from: curVal ?? null, to: nextVal };
        hasChange = true;
      }
    }
    if (hasChange) toUpdate.push({ record: existing, data: rec, changes });
    else unchanged++;
  }

  // In DB but not in the sheet → deactivate (never hard-delete).
  // CRM-backfill rows added by the Marketing Tool are exempt: they exist in the
  // DB before the sheet write lands, so deactivating them here would wipe the
  // row we just surfaced. Once the sheet catches up they match by sheet_id and
  // are reconciled normally.
  const toDeactivate = activeDbRecords
    .filter((r) => !seenSheetIds.has(r.data.sheet_id) && r.data.crm_backfill !== true)
    .map((r) => ({ record: r, sheet_id: r.data.sheet_id, name: r.data.name }));

  return { toAdd, toUpdate, toReactivate, unchanged, toDeactivate };
}

// ---------- Apply (single atomic write) ----------

// Applies the diff and persists ONCE at the end. On lowdb this is the
// transaction boundary: an exception before db.write() leaves the DB untouched.
export function applyDiff({ toAdd, toUpdate, toReactivate = [], toDeactivate }, fileId, syncId) {
  const now = new Date().toISOString();
  let added = 0;
  let updated = 0;
  let deactivated = 0;

  for (const rec of toAdd) {
    const { source_row, ...data } = rec;
    data.is_active = true;
    data.sheet_id = data.sheet_id || data.name;
    data.source = rec.source || 'inhouse';
    // Google-sourced rows need a recee visit to verify venue/prices before selling
    if ((data.source || '').toLowerCase().includes('google')) {
      data.needs_recee = true;
      if (!data.recee_status) data.recee_status = 'pending';
    }
    data.created_at = now;
    data.updated_at = now;
    dbHelpers.appendRecord(fileId, data, syncId);
    added++;
  }

  for (const { record, data } of toUpdate) {
    const { source_row, ...incoming } = data;
    Object.assign(record.data, incoming, {
      is_active: true,
      source: incoming.source || record.data.source || 'inhouse',
      updated_at: now,
    });
    // Google rows always need recee; keep an existing in_progress/done unless unset
    if ((record.data.source || '').toLowerCase().includes('google')) {
      record.data.needs_recee = true;
      if (!record.data.recee_status) record.data.recee_status = 'pending';
    }
    updated++;
  }

  for (const { record } of toDeactivate) {
    record.data.is_active = false;
    record.data.updated_at = now;
    deactivated++;
  }

  // Reactivated rows count as updates (they appear in the sheet again)
  for (const { record, data } of toReactivate) {
    const { source_row, ...incoming } = data;
    Object.assign(record.data, incoming, {
      is_active: true,
      source: incoming.source || record.data.source || 'inhouse',
      updated_at: now,
    });
    if ((record.data.source || '').toLowerCase().includes('google')) {
      record.data.needs_recee = true;
      if (!record.data.recee_status) record.data.recee_status = 'pending';
    }
    updated++;
  }

  if (added || updated || deactivated) {
    dbHelpers.write(); // single atomic persist
  }
  return { added, updated, deactivated };
}

// ---------- Full sync orchestration ----------

// Runs fetch → validate → diff → apply → history. Returns a summary:
// { success, added, updated, unchanged, deactivated, errors, lastSync }
export async function syncSheet({ triggerType = 'manual', dryRun = false } = {}) {
  console.log(`[SheetSync] Started (${triggerType}${dryRun ? ', preview' : ''})`);
  const syncId = dbHelpers.addSyncHistory({ status: 'running', trigger_type: dryRun ? 'preview' : triggerType });
  const startedAt = new Date().toISOString();

  try {
    const spreadsheetId = resolveSpreadsheetId();
    if (!spreadsheetId) {
      throw new SheetSyncError('config', 'No Google Sheet configured. Connect a Sheet URL in the Admin Panel or set GOOGLE_SHEET_ID.');
    }

    // Preferred path: fetch the whole WORKBOOK (all tabs = all catchments).
    // Fallback: legacy single-tab CSV export for simple sheets.
    let records;
    let sourceSize = 0;
    try {
      const buf = await fetchWorkbook(spreadsheetId);
      sourceSize = buf.length;
      records = parseWorkbook(buf);
    } catch (err) {
      if (err instanceof SheetSyncError && ['permission', 'sheet_not_found', 'timeout'].includes(err.code)) throw err;
      console.warn(`[SheetSync] Workbook path failed (${err.message}) — falling back to single-tab CSV`);
      const gid = resolveSheetGid();
      const csv = await fetchSheetCsv(spreadsheetId, gid);
      sourceSize = csv.length;
      records = parseSpreadsheetCSV(csv);
    }
    console.log(`[SheetSync] Parsed ${records.length} rows`);
    if (records.length === 0) {
      throw new SheetSyncError('empty_sheet', 'The sheet has no data rows (header only or empty).');
    }

    // Preserve previously geocoded coordinates: the fresh parse starts every
    // record at lat/lng 0, and the diff would otherwise OVERWRITE real
    // coordinates with zeros whenever this run's geocode budget didn't reach
    // a record. Seeds from the DB first, then only geocode what's still missing.
    const existingFile = dbHelpers.getSheetFile();
    if (existingFile) {
      const prevBySheetId = new Map(dbHelpers.getActiveRecordsForFile(existingFile.id).map((r) => [r.data.sheet_id, r.data]));
      let preserved = 0;
      records.forEach((rec) => {
        if (!(rec.lat && rec.lng)) {
          const prev = prevBySheetId.get(rec.sheet_id);
          if (prev && prev.lat && prev.lng) {
            rec.lat = prev.lat;
            rec.lng = prev.lng;
            preserved++;
          }
        }
      });
      if (preserved) console.log(`[SheetSync] Preserved ${preserved} previously geocoded coordinate(s)`);
    }

    // Resolve place coordinates from GMaps links (budgeted, cached across syncs)
    const geoBudget = triggerType === 'scheduled' ? 45000 : 120000;
    const geo = await geocodeRecords(records, geoBudget);

    const { errors, warnings } = validateRecords(records);
    if (geo.failed > 0) {
      warnings.push(`${geo.failed} place(s) could not be located on the map — check their GMaps links`);
    }
    console.log(`[SheetSync] Validation: ${errors.length} errors, ${warnings.length} warnings`);
    if (errors.length > 0) {
      // Stop BEFORE touching the DB — no partial updates on invalid data.
      dbHelpers.updateSyncHistory(syncId, { status: 'validation_failed', error_message: errors.slice(0, 5).join('; '), completed_at: new Date().toISOString() });
      return { success: false, validationErrors: errors, warnings, added: 0, updated: 0, unchanged: 0, deactivated: 0, lastSync: startedAt };
    }

    // Current DB records live under the sheet's file entry
    const file = dbHelpers.getSheetFile();
    const activeRecords = file ? dbHelpers.getActiveRecordsForFile(file.id) : [];
    const inactiveRecords = file ? dbHelpers.getInactiveRecordsForFile(file.id) : [];
    const diff = computeDiff(records, activeRecords, inactiveRecords);
    console.log(`[SheetSync] Diff: +${diff.toAdd.length} ~${diff.toUpdate.length + diff.toReactivate.length} =${diff.unchanged} -${diff.toDeactivate.length}`);

    const result = {
      success: true,
      added: diff.toAdd.length,
      updated: diff.toUpdate.length,
      unchanged: diff.unchanged,
      deactivated: diff.toDeactivate.length,
      errors: 0,
      validationErrors: [],
      warnings,
      changes: dryRun ? buildChangePreview(diff) : undefined,
      lastSync: startedAt,
    };

    if (!dryRun) {
      // Ensure the file entry exists, then apply + one atomic write
      const fileId = dbHelpers.ensureSheetFile(spreadsheetId, sourceSize, records.length, syncId);
      const applied = applyDiff(diff, fileId, syncId);
      result.added = applied.added;
      result.updated = applied.updated;
      result.deactivated = applied.deactivated;

      // records_count must reflect the post-apply state (ensureSheetFile
      // snapshots it BEFORE the diff is applied)
      const sheetFile = dbHelpers.getFileById(fileId);
      if (sheetFile) {
        sheetFile.records_count = dbHelpers.getActiveRecordsForFile(fileId).length;
        sheetFile.file_name = `Google Sheet (${sheetFile.records_count} records)`;
        dbHelpers.write();
      }

      dbHelpers.updateIntegration({
        last_sync_at: new Date().toISOString(),
        last_sync_status: 'success',
        last_sync_message: `Sync: +${applied.added} added, ${applied.updated} updated, ${applied.deactivated} deactivated, ${result.unchanged} unchanged`,
        files_found: 1,
        records_imported: dbHelpers.getActiveRecordsForFile(fileId).length,
      });
      console.log(`[SheetSync] Completed: +${applied.added} ~${applied.updated} =${result.unchanged} -${applied.deactivated}`);
    } else {
      console.log('[SheetSync] Preview completed (no changes written)');
    }

    dbHelpers.updateSyncHistory(syncId, {
      status: dryRun ? 'preview' : 'success',
      files_found: 1,
      records_imported: result.added + result.updated + result.unchanged,
      added: result.added,
      updated: result.updated,
      unchanged: result.unchanged,
      deactivated: result.deactivated,
      error_message: warnings.length ? `${warnings.length} warning(s)` : '',
      completed_at: new Date().toISOString(),
    });

    return result;
  } catch (error) {
    const friendly = error instanceof SheetSyncError ? error.message : 'Sync failed due to an unexpected server error.';
    console.error(`[SheetSync] Failed:`, error instanceof SheetSyncError ? error.message : error);
    dbHelpers.updateIntegration({ last_sync_at: new Date().toISOString(), last_sync_status: 'error', last_sync_message: friendly });
    dbHelpers.updateSyncHistory(syncId, { status: 'failed', error_message: friendly, completed_at: new Date().toISOString() });
    return { success: false, error: friendly, added: 0, updated: 0, unchanged: 0, deactivated: 0, lastSync: startedAt };
  }
}

// Human-readable change list for the Preview modal
function buildChangePreview(diff) {
  return {
    added: diff.toAdd.map((r) => ({ sheet_id: r.sheet_id, name: r.name })),
    updated: diff.toUpdate.map((u) => ({
      sheet_id: u.record.data.sheet_id,
      name: u.data.name,
      fields: Object.entries(u.changes).map(([field, c]) => ({ field, from: c.from, to: c.to })),
    })),
    deactivated: diff.toDeactivate.map((d) => ({ sheet_id: d.sheet_id, name: d.name })),
  };
}

// SheetSyncError lives in its own module (shared with the parser to avoid a
// circular import) and is re-exported here for the routes.
export { SheetSyncError };
