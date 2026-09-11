import { SheetSyncError } from './sheetSyncError.js';
import { parseGmapsUrl } from './geocode.js';
import * as XLSX_NS from 'xlsx';

const XLSX = XLSX_NS.default ?? XLSX_NS;

// Shared parser for public Google Sheets exports.
// Used by the sheet sync service (manual + scheduled) so that records always
// have the same shape regardless of how the sync was triggered.
//
// Column mapping supports the master sheet structure:
//   ID | Café Name | PIN Code | Distance KM | Digital Promotion | Lift Promotion |
//   Stall Space | Digital Screen | Notice Board
// and stays backward compatible with the older
//   Apartment | Distance | <prices...> layout.
//
// Rules:
// - Prices are stored as NUMBERS (10000), never "₹10,000" strings.
// - `sheet_id` preserves the external unique key (CAFE001, A-101, ...).
// - `source_row` keeps the 1-based spreadsheet row so validation errors can
//   say "Row 15: Invalid PIN Code".

export function parseSpreadsheetCSV(csvText) {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  // Parse header row
  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, '').toLowerCase());

  // Map known headers to standard field names.
  // The display-name column is resolved in a second pass (below) so an
  // explicit "…Name" header (e.g. "Apartment Name") beats a category-ish
  // header (e.g. "Apartment and other") that merely contains 'apartment'.
  const headerMap = {};
  headers.forEach((h, idx) => {
    if (h === 'id' || h === 'cafe id' || h === 'code') {
      headerMap.sheet_id = idx;
    } else if (h.includes('pin') && h.includes('code')) {
      headerMap.pin_code = idx;
    } else if (h === 'distance' || h === 'distance km' || (h.includes('distance') && h.includes('km'))) {
      headerMap.distance_km = idx;
    } else if (h.includes('digital') && h.includes('promotion')) {
      headerMap.digital_promotion = idx;
    } else if (h.includes('lift') && h.includes('promotion')) {
      headerMap.lift_promotion = idx;
    } else if (h.includes('stall')) {
      headerMap.stall_space = idx;
    } else if (h.includes('digital') && h.includes('screen')) {
      headerMap.digital_screen = idx;
    } else if (h.includes('notice') && h.includes('board')) {
      headerMap.notice_board = idx;
    } else if (h.includes('type') || h.includes('category')) {
      headerMap.type = idx;
    } else if (h.includes('address')) {
      headerMap.address = idx;
    } else if (h === 'lat' || h.includes('latitude')) {
      headerMap.lat = idx;
    } else if (h === 'lng' || h === 'lon' || h.includes('longitude')) {
      headerMap.lng = idx;
    } else if (h.includes('zone') || h.includes('area')) {
      headerMap.zone = idx;
    } else if (h.includes('city')) {
      headerMap.city = idx;
    } else if (h.includes('phone') || h.includes('contact')) {
      headerMap.phone = idx;
    }
  });

  // Name column pass 2: prefer an explicit "…name" header, else the first
  // apartment/location/venue-ish header (legacy "Apartment" layout).
  const nameish = headers
    .map((h, idx) => ({ h, idx }))
    .filter((x) => x.h.includes('apartment') || x.h.includes('name') || x.h.includes('location') || x.h.includes('venue'));
  const explicitName = nameish.find((x) => x.h.includes('name'));
  if (explicitName) headerMap.name = explicitName.idx;
  else if (nameish.length > 0) headerMap.name = nameish[0].idx;

  // Fallback: no explicit Type/Category column, but the FIRST column holds
  // category-like values ("Apartments", "Metro Stations", …) → use it as type.
  // Covers sheets whose first header is something like "Apartment and other".
  if (headerMap.type === undefined && headerMap.name !== undefined && headerMap.name !== 0) {
    const firstCol = lines.slice(1)
      .map((l) => (parseCSVLine(l)[0] || '').trim())
      .filter(Boolean);
    const CATEGORY_WORDS = ['apartment', 'corporate', 'park', 'supermarket', 'mall', 'school', 'college', 'cinema', 'tv', 'radio', 'newspaper', 'metro', 'vehicle', 'hoarding', 'cafe', 'restaurant', 'ooh'];
    if (firstCol.length >= 3 && firstCol.every((v) => CATEGORY_WORDS.some((w) => v.toLowerCase().includes(w)))) {
      headerMap.type = 0;
      console.log('[Parse] Inferred Type from first column (category-like values)');
    }
  }

  console.log(`[Parse] Headers: ${headers.join(' | ')}`);
  console.log(`[Parse] Mapped fields: ${JSON.stringify(headerMap)}`);

  // Guard: row 1 must be a real header row. If none of the known column types
  // were recognized, the sheet almost certainly starts with DATA and has no
  // header row (e.g. "Apartments,Golden Grand,…"). Fail with clear instructions
  // instead of confusing "Duplicate ID …" validation errors later.
  const recognizedKeys = [
    'sheet_id', 'pin_code', 'distance_km', 'address', 'lat', 'lng', 'zone', 'city', 'phone', 'type',
    'digital_promotion', 'lift_promotion', 'stall_space', 'digital_screen', 'notice_board',
  ];
  if (!recognizedKeys.some((k) => headerMap[k] !== undefined)) {
    throw new SheetSyncError(
      'config',
      'Row 1 must be a header row. Add headers like: Category, Name, Description, Distance, Pin Code, Digital Promotion, Lift Promotion, Stall Space, Digital Screen, Notice Board — with the data rows below them.'
    );
  }

  const records = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Simple CSV parse (handles basic quoted fields)
    const values = parseCSVLine(line);
    if (values.length === 0 || values.every(v => !v)) continue;

    // External unique key: explicit ID column (validated upstream), else fall
    // back to the name for legacy sheets without an ID column.
    const hasIdCol = headerMap.sheet_id !== undefined;
    const idCell = hasIdCol ? (values[headerMap.sheet_id] || '').trim() : '';
    const nameCol = headerMap.name !== undefined ? (values[headerMap.name] || '').trim() : '';
    const name = nameCol || idCell || `Row ${i + 1}`;
    if (!name) continue;

    // Auto-detect type from name if no type column exists
    let detectedType = headerMap.type !== undefined ? (values[headerMap.type] || '').trim() : '';
    if (!detectedType) {
      detectedType = detectTypeFromName(name);
    }

    // No explicit ID column → build a stable id from type+name so the same
    // location name under two different categories stays two distinct rows.
    const fallbackId = [detectedType, nameCol || `Row ${i + 1}`].filter(Boolean).join(' | ');

    const record = {
      id: i,
      source_row: i + 1, // 1-based spreadsheet row (header is row 1)
      sheet_id: hasIdCol ? idCell : fallbackId, // '' when ID column exists but is empty → validation error
      name: name,
      type: detectedType,
      // Tolerate "₹560,022" / "560 022" style entries — keep digits only
      pin_code: headerMap.pin_code !== undefined ? (values[headerMap.pin_code] || '').replace(/[₹,\s]/g, '') : '',
      distance_km: toNumber(values[headerMap.distance_km]),
      address: headerMap.address !== undefined ? (values[headerMap.address] || '').trim() : '',
      lat: parseFloat(values[headerMap.lat]) || 0,
      lng: parseFloat(values[headerMap.lng]) || 0,
      zone: headerMap.zone !== undefined ? (values[headerMap.zone] || '').trim() : '',
      city: headerMap.city !== undefined ? (values[headerMap.city] || '').trim() : '',
      phone: headerMap.phone !== undefined ? (values[headerMap.phone] || '').trim() : '',
    };

    // Promotion prices — ALWAYS numeric (10000), never "₹10,000"
    const priceFields = ['digital_promotion', 'lift_promotion', 'stall_space', 'digital_screen', 'notice_board'];
    priceFields.forEach(field => {
      const raw = headerMap[field] !== undefined ? values[headerMap[field]] : '';
      record[field] = toNumber(raw);
    });

    // Also store any unmapped columns as extras
    headers.forEach((h, idx) => {
      if (!Object.values(headerMap).includes(idx) && values[idx]) {
        record[h.replace(/\s+/g, '_')] = values[idx];
      }
    });

    records.push(record);
  }

  console.log(`[Parse] Parsed ${records.length} records`);
  if (records.length > 0) {
    console.log(`[Parse] Sample record: ${JSON.stringify(records[0])}`);
  }

  return records;
}

