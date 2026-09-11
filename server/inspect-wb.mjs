// Temp inspection script — dump all tabs of the connected workbook.
import * as NS from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';

const XLSX = NS.default ?? NS; // CJS interop: readFile may live on default
const dir = path.dirname(fileURLToPath(import.meta.url));
const wb = XLSX.readFile(path.join(dir, 'workbook.xlsx'));
console.log('TABS:', JSON.stringify(wb.SheetNames));
for (const name of wb.SheetNames) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true });
  console.log('=== TAB:', JSON.stringify(name), '| rows:', rows.length, '| cols:', rows[0]?.length ?? 0);
  rows.slice(0, 4).forEach((r, i) => console.log('  r' + i + ':', JSON.stringify(r).slice(0, 600)));
}
