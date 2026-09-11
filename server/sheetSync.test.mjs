// End-to-end test of the sheet sync service using a local mock of the Google
// Sheets CSV export. Exercises: initial import, update/rename, no-op sync,
// deactivation, re-activation, validation failure atomicity, duplicate
// detection, preview, and legacy sheet parsing.
//
// Strategy: copy the real sources into a temp dir inside server/ with the db
// path patched, so node_modules resolution still works and the REAL
// server/data/db.json is never touched.

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Mock Google Sheets CSV export server ---
let currentCsv = '';
const mock = http.createServer((req, res) => {
  if (req.url.includes('/export')) {
    res.writeHead(200, { 'Content-Type': 'text/csv' });
    res.end(currentCsv);
  } else {
    res.writeHead(404);
    res.end('nope');
  }
});
await new Promise((r) => mock.listen(0, '127.0.0.1', r));
const mockPort = mock.address().port;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (String(url).includes('docs.google.com')) {
    return originalFetch(`http://127.0.0.1:${mockPort}/export?format=csv`, opts);
  }
  return originalFetch(url, opts);
};

// --- Build temp module tree with patched db path ---
const tmpDir = path.join(__dirname, '.test-run');
fs.rmSync(tmpDir, { recursive: true, force: true });
fs.mkdirSync(path.join(tmpDir, 'services'), { recursive: true });

const dbSource = fs.readFileSync(path.join(__dirname, 'db.js'), 'utf8')
  .replace(`path.join(__dirname, 'data')`, `path.join(__dirname, 'test-data')`);
fs.writeFileSync(path.join(tmpDir, 'db.js'), dbSource);

// sheetSync imports ../db.js (temp) and ./spreadsheetParser.js (copied as-is)
const ssSource = fs.readFileSync(path.join(__dirname, 'services', 'sheetSync.js'), 'utf8');
fs.writeFileSync(path.join(tmpDir, 'services', 'sheetSync.js'), ssSource);
fs.copyFileSync(path.join(__dirname, 'services', 'spreadsheetParser.js'), path.join(tmpDir, 'services', 'spreadsheetParser.js'));
for (const f of ['sheetSyncError.js', 'geocode.js']) fs.copyFileSync(path.join(__dirname, 'services', f), path.join(tmpDir, 'services', f));

const { dbHelpers, default: db } = await import(pathToFileURL(path.join(tmpDir, 'db.js')));
const sheetSync = await import(pathToFileURL(path.join(tmpDir, 'services', 'sheetSync.js')));
const parser = await import(pathToFileURL(path.join(tmpDir, 'services', 'spreadsheetParser.js')));

// Seed integration state (drive_url points anywhere; fetch is mocked)
Object.assign(db.data.integration, {
  drive_url: 'https://docs.google.com/spreadsheets/d/MOCKSHEET123/edit',
  is_connected: true,
});
dbHelpers.write();

