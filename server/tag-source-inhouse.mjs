// One-time backfill: tag every existing sheet-synced record in db.json as
// `source: 'inhouse'`. From now on the sync pipeline tags new/updated records
// automatically (see services/sheetSync.js applyDiff), so this only needs to run
// once against data that predates the source field.
//
//   node tag-source-inhouse.mjs
//
// Idempotent — safe to re-run. Only ever sets the field; never deletes data.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, 'data', 'db.json');

const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));

let tagged = 0;
for (const rec of db.records || []) {
  if (rec.data && rec.data.source !== 'inhouse') {
    rec.data.source = 'inhouse';
    tagged++;
  }
}

fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
console.log(`Tagged ${tagged} record(s) as source="inhouse". Total records: ${(db.records || []).length}`);
