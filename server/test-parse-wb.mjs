// Temp test — parse the real workbook and inspect the resulting records.
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseWorkbook } from './services/spreadsheetParser.js';
import { geocodeRecords } from './services/sheetSync.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const buf = readFileSync(path.join(dir, 'workbook.xlsx'));

const records = parseWorkbook(buf);
console.log('TOTAL:', records.length);
const byType = {};
records.forEach((r) => { byType[r.type] = (byType[r.type] || 0) + 1; });
console.log('BY TAB:', JSON.stringify(byType));

console.log('\nSample records:');
records.filter((_, i) => i % 20 === 0).forEach((r) => {
  console.log(JSON.stringify({ sheet_id: r.sheet_id, sl: r.sl_no, lat: r.lat, lng: r.lng, query: r.gmap_query.slice(0, 50), services: r.services }));
});

// Quick geocode test with a small budget (5 records)
console.log('\n--- geocoding 5 places (budget 30s) ---');
const sample = records.filter((r) => r.gmap_query).slice(0, 5);
const geo = await geocodeRecords(sample, 30000);
console.log('geocode result:', JSON.stringify(geo));
sample.forEach((r) => console.log(`  ${r.name.slice(0, 40)} → ${r.lat},${r.lng}`));