let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${extra}`); }
}

const HEADERS = 'ID,Café Name,PIN Code,Distance KM,Digital Promotion,Lift Promotion,Stall Space,Digital Screen,Notice Board';
const row = (id, name, pin, dist, dp, lp, ss, ds, nb) => `${id},${name},${pin},${dist},${dp},${lp},${ss},${ds},${nb}`;

console.log('\n== Test 1: Initial import (3 cafés) ==');
currentCsv = [HEADERS, row('CAFE001', 'Café A', '560001', 5, 10000, 15000, 20000, 12000, 8000), row('CAFE002', 'Café B', '560034', 8, 12000, 17000, 22000, 14000, 9000), row('CAFE003', 'Café C', '560038', 4, 9000, 14000, 19000, 11000, 7000)].join('\n');
let r = await sheetSync.syncSheet({ triggerType: 'manual' });
check('success', r.success, JSON.stringify(r).slice(0, 200));
check('added 3', r.added === 3, `got ${r.added}`);
check('updated 0', r.updated === 0);
check('deactivated 0', r.deactivated === 0);
let file1 = dbHelpers.getSheetFile();
let recs1 = dbHelpers.getActiveRecordsForFile(file1.id);
check('3 active records in DB', recs1.length === 3, `got ${recs1.length}`);
check('price stored numeric', recs1[0].data.digital_promotion === 10000, `got ${JSON.stringify(recs1[0].data.digital_promotion)}`);
check('sheet_id preserved', recs1[0].data.sheet_id === 'CAFE001');
check('pin stored', recs1[0].data.pin_code === '560001');
check('distance numeric', recs1[0].data.distance_km === 5);

console.log('\n== Test 2: Rename + price update, add 1, remove 1 ==');
currentCsv = [HEADERS, row('CAFE001', 'ABC Coffee House', '560001', 5, 10000, 15000, 20000, 12000, 8000), row('CAFE002', 'Café B', '560034', 8, 15000, 17000, 22000, 14000, 9000), row('CAFE004', 'New Café', '560076', 10, 14000, 19000, 24000, 16000, 10000)].join('\n');
r = await sheetSync.syncSheet({ triggerType: 'manual' });
check('success', r.success);
check('added 1 (CAFE004)', r.added === 1, `got ${r.added}`);
check('updated 2 (rename + price)', r.updated === 2, `got ${r.updated}`);
check('unchanged 0', r.unchanged === 0);
check('deactivated 1 (CAFE003)', r.deactivated === 1, `got ${r.deactivated}`);
let active2 = dbHelpers.getActiveRecordsForFile(file1.id);
check('3 active after sync', active2.length === 3, `got ${active2.length}`);
const renamed = active2.find(x => x.data.sheet_id === 'CAFE001');
check('rename updated (no duplicate)', renamed && renamed.data.name === 'ABC Coffee House', `got ${renamed && renamed.data.name}`);
const priceUpd = active2.find(x => x.data.sheet_id === 'CAFE002');
check('price 12000→15000', priceUpd.data.digital_promotion === 15000, `got ${priceUpd.data.digital_promotion}`);
check('CAFE003 kept but inactive (soft delete)', db.data.records.length === 4, `total=${db.data.records.length}`);

console.log('\n== Test 3: No-op sync ==');
r = await sheetSync.syncSheet({ triggerType: 'manual' });
check('success', r.success);
check('added 0', r.added === 0, `got ${r.added}`);
check('updated 0', r.updated === 0, `got ${r.updated}`);
check('unchanged 3', r.unchanged === 3, `got ${r.unchanged}`);
check('deactivated 0', r.deactivated === 0);

console.log('\n== Test 4: Re-adding CAFE003 re-activates the row ==');
currentCsv = [HEADERS, row('CAFE001', 'ABC Coffee House', '560001', 5, 10000, 15000, 20000, 12000, 8000), row('CAFE002', 'Café B', '560034', 8, 15000, 17000, 22000, 14000, 9000), row('CAFE004', 'New Café', '560076', 10, 14000, 19000, 24000, 16000, 10000), row('CAFE003', 'Café C', '560038', 4, 9000, 14000, 19000, 11000, 7000)].join('\n');
r = await sheetSync.syncSheet({ triggerType: 'manual' });
check('CAFE003 re-activated as UPDATE', r.updated === 1 && r.added === 0, `added=${r.added} updated=${r.updated}`);
check('4 active now', dbHelpers.getActiveRecordsForFile(file1.id).length === 4);

console.log('\n== Test 5: Validation failure blocks sync (atomicity) ==');
const snapshot = JSON.stringify(db.data.records);
currentCsv = [HEADERS, row('CAFE001', 'Café A', '560001', 5, 10000, 15000, 20000, 12000, 8000), row('CAFE002', 'Bad Pin', '1234', 8, 15000, 17000, 22000, 14000, 9000), row('', 'No ID', '560038', 4, 9000, 14000, 19000, 11000, 7000)].join('\n');
r = await sheetSync.syncSheet({ triggerType: 'manual' });
check('fails', r.success === false);
check('row errors reported', r.validationErrors && r.validationErrors.length >= 2, JSON.stringify(r.validationErrors));
check('mentions invalid PIN', r.validationErrors.some(e => e.includes('Invalid PIN Code')));
check('DB untouched (atomic)', JSON.stringify(db.data.records) === snapshot);

console.log('\n== Test 6: Duplicate ID detection ==');
currentCsv = [HEADERS, row('CAFE001', 'Café A', '560001', 5, 10000, 15000, 20000, 12000, 8000), row('CAFE001', 'Copy Cat', '560002', 6, 11000, 16000, 21000, 13000, 8500)].join('\n');
r = await sheetSync.syncSheet({ triggerType: 'manual' });
check('fails on duplicate', r.success === false);
check('duplicate message', r.validationErrors.some(e => e.includes('Duplicate ID CAFE001')), JSON.stringify(r.validationErrors));

console.log('\n== Test 7: Preview (dry run) makes no changes ==');
currentCsv = [HEADERS, row('CAFE099', 'Brand New', '560100', 12, 15000, 20000, 25000, 17000, 11000)].join('\n');
r = await sheetSync.syncSheet({ triggerType: 'preview', dryRun: true });
check('preview success', r.success);
check('preview sees 1 add + 4 deactivate', r.added === 1 && r.deactivated === 4, `added=${r.added} deact=${r.deactivated}`);
check('preview has change details', r.changes && r.changes.added.length === 1 && r.changes.added[0].sheet_id === 'CAFE099');
check('DB untouched by preview', dbHelpers.getActiveRecordsForFile(file1.id).length === 4);
const hist = dbHelpers.getSyncHistory(3);
check('preview recorded in history', hist.some(h => h.status === 'preview'));

console.log('\n== Test 8: Old-style sheet (no ID column) still works ==');
currentCsv = 'Apartment,Distance,Digital Promotion,Lift Promotion\nA-201,3,"₹10,000","₹15,000"\n';
const parsed = parser.parseSpreadsheetCSV(currentCsv);
check('name used as sheet_id fallback', parsed[0].sheet_id === 'A-201', `got ${parsed[0].sheet_id}`);
check('₹10,000 parsed as 10000', parsed[0].digital_promotion === 10000, `got ${parsed[0].digital_promotion}`);

// Cleanup
mock.close();
globalThis.fetch = originalFetch;
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(`\n${'='.repeat(40)}\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
