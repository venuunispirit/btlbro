// Staff API client for the admin panel.
// Staff log in through the SAME POST /api/auth/login as customers (Navbar),
// so their token/user live in the same place (btl_shop_token / btl_shop_user).
// This client just attaches that token to the admin endpoints + adds helpers.

import { getToken, getUser, setSession, clearSession, login as apiLogin, logout as apiLogout } from '../../services/shopClient.js';

export { getToken, clearSession };

export const getStaff = () => {
  const u = getUser();
  return u && u.is_team ? u : null;
};

export const isStaff = () => !!getStaff();

export const staffRole = () => getStaff()?.role || null;

export function can(level) {
  const lv = { member: 0, recee: 0, bd_executive: 1, ops_executive: 1, manager: 1, recee_manager: 1, bdm: 2, ops_manager: 2, super_admin: 3 }[staffRole()];
  return lv !== undefined && lv >= level;
}

export async function adminLogin(email, password) {
  const data = await apiLogin(email, password);
  if (!data.user?.is_team) throw new Error('This account is not a staff account');
  return data;
}

export const adminLogout = () => apiLogout().catch(() => {});

export async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // An expired or orphaned session used to fail quietly: every panel caught
    // the error, rendered its empty state, and the dashboard just looked like
    // all the data had vanished. Clear the dead token so the next render shows
    // the sign-in screen and says why.
    if (res.status === 401 && getToken()) {
      clearSession();
      window.dispatchEvent(new CustomEvent('btl:session-expired'));
    }
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

