/**
 * BTLbro — Sheet Backfill webhook (two-way sync, DB → Google Sheet)
 *
 * Two modes:
 *   1. CRM Backfill (default) — appends to "CRM Backfill" tab
 *   2. Google-catchment (kind: 'google-catchment') — writes directly into
 *      a catchment tab (e.g. "Apartment services") with Source=google
 *
 * SETUP:
 *   1. Open your master Google Sheet → Extensions → Apps Script
 *   2. Paste this whole file, save
 *   3. Deploy → New deployment → Type: Web app
 *        - Execute as: Me
 *        - Who has access: Anyone
 *      Copy the /exec URL
 *   4. Put the URL in server/.env as SHEET_BACKFILL_WEBHOOK_URL
 */

var CRM_HEADERS = ['Name', 'Type', 'Lat', 'Lng', 'GMap Link', 'Source', 'Selected At'];

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('CRM Backfill') || ss.insertSheet('CRM Backfill');
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(CRM_HEADERS);
    sheet.getRange(1, 1, 1, CRM_HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return 'CRM Backfill tab ready with headers: ' + CRM_HEADERS.join(', ');
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);

    var body = JSON.parse(e.postData.contents);

    // Optional shared secret
    var expected = PropertiesService.getScriptProperties().getProperty('BACKFILL_SECRET');
    if (expected && body.secret !== expected) {
      return json_({ ok: false, error: 'bad secret' });
    }

    // Google-catchment mode: write directly into a catchment tab
    if (body.kind === 'google-catchment') {
      return googleCatchment_(body);
    }

    // Default CRM Backfill mode
    var row = body.row || {};
    if (!row.Name) return json_({ ok: false, error: 'missing Name' });

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(body.tab || 'CRM Backfill')
      || ss.insertSheet(body.tab || 'CRM Backfill');
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(CRM_HEADERS);
      sheet.getRange(1, 1, 1, CRM_HEADERS.length).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }

    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim().toLowerCase() === String(row.Name).trim().toLowerCase()
          && String(data[i][1]).trim().toLowerCase() === String(row.Type || '').trim().toLowerCase()) {
        sheet.getRange(i + 1, 6).setValue(row.Source || data[i][5]);
        sheet.getRange(i + 1, 7).setValue(new Date());
        return json_({ ok: true, action: 'updated', row: i + 1 });
      }
    }

    sheet.appendRow([
      row.Name || '',
      row.Type || '',
      row.Lat || '',
      row.Lng || '',
      row['GMap Link'] || '',
      row.Source || 'inhouse',
      row['Selected At'] ? new Date(row['Selected At']) : new Date(),
    ]);
    return json_({ ok: true, action: 'appended', row: sheet.getLastRow() });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Google-catchment mode: write/update a row in the named catchment tab.
 *
 * Strategy: read ALL rows, find header row by detecting known column keywords,
 * then find data rows. Match existing rows by base name (strip "(N)" suffix).
 * - If a google-sourced row exists → update name + coords
 * - If an inhouse row exists → skip
 * - If not found → append new row with empty service prices
 */
