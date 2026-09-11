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
  const lv = { member: 0, manager: 1, super_admin: 2 }[staffRole()];
  return lv !== undefined && lv >= level;
}

export async function adminLogin(email, password) {
  const data = await apiLogin(email, password);
  if (!data.user?.is_team) throw new Error('This account is not a staff account');
  return data;
}

export const adminLogout = () => apiLogout().catch(() => {});

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
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
  return api(`/api/admin/records?${qs}`);
};
export const editRecord = (id, field, value) =>
  api(`/api/admin/records/${id}`, { method: 'PUT', body: JSON.stringify({ field, value }) });

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

// ---------- Drive / sheet (re-exported convenience) ----------
export const DRIVE_API = '/api/admin/google-drive';
export const getDriveStatus = () => api(`${DRIVE_API}/status`);
export const getDriveFiles = () => api(`${DRIVE_API}/files`);
export const getDriveFileData = (fileId, limit = 1000) => api(`${DRIVE_API}/data/${fileId}?limit=${limit}`);

// Session helpers used by the panel shell
export const persistStaff = (user, token) => setSession(user, token);
export const getStaffToken = getToken;
export const getStaffUser = getStaff;