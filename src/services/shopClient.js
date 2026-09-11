// Tiny client for the shop auth/cart/wishlist APIs.
// Session token lives in localStorage (`btl_shop_token`), user in `btl_shop_user`.

export function getToken() {
  return localStorage.getItem('btl_shop_token') || '';
}

export function getUser() {
  try { return JSON.parse(localStorage.getItem('btl_shop_user') || 'null'); } catch { return null; }
}

export function setSession(user, token) {
  localStorage.setItem('btl_shop_user', JSON.stringify(user));
  localStorage.setItem('btl_shop_token', token);
}

export function clearSession() {
  localStorage.removeItem('btl_shop_user');
  localStorage.removeItem('btl_shop_token');
}

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const register = (name, email, password) =>
  api('/api/auth/register', { method: 'POST', body: JSON.stringify({ name, email, password }) });

export const login = async (email, password) => {
  const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  setSession(data.user, data.token);
  return data;
};

export const logout = () => api('/api/auth/logout', { method: 'POST' }).finally(clearSession);

export const me = () => api('/api/auth/me');

export const getCart = () => api('/api/shop/cart');

// Push the guest (localStorage) cart to the server after login, then clear it.
export async function mergeGuestCart(items) {
  if (!Array.isArray(items) || items.length === 0) return { cart: [] };
  const data = await api('/api/shop/cart', { method: 'POST', body: JSON.stringify({ items }) });
  localStorage.removeItem('btl_cart');
  return data;
}

export const addToCart = (item) => api('/api/shop/cart/item', { method: 'POST', body: JSON.stringify(item) });

export const removeFromCart = (key) => api(`/api/shop/cart/item/${encodeURIComponent(key)}`, { method: 'DELETE' });

export const getWishlist = () => api('/api/shop/wishlist');

export const getOrders = () => api('/api/shop/orders');

export const toggleWishlist = (product) =>
  api('/api/shop/wishlist', { method: 'POST', body: JSON.stringify(product) });

export const checkout = (payload) => api('/api/shop/checkout', { method: 'POST', body: JSON.stringify(payload) });

export const verifyPayment = (payload) => api('/api/shop/checkout/verify', { method: 'POST', body: JSON.stringify(payload) });