function googleCatchment_(body) {
  var tabName = String(body.tab || '').trim();
  var baseName = String(body.baseName || '').trim();
  var displayName = String(body.name || baseName).trim();
  var lat = Number(body.lat) || 0;
  var lng = Number(body.lng) || 0;

  if (!tabName) return json_({ ok: false, error: 'missing tab' });
  if (!baseName) return json_({ ok: false, error: 'missing baseName' });

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) return json_({ ok: false, error: 'tab_not_found: ' + tabName });

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow === 0 || lastCol === 0) {
    // Empty sheet — can't detect layout, return error
    return json_({ ok: false, error: 'empty_sheet' });
  }

  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();

  // --- Detect column positions by scanning headers ---
  // Known column names to match (case-insensitive substring)
  var nameCol = -1, slCol = -1, gmapCol = -1, latCol = -1, lngCol = -1, sourceCol = -1;

  for (var r = 0; r < Math.min(values.length, 5); r++) {
    for (var c = 0; c < values[r].length; c++) {
      var h = String(values[r][c] || '').trim().toLowerCase();
      if (!h) continue;

      // Source (must check before others to avoid false positives)
      if (sourceCol === -1 && h === 'source') {
        sourceCol = c;
        continue;
      }
      // SL number
      if (slCol === -1 && (h === 'sl no' || h === 'sl' || h === 's no' || h === 'sr no' || /^sl\s/.test(h))) {
        slCol = c;
        continue;
      }
      // GMap link
      if (gmapCol === -1 && (h.indexOf('gmap') !== -1 || h.indexOf('google map') !== -1
          || (h.indexOf('map') !== -1 && h.indexOf('link') !== -1))) {
        gmapCol = c;
        continue;
      }
      // Latitude
      if (latCol === -1 && (h === 'latittude' || h === 'latitude' || h === 'lat')) {
        latCol = c;
        continue;
      }
      // Longitude
      if (lngCol === -1 && (h === 'longitude' || h === 'lng' || h === 'long')) {
        lngCol = c;
        continue;
      }
      // Name (check AFTER specific matches to avoid false positives)
      if (nameCol === -1 && (h.indexOf('name') !== -1 || h.indexOf('apartment') !== -1
          || h.indexOf('cafe') !== -1 || h.indexOf('station') !== -1
          || h.indexOf('metro') !== -1)) {
        nameCol = c;
        continue;
      }
    }
    // Stop scanning after we've found the key columns
    if (nameCol !== -1 && gmapCol !== -1) break;
  }

  // Fallbacks for missing columns
  if (nameCol === -1) nameCol = 1; // Standard: name is column B
  if (gmapCol === -1) gmapCol = Math.max(6, lastCol - 3);
  if (latCol === -1) latCol = Math.max(7, lastCol - 2);
  if (lngCol === -1) lngCol = Math.max(8, lastCol - 1);
  if (sourceCol === -1) sourceCol = lastCol - 1;

  // --- Find data start (skip header rows) ---
  var dataStart = 0;
  for (var d = 0; d < Math.min(values.length, 5); d++) {
    var slVal = values[d][slCol];
    if (slVal !== undefined && slVal !== null && String(slVal).trim() !== '' && !isNaN(Number(slVal))) {
      dataStart = d;
      break;
    }
  }
  // If no numeric SL found, default to row 2 (0-indexed) — after 2 header rows
  if (dataStart === 0 && slCol !== -1) {
    // Check if row 0 looks like a header (non-numeric SL)
    var row0Sl = values[0] ? values[0][slCol] : '';
    if (row0Sl !== undefined && String(row0Sl).trim() !== '' && isNaN(Number(row0Sl))) {
      dataStart = 2; // Skip both header rows
    }
  }

  // Helper: strip counter suffix
  function stripCounter(name) {
    return String(name || '').replace(/\s*\(\d+\)\s*$/, '').trim();
  }

  // --- Search for existing row by base name ---
  var matchRow = -1;
  var matchSource = '';
  for (var i = dataStart; i < values.length; i++) {
    var cellName = String(values[i][nameCol] || '').trim();
    if (!cellName) continue;
    var cellBase = stripCounter(cellName);
    if (cellBase.toLowerCase() === baseName.toLowerCase()) {
      matchRow = i;
      matchSource = sourceCol !== -1 ? String(values[i][sourceCol] || '').trim().toLowerCase() : '';
      break;
    }
  }

  var gmapLink = (lat && lng) ? 'https://www.google.com/maps?q=' + lat + ',' + lng : '';

  // Found an existing row
  if (matchRow !== -1) {
    // Inhouse row → never touch
    if (matchSource.indexOf('inhouse') !== -1) {
      return json_({ ok: true, action: 'skipped_inhouse', row: matchRow + 1 });
    }

    // Google row → update name + coords
    if (nameCol !== -1) sheet.getRange(matchRow + 1, nameCol + 1).setValue(displayName);
    if (gmapCol !== -1 && gmapLink) sheet.getRange(matchRow + 1, gmapCol + 1).setValue(gmapLink);
    if (latCol !== -1) sheet.getRange(matchRow + 1, latCol + 1).setValue(lat);
    if (lngCol !== -1) sheet.getRange(matchRow + 1, lngCol + 1).setValue(lng);

    return json_({ ok: true, action: 'updated', row: matchRow + 1, name: displayName });
  }

  // --- Not found → append a new row ---
  // Find the last row with actual data
  var appendAfter = dataStart;
  for (var a = values.length - 1; a >= dataStart; a--) {
    var hasData = false;
    for (var ac = 0; ac < values[a].length; ac++) {
      if (values[a][ac] !== undefined && values[a][ac] !== null && String(values[a][ac]).trim() !== '') {
        hasData = true;
        break;
      }
    }
    if (hasData) { appendAfter = a; break; }
  }

  var newRow = new Array(lastCol).fill('');
  if (slCol !== -1) {
    var maxSl = 0;
    for (var s = dataStart; s <= appendAfter; s++) {
      var n = Number(values[s][slCol]);
      if (!isNaN(n) && n > maxSl) maxSl = n;
    }
    newRow[slCol] = maxSl + 1;
  }
  if (nameCol !== -1) newRow[nameCol] = displayName;
  if (gmapCol !== -1) newRow[gmapCol] = gmapLink;
  if (latCol !== -1) newRow[latCol] = lat;
  if (lngCol !== -1) newRow[lngCol] = lng;
  if (sourceCol !== -1) newRow[sourceCol] = 'google';

  sheet.getRange(appendAfter + 2, 1, 1, lastCol).setValues([newRow]);

  return json_({ ok: true, action: 'appended', row: appendAfter + 2, name: displayName });
}

function doGet() {
  return json_({ ok: true, service: 'BTLbro sheet backfill', tab: 'CRM Backfill' });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