// ============================================================
// MULTI-TAB WORKBOOK PARSER (catchments)
// ============================================================
// The master workbook has one TAB per catchment ("Apartment services",
// "cafe", "metro station", …). Each tab uses a TWO-ROW header:
//
//   row 0:  sl no | <category> name | services | … | gmap link
//   row 1:        |                | notice board | standee | … |
//   row 2+: 1     | Prestige Towers| 3000         | 500     | … | https://maps…
//
// The tab name becomes the record's catchment/type. Service names come from
// row 1; the cells below them are the PRICES. Each place has a GMaps link —
// coordinates are extracted from the URL when present, otherwise the query
// text is kept for the sync to geocode (see services/geocode.js).

const HEADER_KEYWORDS = ['sl', 'name', 'services', 'service', 'gmap', 'map', 'link', 'pin', 'distance', 'address', 'notes', 'comment'];

// Tabs the backfill webhook writes into (two-way sync). Never parsed as
// catchments — otherwise every appended customer selection would be
// diffed/deactivated on the next sheet sync.
const SKIP_TAB_NAMES = ['crm backfill'];

function cellText(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

// Pick the service-price number from a cell ("₹3,000", 3000, "3000/-" …)
// and detect whether the header column actually looks like a service.
function looksLikeHeaderCell(text) {
  const t = text.toLowerCase();
  if (!t) return false;
  if (HEADER_KEYWORDS.some((k) => t === k || t.startsWith(k + ' ') || t.includes(k))) return true;
  return false;
}

export function parseWorkbook(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const records = [];
  const tabs = [];

  for (const tabName of wb.SheetNames) {
    const sheet = wb.Sheets[tabName];
    if (!sheet) continue;
    // Backfill target tab (and any future system tabs) are not catchments
    if (SKIP_TAB_NAMES.includes(tabName.toLowerCase().trim())) {
      tabs.push({ tab: tabName, records: 0, skipped: true, reason: 'backfill tab' });
      continue;
    }
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
    if (!rows.length) continue;

    const row0 = (rows[0] || []).map(cellText);
    const row1 = (rows[1] || []).map(cellText);

    // --- Locate the key columns from row 0 ---
    let slIdx = -1, nameIdx = -1, servicesIdx = -1, gmapIdx = -1, pinIdx = -1, distIdx = -1, sourceIdx = -1;
    row0.forEach((h, idx) => {
      const t = h.toLowerCase();
      if (!t) return;
      if (slIdx === -1 && (/^sl/.test(t) || t.includes('sl no') || t === 's no' || t === 'sr no')) slIdx = idx;
      else if (gmapIdx === -1 && (t.includes('gmap') || t.includes('google map') || (t.includes('map') && t.includes('link')) || t === 'link')) gmapIdx = idx;
      else if (servicesIdx === -1 && t.includes('service')) servicesIdx = idx;
      else if (pinIdx === -1 && t.includes('pin')) pinIdx = idx;
      else if (distIdx === -1 && t.includes('distance')) distIdx = idx;
      else if (nameIdx === -1 && (t.includes('name') || t.includes('station') || t.includes('cafe') || t.includes('apartment'))) nameIdx = idx;
      else if (sourceIdx === -1 && t.includes('source')) sourceIdx = idx;
    });
    // Some tabs put the "Sl No" header in row 1 instead of row 0 (metro layout)
    if (slIdx === -1 && /^sl/.test((row1[0] || '').toLowerCase())) slIdx = 0;

    // Fallbacks: name column is typically the 2nd column; gmap the last non-empty
    if (nameIdx === -1) {
      const nonEmpty = row0.map((h, i) => ({ h, i })).filter((x) => x.h);
      const candidate = nonEmpty.find((x) => x.i !== slIdx && x.i !== servicesIdx && x.i !== gmapIdx && !looksLikeHeaderCell(x.h));
      nameIdx = candidate ? candidate.i : (row0[1] !== undefined ? 1 : 0);
    }
    if (gmapIdx === -1) {
      for (let i = row0.length - 1; i >= 0; i--) {
        if (row0[i] && i !== nameIdx && i !== slIdx && i !== servicesIdx) { gmapIdx = i; break; }
      }
    }

    // --- Service names live in row 1 between the services col and the gmap col ---
    const svcStart = servicesIdx !== -1 ? servicesIdx : nameIdx + 1;
    const svcEnd = gmapIdx !== -1 ? gmapIdx : row0.length;
    let serviceCols = [];
    for (let i = svcStart; i < svcEnd; i++) {
      if (row1[i]) serviceCols.push({ idx: i, name: row1[i] });
    }

    // Single-row-header fallback: no service names in row 1 → maybe the service
    // names are plain headers in row 0 right after the name column.
    let dataStart = serviceCols.length > 0 ? 2 : 1;
    if (serviceCols.length === 0) {
      for (let i = svcStart; i < svcEnd; i++) {
        if (row0[i] && !looksLikeHeaderCell(row0[i])) serviceCols.push({ idx: i, name: row0[i] });
      }
    }

    // Does this tab even look like a catchment tab? (needs a name + at least a gmap link)
    const dataRows = rows.slice(dataStart).filter((r) => cellText((r || [])[nameIdx]));
    const hasGmap = gmapIdx !== -1 && dataRows.some((r) => String(cellText((r || [])[gmapIdx])).includes('maps'));
    if (dataRows.length === 0 || (!hasGmap && serviceCols.length === 0)) {
      tabs.push({ tab: tabName, records: 0, skipped: true });
      continue;
    }

    let count = 0;
    dataRows.forEach((r, i) => {
      r = r || [];
      const name = cellText(r[nameIdx]);
      if (!name) return;

      const type = tabName.toLowerCase();
      const gmapLink = gmapIdx !== -1 ? cellText(r[gmapIdx]) : '';

      // Coordinates straight from the URL, else keep the query text for geocoding
      let lat = 0, lng = 0, gmapQuery = '';
      if (gmapLink) {
        // Local import avoided — parseGmapsUrl is defined below in this module
        const parsed = parseGmapsUrl(gmapLink);
        lat = parsed.lat; lng = parsed.lng; gmapQuery = parsed.query;
      }

      const services = {};
      serviceCols.forEach(({ idx, name: svcName }) => {
        const key = svcName.toLowerCase().replace(/\s+/g, ' ').trim();
        if (key) services[key] = toNumber(r[idx]);
      });

      // Source column: 'google' or 'inhouse' (default)
      const rawSource = sourceIdx !== -1 ? cellText(r[sourceIdx]).toLowerCase() : '';
      const source = rawSource.includes('google') ? 'google' : 'inhouse';

      // For google-sourced rows, strip counter suffix "(N)" from name to build stable sheet_id
      const idName = source === 'google' ? name.replace(/\s+\(\d+\)\s*$/, '').trim() : name;

      records.push({
        source_row: dataStart + i + 1,
        sheet_id: `${type} | ${idName}`,
        name,
        source,
        type,
        tab_name: tabName,
        sl_no: slIdx !== -1 ? cellText(r[slIdx]) : '',
        pin_code: pinIdx !== -1 ? cellText(r[pinIdx]).replace(/[₹,\s]/g, '') : '',
        has_pin_column: pinIdx !== -1,
        distance_km: distIdx !== -1 ? toNumber(r[distIdx]) : 0,
        has_distance_column: distIdx !== -1,
        lat,
        lng,
        gmap_link: gmapLink,
        gmap_query: gmapQuery,
        services,
      });
      count++;
    });

    tabs.push({ tab: tabName, records: count, services: serviceCols.map((s) => s.name) });
    console.log(`[Parse] Tab "${tabName}": ${count} places, services: [${serviceCols.map((s) => s.name).join(', ')}]`);
  }

  console.log(`[Parse] Workbook: ${records.length} places across ${tabs.filter((t) => !t.skipped).length} tab(s)`);
  return records;
}

// Robust numeric parse — handles numbers, "10000", "₹10,000", " 8 km", "5.5"
// Returns 0 for empty/unparseable (empty price cells are treated as unpriced).
export function toNumber(raw) {
  if (raw === undefined || raw === null) return 0;
  const cleaned = String(raw).replace(/[₹,\s]/g, '');
  if (cleaned === '') return 0;
  const n = Number.parseFloat(cleaned);
  return Number.isNaN(n) ? 0 : n;
}

// Infer a location category from the record's name (prefix or keyword)
export function detectTypeFromName(name) {
  const n = (name || '').toLowerCase();
  if (n.startsWith('c-') || n.startsWith('cafe') || n.includes('cafe') || n.includes('coffee')) return 'cafe';
  if (n.startsWith('a-') || n.includes('apartment') || n.includes('apt')) return 'apartments';
  if (n.startsWith('r-') || n.includes('restaurant') || n.includes('food')) return 'restaurants';
  if (n.startsWith('s-') || n.includes('school') || n.includes('college')) return 'schools';
  if (n.startsWith('h-') || n.includes('hospital') || n.includes('clinic')) return 'hospitals';
  if (n.startsWith('m-') || n.includes('mall') || n.includes('shop') || n.includes('retail')) return 'malls';
  if (n.startsWith('o-') || n.includes('office')) return 'offices';
  if (n.startsWith('p-') || n.includes('park')) return 'parks';
  return 'apartments';
}

// Simple CSV line parse (handles basic quoted fields)
export function parseCSVLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;
  for (let c = 0; c < line.length; c++) {
    if (line[c] === '"') { inQuotes = !inQuotes; continue; }
    if (line[c] === ',' && !inQuotes) { values.push(current.trim()); current = ''; continue; }
    current += line[c];
  }
  values.push(current.trim());
  return values;
}
