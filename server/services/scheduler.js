// Auto-sync scheduler for the Google Sheet → Database sync.
// Checks every minute whether the configured frequency has elapsed and runs
// the same ID-based diff sync as the manual "Sync Google Sheet" button.

import cron from 'node-cron';
import { dbHelpers } from '../db.js';
import googleDriveService from './googleDriveService.js';
import { syncSheet, resolveSpreadsheetId } from './sheetSync.js';

let currentTask = null;

const FREQUENCY_CRON = {
  '5': '*/5 * * * *',
  '15': '*/15 * * * *',
  '30': '*/30 * * * *',
  '60': '0 * * * *',
  '1440': '0 0 * * *',
};

export function startScheduler() {
  console.log('[Scheduler] Starting Google Sheet auto-sync scheduler...');
  // Check every minute
  currentTask = cron.schedule('* * * * *', () => {
    checkAndSync();
  });
  console.log('[Scheduler] Scheduler started. Checking every minute.');
}

export function stopScheduler() {
  if (currentTask) {
    currentTask.stop();
    currentTask = null;
    console.log('[Scheduler] Scheduler stopped.');
  }
}

async function checkAndSync() {
  try {
    const integration = dbHelpers.getIntegration();
    if (!integration || !integration.is_connected || !integration.auto_sync_enabled) return;
    if (!resolveSpreadsheetId()) return; // nothing configured to sync

    const frequencyMinutes = parseInt(integration.sync_frequency) || 15;
    const lastSync = integration.last_sync_at ? new Date(integration.last_sync_at) : null;
    const now = new Date();

    if (!lastSync) {
      console.log('[Scheduler] No previous sync. Starting...');
      await syncSheet({ triggerType: 'scheduled' });
      return;
    }

    const minutesSince = (now - lastSync) / (1000 * 60);
    if (minutesSince >= frequencyMinutes) {
      console.log(`[Scheduler] ${Math.floor(minutesSince)}m since last sync. Starting...`);
      await syncSheet({ triggerType: 'scheduled' });
    }
  } catch (error) {
    console.error('[Scheduler] Error:', error.message);
  }
}

export default { startScheduler, stopScheduler };