// ---------- Team ----------
export const getTeam = () => api('/api/admin/team');
export const createMember = (payload) => api('/api/admin/team', { method: 'POST', body: JSON.stringify(payload) });
export const updateMember = (id, payload) => api(`/api/admin/team/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
export const deleteMember = (id) => api(`/api/admin/team/${id}`, { method: 'DELETE' });

// ---------- Orders ----------
export const getOrders = () => api('/api/orders');
export const updateOrder = (id, payload) => api(`/api/orders/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
export const deleteOrder = (id) => api(`/api/orders/${id}`, { method: 'DELETE' });
export const assignOrder = (id, memberId, byId) =>
  api(`/api/orders/${id}`, { method: 'PUT', body: JSON.stringify({ assigned_to: memberId, assigned_by: byId }) });

// ---------- Data records (inline editing) ----------
export const getRecords = (opts = {}) => {
  const qs = new URLSearchParams();
  if (opts.file) qs.set('file', opts.file);
  if (opts.page) qs.set('page', opts.page);
  if (opts.limit) qs.set('limit', opts.limit);
  if (opts.search !== undefined) qs.set('search', opts.search);
  if (opts.include_inactive) qs.set('include_inactive', 'true');
  return api(`/api/admin/records?${qs}`);
};
export const editRecord = (id, field, value) =>
  api(`/api/admin/records/${id}`, { method: 'PUT', body: JSON.stringify({ field, value }) });
export const assignRecords = (ids, memberId) =>
  api(`/api/admin/records/assign`, { method: 'POST', body: JSON.stringify({ ids, member_id: memberId }) });
export const setReceeStatus = (ids, status) =>
  api(`/api/admin/records/recee-status`, { method: 'POST', body: JSON.stringify({ ids, status }) });

// ---------- Website content ----------
export const getContent = () => api('/api/admin/content');
export const getBlock = (key) => api(`/api/admin/content/${key}`);
export const saveBlock = (key, payload) => api(`/api/admin/content/${key}`, { method: 'PUT', body: JSON.stringify(payload) });

// ---------- Products ----------
export const getProducts = (all = false) => api(`/api/admin/products${all ? '?all=1' : ''}`);
export const createProduct = (payload) => api('/api/admin/products', { method: 'POST', body: JSON.stringify(payload) });
export const updateProduct = (id, payload) => api(`/api/admin/products/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
export const deleteProduct = (id) => api(`/api/admin/products/${id}`, { method: 'DELETE' });

// ---------- Upload ----------
export const uploadImage = async (file) => {
  const fd = new FormData();
  fd.append('image', file);
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch('/api/admin/upload', { method: 'POST', headers, body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Upload failed');
  return data;
};

// ---------- Settings ----------
export const getSettings = () => api('/api/settings');
export const saveSettings = (payload) => api('/api/settings', { method: 'PUT', body: JSON.stringify(payload) });

// ---------- Leads ----------
export const getLeads = () => api('/api/leads');
export const updateLead = (id, payload) => api(`/api/leads/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
export const deleteLead = (id) => api(`/api/leads/${id}`, { method: 'DELETE' });
export const convertLead = (id) => api(`/api/leads/${id}/convert`, { method: 'POST' });
export const addLeadNote = (id, text) => api(`/api/leads/${id}/note`, { method: 'POST', body: JSON.stringify({ text }) });

// ---------- Chat ----------
export const getChatInbox = () => api('/api/admin/chat/inbox');
export const getChatMessages = (leadId) => api(`/api/admin/chat/${leadId}`);
export const sendChatMessage = (leadId, text) => api(`/api/admin/chat/${leadId}/send`, { method: 'POST', body: JSON.stringify({ text }) });

// ---------- Telephony ----------
export const clickToCall = (leadId) => api('/api/telephony/call', { method: 'POST', body: JSON.stringify({ lead_id: leadId }) });

// ---------- Departments ----------
export const getDepartments = () => api('/api/admin/departments');
export const createDepartment = (payload) => api('/api/admin/departments', { method: 'POST', body: JSON.stringify(payload) });
export const updateDepartment = (id, payload) => api(`/api/admin/departments/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
export const deleteDepartment = (id) => api(`/api/admin/departments/${id}`, { method: 'DELETE' });

// ---------- Site surveys (recee team) ----------
export const getSiteSurveys = () => api('/api/recee/surveys');
export const updateSiteSurveyStatus = (id, status) =>
  api(`/api/recee/surveys/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
export const createReceeRequest = (payload) =>
  api('/api/recee/requests', { method: 'POST', body: JSON.stringify(payload) });
export const assignSiteSurvey = (id, assignedToId) =>
  api(`/api/recee/surveys/${id}/assign`, { method: 'PUT', body: JSON.stringify({ assigned_to_id: assignedToId }) });
// Accept a capture that failed the 200m check. Attributed: records who and why.
export const overrideSiteSurvey = (id, reason) =>
  api(`/api/recee/surveys/${id}/override`, { method: 'PUT', body: JSON.stringify({ reason }) });

// ---------- Telephony / call routing ----------
export const getTelephonyStatus = () => api('/api/telephony/status-info');
// Dry run: who would ring for this caller, and in what order. Writes nothing.
export const previewCallRoute = (from) =>
  api('/api/telephony/preview', { method: 'POST', body: JSON.stringify({ from }) });
export const saveTelephony = (telephony) =>
  api('/api/settings', { method: 'PUT', body: JSON.stringify({ telephony }) });

// ---------- Notifications (topbar bell) ----------
export const getNotifications = () => api('/api/admin/notifications');
export const markNotificationRead = (id) =>
  api(`/api/admin/notifications/${id}/read`, { method: 'PUT' });
export const markAllNotificationsRead = () =>
  api('/api/admin/notifications/read-all', { method: 'PUT' });

// ---------- Payments ----------
export const getPaymentConfig = () => api('/api/payments/config');
export const createRazorpayOrder = (amount) => api('/api/payments/create-order', { method: 'POST', body: JSON.stringify({ amount }) });
export const verifyRazorpayPayment = (payload) => api('/api/payments/verify', { method: 'POST', body: JSON.stringify(payload) });

// Admin UPI rail (manager+). MONEY MOVES HERE — keep helpers explicit.
const UPI_API = '/api/admin/payments';
export const getUpiConfig = () => api(`${UPI_API}/config`);
export const saveUpiConfig = (payload) => api(`${UPI_API}/config`, { method: 'PUT', body: JSON.stringify(payload) });
export const decodeUpiPayload = (payload) => api(`${UPI_API}/decode`, { method: 'POST', body: JSON.stringify({ payload }) });
export const validateUpiVpa = (vpa) => api(`${UPI_API}/validate-vpa`, { method: 'POST', body: JSON.stringify({ vpa }) });
export const createUpiCollection = (payload) => api(`${UPI_API}/collect`, { method: 'POST', body: JSON.stringify(payload) });
export const sendUpiPayment = (payload) => api(`${UPI_API}/send`, { method: 'POST', body: JSON.stringify(payload) });
export const getUpiLedger = (opts = {}) => {
  const qs = new URLSearchParams();
  if (opts.direction) qs.set('direction', opts.direction);
  if (opts.status) qs.set('status', opts.status);
  if (opts.limit) qs.set('limit', opts.limit);
  return api(`${UPI_API}/ledger?${qs}`);
};
export const updateUpiPayment = (id, payload) => api(`${UPI_API}/ledger/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
export const reconcileUpiPayment = (id) => api(`${UPI_API}/ledger/${id}/reconcile`, { method: 'POST' });
export const getUpiSummary = () => api(`${UPI_API}/summary`);

// ---------- Companies / customer accounts (the CRM spine) ----------
const COMPANIES_API = '/api/admin/companies';
export const getCompanies = () => api(COMPANIES_API);
export const getCompany = (id) => api(`${COMPANIES_API}/${id}`);
export const updateCompany = (id, payload) => api(`${COMPANIES_API}/${id}`, { method: 'PUT', body: JSON.stringify(payload) });

// ---------- Drive / sheet (re-exported convenience) ----------
export const DRIVE_API = '/api/admin/google-drive';
export const getDriveStatus = () => api(`${DRIVE_API}/status`);
export const getDriveFiles = () => api(`${DRIVE_API}/files`);
export const getDriveFileData = (fileId, limit = 1000) => api(`${DRIVE_API}/data/${fileId}?limit=${limit}`);

// Session helpers used by the panel shell
export const persistStaff = (user, token) => setSession(user, token);
export const getStaffToken = getToken;
export const getStaffUser = getStaff;
// ---------- Vendors ----------
// A vendor is a supplier we pay, never a customer. Their payouts are ordinary
// ledger rows with direction 'out' and vendor_id set.
export const getVendors = () => api('/api/admin/vendors');
export const createVendor = (payload) => api('/api/admin/vendors', { method: 'POST', body: JSON.stringify(payload) });
export const updateVendor = (id, payload) => api(`/api/admin/vendors/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
export const getVendorBills = (params = {}) => {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== ''));
  return api(`/api/admin/vendors/bills${q.toString() ? `?${q}` : ''}`);
};
export const createVendorBill = (payload) => api('/api/admin/vendors/bills', { method: 'POST', body: JSON.stringify(payload) });
export const approveVendorBill = (id, payload) => api(`/api/admin/vendors/bills/${id}/approve`, { method: 'PUT', body: JSON.stringify(payload) });
export const rejectVendorBill = (id, reason) => api(`/api/admin/vendors/bills/${id}/reject`, { method: 'PUT', body: JSON.stringify({ reason }) });
export const getNotifyChannels = () => api('/api/admin/notify/channels');

// ---------- Vendor service catalogue ----------
// What a vendor sells and at what rate per unit. Purchase orders are priced
// from this list, so it lives on the vendor (directory) side and is edited
// there.
export const getVendorServices = (vendorId) => api(`/api/admin/vendors/${vendorId}/services`);
export const createVendorService = (vendorId, payload) =>
  api(`/api/admin/vendors/${vendorId}/services`, { method: 'POST', body: JSON.stringify(payload) });
export const updateVendorService = (vendorId, serviceId, payload) =>
  api(`/api/admin/vendors/${vendorId}/services/${serviceId}`, { method: 'PUT', body: JSON.stringify(payload) });
export const deleteVendorService = (vendorId, serviceId) =>
  api(`/api/admin/vendors/${vendorId}/services/${serviceId}`, { method: 'DELETE' });

// ---------- Purchase Orders ----------
// A PO commits to a vendor before anything is owed. `lines` is only
// {service_id, qty} — the rate, GST and total are computed on the server, so
// there is deliberately no way to send a price from the browser.
export const getPurchaseOrders = (params = {}) => {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== ''));
  return api(`/api/admin/pos${q.toString() ? `?${q}` : ''}`);
};
export const getPurchaseOrder = (id) => api(`/api/admin/pos/${id}`);
export const createPurchaseOrder = (payload) => api('/api/admin/pos', { method: 'POST', body: JSON.stringify(payload) });
export const updatePurchaseOrder = (id, payload) => api(`/api/admin/pos/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
export const approvePurchaseOrder = (id) => api(`/api/admin/pos/${id}/approve`, { method: 'PUT' });
export const rejectPurchaseOrder = (id, reason) => api(`/api/admin/pos/${id}/reject`, { method: 'PUT', body: JSON.stringify({ reason }) });
export const billPurchaseOrder = (id, payload) => api(`/api/admin/pos/${id}/bills`, { method: 'POST', body: JSON.stringify(payload) });

// ---------- Attributed collection (lead / order) ----------
// Same collect rail as the Accounts tab, but the movement is tagged so
// "money spent vs received on this lead" is a lookup, not a guess.
export const collectFor = (kind, id, payload) =>
  api('/api/admin/payments/collect/for', { method: 'POST', body: JSON.stringify({ kind, id, ...payload }) });
export const getMoneyFor = (kind, id) => api(`/api/admin/payments/for/${kind}/${id}`);
