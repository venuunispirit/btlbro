// Typed error for sheet sync failures. Kept in its own module so both
// spreadsheetParser.js and sheetSync.js can throw/catch it without a
// circular import. Routes map `kind` → HTTP status codes.
export class SheetSyncError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = 'SheetSyncError';
    this.kind = kind;
  }
}
