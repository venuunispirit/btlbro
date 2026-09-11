/**
 * BTLbro — Sheet Backfill webhook (two-way sync, DB → Google Sheet)
 *
 * Appends customer-selected locations to the "CRM Backfill" tab of this
 * spreadsheet, with `Source` (inhouse / from google) as the LAST column.
 *
 * SETUP (5 minutes, no GCP changes, no APIs to enable):
 *   1. Open your master Google Sheet → Extensions → Apps Script
 *   2. Paste this whole file, save
 *   3. Run `setup()` once (creates the tab + headers, asks for permission)
 *   4. Deploy → New deployment → Type: Web app
 *        - Execute as: Me
 *        - Who has access: Anyone
 *      Copy the /exec URL
 *   5. Put the URL in server/.env as SHEET_BACKFILL_WEBHOOK_URL
 *      (optionally set SHEET_BACKFILL_SECRET and the same value in Script
 *       Properties as BACKFILL_SECRET)
 *
 * The BTLbro server POSTs { secret, tab, row: {Name, Type, Lat, Lng,
 * "GMap Link", Source, "Selected At"} } here; every row is appended with a
 * timestamp. Duplicate rows (same Name + Type within 6h) are skipped.
 */

var HEADERS = ['Name', 'Type', 'Lat', 'Lng', 'GMap Link', 'Source', 'Selected At'];

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('CRM Backfill') || ss.insertSheet('CRM Backfill');
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return 'CRM Backfill tab ready with headers: ' + HEADERS.join(', ');
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000); // serialize concurrent appends

    var body = JSON.parse(e.postData.contents);

    // Optional shared secret (set BACKFILL_SECRET in Script Properties)
    var expected = PropertiesService.getScriptProperties().getProperty('BACKFILL_SECRET');
    if (expected && body.secret !== expected) {
      return json_({ ok: false, error: 'bad secret' });
    }

    var row = body.row || {};
    if (!row.Name) return json_({ ok: false, error: 'missing Name' });

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(body.tab || 'CRM Backfill')
      || ss.insertSheet(body.tab || 'CRM Backfill');
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(HEADERS);
      sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }

    // Simple dedupe: same Name + Type already present → update Source instead of appending
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim().toLowerCase() === String(row.Name).trim().toLowerCase()
          && String(data[i][1]).trim().toLowerCase() === String(row.Type || '').trim().toLowerCase()) {
        sheet.getRange(i + 1, 6).setValue(row.Source || data[i][5]); // Source col
        sheet.getRange(i + 1, 7).setValue(new Date());                // Selected At
        return json_({ ok: true, action: 'updated', row: i + 1 });
      }
    }

    sheet.appendRow([
      row.Name || '',
      row.Type || '',
      row.Lat || '',
      row.Lng || '',
      row['GMap Link'] || '',
      row.Source || 'inhouse',     // ← last-column category
      row['Selected At'] ? new Date(row['Selected At']) : new Date(),
    ]);
    return json_({ ok: true, action: 'appended', row: sheet.getLastRow() });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// GET /exec → handy browser check that the web app is alive
function doGet() {
  return json_({ ok: true, service: 'BTLbro sheet backfill', tab: 'CRM Backfill' });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
