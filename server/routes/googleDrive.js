import express from 'express';
import { dbHelpers } from '../db.js';
import googleDriveService from '../services/googleDriveService.js';
import { syncSheet } from '../services/sheetSync.js';
import { parseSpreadsheetCSV } from '../services/spreadsheetParser.js';
const router = express.Router();

// ========== GET /api/admin/google-drive/status ==========
router.get('/status', (req, res) => {
  try {
    const integration = dbHelpers.getIntegration();
    const stats = dbHelpers.getRecordStats();
    const lastSync = dbHelpers.getSyncHistory(1)[0] || null;

    res.json({
      connected: integration.is_connected,
      driveUrl: integration.drive_url,
      folderId: integration.folder_id,
      autoSyncEnabled: integration.auto_sync_enabled,
      syncFrequency: integration.sync_frequency,
      lastSyncAt: integration.last_sync_at,
      lastSyncStatus: integration.last_sync_status,
      lastSyncMessage: integration.last_sync_message,
      filesFound: stats.totalFiles,
      recordsImported: stats.totalRecords,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get status', details: error.message });
  }
});

// ========== POST /api/admin/google-drive/connect ==========
router.post('/connect', async (req, res) => {
  try {
    const { driveUrl } = req.body;
    if (!driveUrl) {
      return res.status(400).json({ error: 'Google Drive URL is required' });
    }

    const integration = dbHelpers.getIntegration();
    const spreadsheetId = extractSpreadsheetId(driveUrl);
    const folderId = extractFolderId(driveUrl);

    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      if (spreadsheetId) {
        // Public spreadsheet — try fetching CSV to verify it works
        try {
          const testUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv`;
          const response = await fetch(testUrl, { redirect: 'follow' });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const csv = await response.text();
          const lines = csv.trim().split('\n');

          dbHelpers.updateIntegration({
            drive_url: driveUrl,
            folder_id: spreadsheetId,
            is_connected: true,
            files_found: 1,
          });

          return res.json({
            connected: true,
            mode: 'spreadsheet',
            spreadsheetId,
            filesFound: 1,
            rowCount: Math.max(0, lines.length - 1),
            message: `Connected to spreadsheet! Found ${lines.length - 1} rows.`,
          });
        } catch (fetchErr) {
          return res.status(400).json({ error: 'Cannot access spreadsheet', details: 'Make sure the spreadsheet is shared as "Anyone with the link can view"', fetchError: fetchErr.message });
        }
      }

      // Not a spreadsheet — fallback to demo mode
      dbHelpers.updateIntegration({
        drive_url: driveUrl,
        folder_id: folderId || 'demo',
        is_connected: true,
      });
      return res.json({
        connected: true,
        mode: 'demo',
        folderId: folderId || 'demo',
        message: 'Connected in demo mode. For live data, paste a Google Sheets URL.',
      });
    }

    if (!integration.access_token) {
      const authUrl = googleDriveService.getAuthUrl();
      return res.json({ connected: false, authRequired: true, authUrl, message: 'Google authorization required.' });
    }

    googleDriveService.setCredentials(integration.access_token, integration.refresh_token);
    const effectiveFolderId = spreadsheetId || folderId;
    if (!effectiveFolderId) {
      return res.status(400).json({ error: 'Invalid Google Drive URL format' });
    }

    const connectionCheck = await googleDriveService.verifyConnection();
    if (!connectionCheck.connected) {
      return res.status(400).json({ error: 'Failed to connect', details: connectionCheck.error });
    }

    const files = await googleDriveService.listFiles(effectiveFolderId);
    dbHelpers.updateIntegration({
      drive_url: driveUrl,
      folder_id: effectiveFolderId,
      is_connected: true,
      files_found: files.length,
    });

    res.json({ connected: true, folderId: effectiveFolderId, filesFound: files.length, user: connectionCheck.user, message: `Connected! Found ${files.length} files.` });
  } catch (error) {
    res.status(500).json({ error: 'Connection failed', details: error.message });
  }
});

// ========== GET /api/admin/google-drive/callback ==========
router.get('/callback', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).send('Authorization code missing');

    const tokens = await googleDriveService.getTokensFromCode(code);
    dbHelpers.updateIntegration({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expiry: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
    });
    res.redirect('/admin');
  } catch (error) {
    res.status(500).send('Authentication failed: ' + error.message);
  }
});

// ========== POST /api/admin/google-drive/sync ==========
router.post('/sync', async (req, res) => {
  try {
    const integration = dbHelpers.getIntegration();
    if (!integration.is_connected) {
      return res.status(400).json({ error: 'Not connected to Google Drive' });
    }

    const syncId = dbHelpers.addSyncHistory({ status: 'running', trigger_type: req.body.triggerType || 'manual' });

    // Check if this is a Google Spreadsheet URL
    const spreadsheetId = extractSpreadsheetId(integration.drive_url);

    if (spreadsheetId) {
      // ===== ID-BASED DIFF SYNC (no API needed for public sheets) =====
      // Delegates to the shared service: validate all → diff → atomic apply.
      const result = await syncSheet({ triggerType: req.body.triggerType || 'manual' });
      if (!result.success) {
        const status = result.validationErrors && result.validationErrors.length > 0 ? 400 : 502;
        return res.status(status).json({
          error: result.error || 'Sheet sync failed',
          validationErrors: result.validationErrors || [],
          warnings: result.warnings || [],
        });
      }
      return res.json({
        success: true,
        mode: 'spreadsheet',
        filesFound: 1,
        recordsImported: result.added + result.updated + result.unchanged,
        added: result.added,
        updated: result.updated,
        unchanged: result.unchanged,
        deactivated: result.deactivated,
        message: `Synced: +${result.added} added, ${result.updated} updated, ${result.deactivated} deactivated, ${result.unchanged} unchanged`,
      });
    }

    // ===== DEMO MODE (no real URL, no API credentials) =====
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      const demoFiles = generateDemoFiles();
      dbHelpers.clearFiles();
      let totalRecords = 0;

      for (const file of demoFiles) {
        const saved = dbHelpers.addFile({
          file_id: file.id,
          file_name: file.name,
          file_type: file.type,
          mime_type: file.mimeType,
          file_size: file.size,
          drive_url: null,
          last_modified: file.lastModified,
          records_count: file.records,
          status: 'synced',
          sync_batch_id: syncId,
        });

        if (file.records > 0) {
          const records = generateDemoRecords(file.name, file.records);
          dbHelpers.addRecords(saved.id, records);
          totalRecords += records.length;
        }
      }

      dbHelpers.updateIntegration({
        last_sync_at: new Date().toISOString(),
        last_sync_status: 'success',
        last_sync_message: 'Demo sync completed',
        files_found: demoFiles.length,
        records_imported: totalRecords,
      });
      dbHelpers.updateSyncHistory(syncId, { status: 'success', files_found: demoFiles.length, records_imported: totalRecords });

      return res.json({ success: true, mode: 'demo', filesFound: demoFiles.length, recordsImported: totalRecords, message: `Demo sync: ${demoFiles.length} files, ${totalRecords} records` });
    }

    // ===== REAL Google Drive sync (with API credentials) =====
    googleDriveService.setCredentials(integration.access_token, integration.refresh_token);
    const files = await googleDriveService.listFiles(integration.folder_id);
    dbHelpers.clearFiles();
    let totalRecords = 0;
    let filesSynced = 0;

    for (const file of files) {
      try {
        const records = await googleDriveService.getFileRecords(file.id, file.name, file.mimeType);
        const saved = dbHelpers.addFile({
          file_id: file.id, file_name: file.name, file_type: getFileType(file.name, file.mimeType),
          mime_type: file.mimeType, file_size: parseInt(file.size || 0), last_modified: file.modifiedTime,
          records_count: records.length, status: 'synced', sync_batch_id: syncId,
        });
        dbHelpers.addRecords(saved.id, records);
        totalRecords += records.length;
        filesSynced++;
      } catch (fileError) {
        dbHelpers.addSyncError(syncId, { file_id: file.id, file_name: file.name, error_type: 'file_sync_error', error_message: fileError.message });
      }
    }

    dbHelpers.updateIntegration({ last_sync_at: new Date().toISOString(), last_sync_status: 'success', last_sync_message: `Synced ${filesSynced}/${files.length} files`, files_found: filesSynced, records_imported: totalRecords });
    dbHelpers.updateSyncHistory(syncId, { status: 'success', files_found: filesSynced, records_imported: totalRecords });

    res.json({ success: true, filesFound: filesSynced, recordsImported: totalRecords, message: `Sync: ${filesSynced} files, ${totalRecords} records` });
  } catch (error) {
    const integration = dbHelpers.getIntegration();
    dbHelpers.updateIntegration({ last_sync_at: new Date().toISOString(), last_sync_status: 'error', last_sync_message: error.message });
    res.status(500).json({ error: 'Sync failed', details: error.message });
  }
});

// ========== GET /api/admin/google-drive/files ==========
router.get('/files', (req, res) => {
  try {
    const files = dbHelpers.getFiles();
    res.json({ files });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get files', details: error.message });
  }
});

// ========== GET /api/admin/google-drive/data/:fileDbId ==========
router.get('/data/:fileDbId', (req, res) => {
  try {
    const { fileDbId } = req.params;
    const { page = 1, limit = 50, search = '' } = req.query;

    const file = dbHelpers.getFileById(parseInt(fileDbId));
    if (!file) return res.status(404).json({ error: 'File not found' });

    const result = dbHelpers.getFileRecords(parseInt(fileDbId), parseInt(page), parseInt(limit), search);
    const parsedRecords = result.records.map(r => ({ id: r.id, row: r.row_index, ...(r.data || {}) }));

    res.json({ file, records: parsedRecords, pagination: result.pagination });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get data', details: error.message });
  }
});

// ========== GET /api/admin/google-drive/sync-history ==========
router.get('/sync-history', (req, res) => {
  try {
    const history = dbHelpers.getSyncHistory();
    res.json({ history });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get history', details: error.message });
  }
});

// ========== PUT /api/admin/google-drive/settings ==========
router.put('/settings', (req, res) => {
  try {
    const { autoSyncEnabled, syncFrequency } = req.body;
    const updates = {};
    if (autoSyncEnabled !== undefined) updates.auto_sync_enabled = autoSyncEnabled;
    if (syncFrequency) updates.sync_frequency = syncFrequency;
    dbHelpers.updateIntegration(updates);

    const integration = dbHelpers.getIntegration();
    res.json({ success: true, autoSyncEnabled: integration.auto_sync_enabled, syncFrequency: integration.sync_frequency });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update settings', details: error.message });
  }
});

// ========== DELETE /api/admin/google-drive/disconnect ==========
router.delete('/disconnect', (req, res) => {
  try {
    dbHelpers.updateIntegration({
      is_connected: false, drive_url: null, folder_id: null,
      access_token: null, refresh_token: null, token_expiry: null,
      auto_sync_enabled: false,
    });
    dbHelpers.clearFiles();
    res.json({ success: true, message: 'Disconnected from Google Drive' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to disconnect', details: error.message });
  }
});

// ========== HELPERS ==========

// Extract spreadsheet ID from Google Sheets URL
function extractSpreadsheetId(url) {
  if (!url) return null;
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

// Extract folder ID from Google Drive URL
function extractFolderId(url) {
  if (!url) return null;
  // Spreadsheet URL
  const ssMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (ssMatch) return ssMatch[1];
  // Folder URL
  const folderMatch = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch) return folderMatch[1];
  // File URL
  const fileMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch) return fileMatch[1];
  return null;
}

function getFileType(fileName) {
  if (fileName.endsWith('.csv')) return 'CSV';
  if (fileName.match(/\.xlsx?$/)) return 'Excel';
  if (fileName.endsWith('.pdf')) return 'PDF';
  if (fileName.match(/\.docx?$/)) return 'Document';
  if (fileName.endsWith('.txt')) return 'Text';
  return 'Other';
}


function generateDemoFiles() {
  const now = new Date().toISOString();
  const yesterday = new Date(Date.now() - 86400000).toISOString();
  return [
    { id: 'demo_1', name: 'users.xlsx', type: 'Excel', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 45056, lastModified: now, records: 500 },
    { id: 'demo_2', name: 'sales_data.csv', type: 'CSV', mimeType: 'text/csv', size: 32768, lastModified: now, records: 750 },
    { id: 'demo_3', name: 'apartments_list.csv', type: 'CSV', mimeType: 'text/csv', size: 16384, lastModified: yesterday, records: 200 },
    { id: 'demo_4', name: 'cafe_locations.csv', type: 'CSV', mimeType: 'text/csv', size: 8192, lastModified: yesterday, records: 150 },
    { id: 'demo_5', name: 'marketing_report.pdf', type: 'PDF', mimeType: 'application/pdf', size: 1048576, lastModified: new Date(Date.now() - 172800000).toISOString(), records: 0 },
    { id: 'demo_6', name: 'campaign_budget.xlsx', type: 'Excel', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 24576, lastModified: now, records: 120 },
  ];
}

function generateDemoRecords(fileName, count) {
  const names = ['Green Valley Apts', 'Blue Tokai Cafe', 'D-Mart Store', 'Apollo Hospital', 'DMart Retail', 'Reliance Fresh', 'Park View School', 'Sunrise Apartments', 'Coffee Day', 'Dominos Pizza'];
  const zones = ['Koramangala', 'Indiranagar', 'HSR Layout', 'BTM Layout', 'Whitefield', 'JP Nagar', 'Electronic City'];
  const cities = ['Bangalore', 'Mumbai', 'Delhi', 'Chennai', 'Hyderabad'];
  const records = [];

  for (let i = 0; i < count; i++) {
    if (fileName.includes('user')) {
      records.push({ id: i + 1, name: names[i % names.length], email: `user${i + 1}@example.com`, phone: `+91 98765 ${String(40000 + i).padStart(5, '0')}`, city: cities[i % cities.length], status: i % 3 === 0 ? 'active' : 'inactive' });
    } else if (fileName.includes('sale') || fileName.includes('budget')) {
      records.push({ id: i + 1, date: new Date(Date.now() - Math.random() * 30 * 86400000).toISOString().split('T')[0], product: `Product ${String.fromCharCode(65 + (i % 26))}${i + 1}`, amount: Math.floor(Math.random() * 50000) + 1000, zone: zones[i % zones.length], quantity: Math.floor(Math.random() * 100) + 1 });
    } else if (fileName.includes('apartment')) {
      records.push({ id: i + 1, name: `A-${String(101 + i).padStart(3, '0')}`, type: 'apartments', address: `${100 + i} Main Road`, lat: (12.9 + Math.random() * 0.1).toFixed(4), lng: (77.5 + Math.random() * 0.1).toFixed(4), zone: zones[i % zones.length], city: cities[0], digital_promotion: 10000 + i * 200, lift_promotion: 15000 + i * 200, stall_space: 20000 + i * 200, digital_screen: 12000 + i * 200, notice_board: 8000 + i * 200 });
    } else if (fileName.includes('cafe')) {
      records.push({ id: i + 1, name: `C-${String(101 + i).padStart(3, '0')}`, type: 'cafe', address: `${200 + i} Main Road`, lat: (12.9 + Math.random() * 0.1).toFixed(4), lng: (77.5 + Math.random() * 0.1).toFixed(4), zone: zones[i % zones.length], city: cities[0], digital_promotion: 8000 + i * 200, lift_promotion: 12000 + i * 200, stall_space: 16000 + i * 200, digital_screen: 10000 + i * 200, notice_board: 6000 + i * 200 });
    } else {
      records.push({ id: i + 1, name: `Record ${i + 1}`, category: ['Marketing', 'Sales', 'Operations'][i % 3] });
    }
  }
  return records;
}

export default router;
