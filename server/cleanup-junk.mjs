// One-off cleanup: the DB has an obsolete file entry (file_type "Google Sheets" —
// plural, so the sheet sync never matches it) holding old junk records that
// pollute the marketing tool. Deactivate them so only the synced workbook's
// catchments remain active.
import { dbHelpers } from './db.js';

const files = dbHelpers.getFiles();
const obsolete = files.filter((f) => f.file_type !== 'Google Sheet');
console.log('file entries:', files.map((f) => ({ id: f.id, type: f.file_type, records: f.records_count })));

let deactivated = 0;
for (const f of obsolete) {
  const recs = (dbHelpers.getFiles(), null);
  void recs;
  const fileRecords = (await import('./db.js')).default.data.records.filter((r) => r.file_id === f.id && r.data && r.data.is_active !== false);
  fileRecords.forEach((r) => {
    r.data.is_active = false;
    r.data.updated_at = new Date().toISOString();
    deactivated++;
  });
  f.records_count = 0;
  f.status = 'archived';
  f.updated_at = new Date().toISOString();
  console.log(`archived file ${f.id} (${f.file_type}) — deactivated ${fileRecords.length} record(s)`);
}

await dbHelpers.write();
console.log('DONE. deactivated:', deactivated);
