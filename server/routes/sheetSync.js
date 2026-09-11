// Google Sheet → Database sync API.
//
//   POST /api/admin/sync-google-sheet          → run sync, return summary
//   POST /api/admin/preview-google-sheet-sync  → dry-run diff, no writes
//
// Authentication is enforced by the adminAuth middleware mounted in index.js.
// Error kinds are mapped to HTTP codes; raw internals never reach the client.

import express from 'express';
import { syncSheet, SheetSyncError } from '../services/sheetSync.js';
import { dbHelpers } from '../db.js';
import { flushBackfill, backfillCsv } from '../services/sheetBackfill.js';

const router = express.Router();

const HTTP_BY_KIND = {
  config: 400,
  permission: 400,
  sheet_not_found: 404,
  empty_sheet: 400,
  timeout: 504,
  network: 502,
  google_api: 502,
};

function handleSyncError(res, error, fallback) {
  if (error instanceof SheetSyncError) {
    return res.status(HTTP_BY_KIND[error.kind] || 500).json({ success: false, error: error.message });
  }
  console.error('[SheetSyncRoute] Unexpected error:', error);
  return res.status(500).json({ success: false, error: fallback });
}

// ========== POST /api/admin/preview-google-sheet-sync ==========
router.post('/preview-google-sheet-sync', async (req, res) => {
  try {
    const result = await syncSheet({ triggerType: 'preview', dryRun: true });
    if (!result.success && result.error) {
      return res.status(result.error.includes('not publicly readable') ? 400 : 502).json(result);
    }
    res.json(result);
  } catch (error) {
    handleSyncError(res, error, 'Preview failed due to an unexpected server error.');
  }
});

// ========== POST /api/admin/sync-google-sheet ==========
router.post('/sync-google-sheet', async (req, res) => {
  try {
    const result = await syncSheet({ triggerType: 'manual', dryRun: false });
    if (!result.success) {
      // Validation failures are client-data problems → 400 with row details;
      // fetch/config problems → 4xx/5xx with a friendly message.
      if (result.validationErrors && result.validationErrors.length > 0) {
        return res.status(400).json({ ...result, error: `Validation failed: ${result.validationErrors[0]}` });
      }
      return res.status(result.error && result.error.includes('not publicly readable') ? 400 : 502).json(result);
    }
    res.json(result);
  } catch (error) {
    handleSyncError(res, error, 'Sync failed due to an unexpected server error.');
  }
});

// ========== POST /api/admin/sheet-backfill/flush ==========
// Push queued customer selections to the master Google Sheet (Apps Script
// webhook). Safe to call anytime — no-op when the queue is empty.
router.post('/sheet-backfill/flush', async (req, res) => {
  try {
    const result = await flushBackfill();
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('[SheetBackfillRoute] flush failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========== GET /api/admin/sheet-backfill ==========
// Queue contents for the Admin Panel card (+ CSV export query flag).
router.get('/sheet-backfill', (req, res) => {
  try {
    if (String(req.query.format) === 'csv') {
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.set('Content-Disposition', 'attachment; filename="sheet_backfill.csv"');
      return res.send(backfillCsv());
    }
    const rows = dbHelpers.getAllBackfill();
    res.json({
      rows,
      pending: rows.filter((r) => r.status === 'pending').length,
      synced: rows.filter((r) => r.status === 'synced').length,
      failed: rows.filter((r) => r.status === 'failed').length,
      configured: Boolean(process.env.SHEET_BACKFILL_WEBHOOK_URL),
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to read backfill queue', details: error.message });
  }
});

// ========== GET /api/admin/sheet-sync/status ==========
// Small status payload for the Admin Panel "Google Sheet Sync" section.
router.get('/sheet-sync/status', (req, res) => {
  try {
    const integration = dbHelpers.getIntegration();
    const file = dbHelpers.getSheetFile();
    const activeRecords = file ? dbHelpers.getActiveRecordsForFile(file.id) : [];
    const lastSync = dbHelpers.getSyncHistory(1)[0] || null;

    res.json({
      connected: Boolean(integration.drive_url || process.env.GOOGLE_SHEET_ID),
      source: process.env.GOOGLE_SHEET_ID ? 'env' : (integration.drive_url ? 'url' : 'none'),
      sheetConfigured: Boolean(integration.drive_url || process.env.GOOGLE_SHEET_ID),
      autoSyncEnabled: integration.auto_sync_enabled,
      syncFrequency: integration.sync_frequency,
      lastSyncAt: integration.last_sync_at,
      lastSyncStatus: integration.last_sync_status,
      lastSyncMessage: integration.last_sync_message,
      records: activeRecords.length,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get sheet sync status', details: error.message });
  }
});

export default router;
