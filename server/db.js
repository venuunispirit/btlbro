import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, 'data');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const defaultData = {
  integration: {
    id: 1,
    drive_url: null,
    folder_id: null,
    access_token: null,
    refresh_token: null,
    token_expiry: null,
    is_connected: false,
    auto_sync_enabled: false,
    sync_frequency: '15',
    last_sync_at: null,
    last_sync_status: null,
    last_sync_message: null,
    files_found: 0,
    records_imported: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  files: [],
  records: [],
  sync_history: [],
  sync_errors: [],
  orders: [],
  users: [],
  sessions: [],
  carts: [],
  wishlists: [],
  shop_orders: [],
  products: [],
  site_content: {},
  settings: {
    per_location_price: 0,
    agency_fee: 10,
    payment: {
      gateway_enabled: false,
      gateway_provider: 'razorpay',
      min_amount: 1,
      key_id: '',
      key_secret: '',
      currency: 'INR',
    },
    store: {
      min_order_amount: 0,
      shipping_flat: 0,
      gst_rate: 18,
    },
  },
};

const file = path.join(dataDir, 'db.json');
const adapter = new JSONFile(file);
const db = new Low(adapter, defaultData);

// Read or initialize database
await db.read();
if (!db.data) {
  db.data = defaultData;
  await db.write();
}

// Helper functions that mimic SQL operations
export const dbHelpers = {
  // Get integration settings
  getIntegration() {
    return db.data.integration;
  },

  // Update integration settings
  updateIntegration(updates) {
    Object.assign(db.data.integration, updates, { updated_at: new Date().toISOString() });
    return db.write();
  },

  // Get all files
  getFiles() {
    return db.data.files || [];
  },

  // Add a file
  addFile(fileData) {
    const id = Math.max(0, ...db.data.files.map(f => f.id || 0)) + 1;
    const record = { ...fileData, id, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    db.data.files.push(record);
    return { id, ...record };
  },

  // Clear all files
  clearFiles() {
    db.data.files = [];
    db.data.records = [];
    return db.write();
  },

  // Get records for a file
  getFileRecords(fileId, page = 1, limit = 50, search = '') {
    let records = (db.data.records || []).filter(r => r.file_id === fileId);

    // Hide records deactivated by sheet sync unless explicitly requested
    const includeInactive = search === '__all__';
    if (includeInactive) {
      search = '';
    } else {
      records = records.filter(r => !(r.data && r.data.is_active === false));
    }

    if (search) {
      const q = search.toLowerCase();
      records = records.filter(r => {
        const dataStr = JSON.stringify(r.data || {}).toLowerCase();
        return dataStr.includes(q);
      });
    }

    const total = records.length;
    const start = (page - 1) * limit;
    const paginated = records.slice(start, start + limit);

    return {
      records: paginated,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  },

  // Add records for a file
  addRecords(fileId, records) {
    let rowIndex = 0;
    const existingCount = db.data.records.filter(r => r.file_id === fileId).length;
    for (const record of records) {
      db.data.records.push({
        id: db.data.records.length + 1,
        file_id: fileId,
        row_index: existingCount + rowIndex,
        data: record,
        created_at: new Date().toISOString(),
      });
      rowIndex++;
    }
    return db.write();
  },

  // Get a single file by id
  getFileById(id) {
    return db.data.files.find(f => f.id === id);
  },

  // Get total record count
  getRecordStats() {
    const files = db.data.files || [];
    const totalFiles = files.length;
    const totalRecords = files.reduce((sum, f) => sum + (f.records_count || 0), 0);
    return { totalFiles, totalRecords };
  },

  // ===== Google Sheet sync helpers =====

  // The file entry representing the connected Google Sheet (source of truth)
  getSheetFile() {
    return (db.data.files || []).find(f => f.mime_type === 'text/csv' && f.file_type === 'Google Sheet') || null;
  },

  // All records for a file that are currently active (present in the Sheet)
  getActiveRecordsForFile(fileId) {
    return (db.data.records || []).filter(r => r.file_id === fileId && r.data && r.data.is_active !== false);
  },

  // All records for a file that were deactivated by a previous sync
  getInactiveRecordsForFile(fileId) {
    return (db.data.records || []).filter(r => r.file_id === fileId && r.data && r.data.is_active === false);
  },

  // Push a record into memory WITHOUT writing (used inside a sync transaction)
  appendRecord(fileId, data, syncId) {
    const record = {
      id: db.data.records.length + 1,
      file_id: fileId,
      row_index: db.data.records.filter(r => r.file_id === fileId).length,
      data,
      created_at: new Date().toISOString(),
    };
    if (syncId) record.sync_batch_id = syncId;
    db.data.records.push(record);
    return record;
  },

  // Find-or-create the Sheet file entry and refresh its metadata
  ensureSheetFile(spreadsheetId, csvSize, recordsCount, syncId) {
    let file = dbHelpers.getSheetFile();
    const now = new Date().toISOString();
    if (!file) {
      const id = Math.max(0, ...(db.data.files || []).map(f => f.id || 0)) + 1;
      file = {
        id,
        file_id: spreadsheetId,
        file_name: `Google Sheet (${recordsCount} records)`,
        file_type: 'Google Sheet',
        mime_type: 'text/csv',
        file_size: csvSize,
        drive_url: db.data.integration.drive_url || null,
        last_modified: now,
        records_count: recordsCount,
        status: 'synced',
        sync_batch_id: syncId,
        created_at: now,
        updated_at: now,
      };
      db.data.files.push(file);
    } else {
      Object.assign(file, {
        file_id: spreadsheetId,
        file_size: csvSize,
        drive_url: db.data.integration.drive_url || file.drive_url,
        last_modified: now,
        records_count: db.data.records.filter(r => r.file_id === file.id && r.data && r.data.is_active !== false).length,
        status: 'synced',
        sync_batch_id: syncId,
        updated_at: now,
      });
    }
    return file.id;
  },

  // Add sync history entry
  addSyncHistory(entry) {
    const id = Math.max(0, ...(db.data.sync_history || []).map(h => h.id || 0)) + 1;
    const record = { ...entry, id, started_at: new Date().toISOString(), admin: 'Admin' };
    db.data.sync_history.push(record);
    db.write();
    return id;
  },

  // Update sync history entry
  updateSyncHistory(id, updates) {
    const entry = db.data.sync_history.find(h => h.id === id);
    if (entry) {
      Object.assign(entry, updates, { completed_at: new Date().toISOString() });
      db.write();
    }
    return entry;
  },

  // Get sync history
  getSyncHistory(limit = 50) {
    return (db.data.sync_history || []).slice().reverse().slice(0, limit);
  },

  // ===== Customer orders (persisted in db.json — travel with the project) =====

  getOrders() {
    return db.data.orders || [];
  },

  addOrder(order) {
    if (!db.data.orders) db.data.orders = [];
    const id = Math.max(0, ...db.data.orders.map(o => o.id || 0)) + 1;
    const record = { ...order, id, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    db.data.orders.push(record);
    db.write();
    return record;
  },

  updateOrder(id, updates) {
    const order = (db.data.orders || []).find(o => o.id === Number(id));
    if (order) {
      Object.assign(order, updates, { updated_at: new Date().toISOString() });
      db.write();
    }
    return order;
  },

  deleteOrder(id) {
    if (!db.data.orders) db.data.orders = [];
    db.data.orders = db.data.orders.filter(o => o.id !== Number(id));
    return db.write();
  },

  // ===== Admin settings (agency fee, per-location price) =====

  getSettings() {
    if (!db.data.settings) db.data.settings = { per_location_price: 0, agency_fee: 10 };
    return db.data.settings;
  },

  updateSettings(updates) {
    if (!db.data.settings) db.data.settings = { per_location_price: 0, agency_fee: 10 };
    const clean = {};
    if (typeof updates.agency_fee === 'number' && !isNaN(updates.agency_fee)) clean.agency_fee = updates.agency_fee;
    if (typeof updates.per_location_price === 'number' && !isNaN(updates.per_location_price)) clean.per_location_price = updates.per_location_price;
    Object.assign(db.data.settings, clean, { updated_at: new Date().toISOString() });
    db.write();
    return db.data.settings;
  },

  // ===== Shop: users, sessions, carts, wishlists, shop orders =====

  getUserByEmail(email) {
    return (db.data.users || []).find((u) => u.email === String(email).toLowerCase());
  },

  getUserById(id) {
    return (db.data.users || []).find((u) => u.id === id);
  },

  // ===== Team members (staff users with roles) =====
  getTeamMembers() {
    return (db.data.users || []).filter((u) => u.is_team).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  },

  // Staff list compatible with /api/auth/me shape but includes role metadata.
  getStaffUserById(id) {
    const u = dbHelpers.getUserById(id);
    return u && u.is_team ? u : null;
  },

  addUser({ name, email, password_salt, password_hash, phone, designation, role, is_team }) {
    if (!db.data.users) db.data.users = [];
    const user = {
      id: Math.max(0, ...db.data.users.map((u) => u.id || 0)) + 1,
      name, email: String(email).toLowerCase(), password_salt, password_hash,
      phone: phone || '',
      designation: designation || '',
      role: role || 'member',
      is_team: !!is_team,
      is_active: true,
      created_at: new Date().toISOString(),
    };
    db.data.users.push(user);
    db.write();
    return user;
  },

  updateUser(id, updates) {
    const user = (db.data.users || []).find((u) => u.id === Number(id));
    if (!user) return null;
    Object.assign(user, updates, { updated_at: new Date().toISOString() });
    db.write();
    return user;
  },

  getSession(token) {
    const s = (db.data.sessions || []).find((s) => s.token === token);
    if (!s) return null;
    if (new Date(s.expires_at) < new Date()) return null; // expired
    return s;
  },

  addSession(session) {
    if (!db.data.sessions) db.data.sessions = [];
    db.data.sessions.push(session);
    db.write();
    return session;
  },

  deleteSession(token) {
    if (!db.data.sessions) db.data.sessions = [];
    db.data.sessions = db.data.sessions.filter((s) => s.token !== token);
    return db.write();
  },

  getCart(userId) {
    return (db.data.carts || []).find((c) => c.user_id === userId)?.items || [];
  },

  setCart(userId, items) {
    if (!db.data.carts) db.data.carts = [];
    let entry = db.data.carts.find((c) => c.user_id === userId);
    if (entry) { entry.items = items; entry.updated_at = new Date().toISOString(); }
    else db.data.carts.push({ user_id: userId, items, updated_at: new Date().toISOString() });
    db.write();
    return items;
  },

  getWishlist(userId) {
    return (db.data.wishlists || []).find((w) => w.user_id === userId)?.items || [];
  },

  setWishlist(userId, items) {
    if (!db.data.wishlists) db.data.wishlists = [];
    let entry = db.data.wishlists.find((w) => w.user_id === userId);
    if (entry) { entry.items = items; entry.updated_at = new Date().toISOString(); }
    else db.data.wishlists.push({ user_id: userId, items, updated_at: new Date().toISOString() });
    db.write();
    return items;
  },

  addShopOrder(order) {
    if (!db.data.shop_orders) db.data.shop_orders = [];
    const record = {
      id: Math.max(0, ...db.data.shop_orders.map((o) => o.id || 0)) + 1,
      ...order,
      created_at: new Date().toISOString(),
    };
    db.data.shop_orders.push(record);
    db.write();
    return record;
  },

  updateShopOrder(id, updates) {
    const order = (db.data.shop_orders || []).find((o) => o.id === Number(id));
    if (order) {
      Object.assign(order, updates);
      db.write();
    }
    return order;
  },

  getShopOrdersByUser(userId) {
    return (db.data.shop_orders || []).filter((o) => o.user_id === userId).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  },

  // ===== Sheet backfill queue (customer selections → Google Sheet) =====

  // All queued rows (oldest first)
  getAllBackfill() {
    return db.data.backfill || [];
  },

  // Rows still waiting to be pushed to the sheet
  getPendingBackfill() {
    return (db.data.backfill || []).filter((r) => r.status === 'pending');
  },

  addBackfillRow(row) {
    if (!db.data.backfill) db.data.backfill = [];
    db.data.backfill.push(row);
    db.write();
    return row;
  },

  updateBackfillRow(id, updates) {
    const row = (db.data.backfill || []).find((r) => r.id === id);
    if (row) {
      Object.assign(row, updates);
      db.write();
    }
    return row;
  },

  // Add sync error
  addSyncError(syncId, error) {
    db.data.sync_errors.push({
      id: db.data.sync_errors.length + 1,
      sync_id: syncId,
      ...error,
      created_at: new Date().toISOString(),
    });
    return db.write();
  },

  // ===== Products (website management) =====

  getProducts() {
    return db.data.products || [];
  },

  getProductById(id) {
    return (db.data.products || []).find((p) => p.id === Number(id));
  },

  addProduct(product) {
    if (!db.data.products) db.data.products = [];
    const record = {
      id: Math.max(0, ...db.data.products.map((p) => p.id || 0)) + 1,
      ...product,
      is_active: product.is_active !== false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    db.data.products.push(record);
    db.write();
    return record;
  },

  updateProduct(id, updates) {
    const product = dbHelpers.getProductById(id);
    if (!product) return null;
    Object.assign(product, updates, { updated_at: new Date().toISOString() });
    db.write();
    return product;
  },

  deleteProduct(id) {
    db.data.products = (db.data.products || []).filter((p) => p.id !== Number(id));
    return db.write();
  },

  // ===== Website content (section-by-section managed via admin) =====

  getSiteContent() {
    if (!db.data.site_content) db.data.site_content = {};
    return db.data.site_content;
  },

  getContentBlock(key) {
    return dbHelpers.getSiteContent()[key];
  },

  setContentBlock(key, value) {
    const content = dbHelpers.getSiteContent();
    content[key] = { ...(content[key] || {}), ...value, updated_at: new Date().toISOString() };
    db.write();
    return content[key];
  },

  // ===== Inline record editing (data tab, sheet-style) =====

  getRecordById(id) {
    return (db.data.records || []).find((r) => r.id === Number(id));
  },

  getAllRecords() {
    return (db.data.records || []).filter((r) => r.data && r.data.is_active !== false);
  },

  updateRecordData(id, updates) {
    const record = (db.data.records || []).find((r) => r.id === Number(id));
    if (!record) return null;
    if (!record.data) record.data = {};
    Object.assign(record.data, updates, { edited_locally: true, edited_at: new Date().toISOString() });
    record.updated_at = new Date().toISOString();
    db.write();
    return record;
  },

  // Update the inner fields of a record.data object wholesale
  patchRecordData(id, dataPatch) {
    const record = (db.data.records || []).find((r) => r.id === Number(id));
    if (!record) return null;
    record.data = { ...record.data, ...dataPatch, edited_locally: true, edited_at: new Date().toISOString() };
    record.updated_at = new Date().toISOString();
    db.write();
    return record;
  },

  // ===== Expanded settings (transitional: read keeps legacy flat keys) =====

  updateSettingsExtended(updates) {
    if (!db.data.settings) db.data.settings = {};
    const clean = { ...updates };
    delete clean.updated_at;
    Object.assign(db.data.settings, clean, { updated_at: new Date().toISOString() });
    db.write();
    return db.data.settings;
  },

  // Save/write to disk
  write() {
    return db.write();
  },
};

export default db;
