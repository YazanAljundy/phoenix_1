const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api';
const TOKEN_STORAGE_KEY = 'phoenix.admin.token';

export function getToken() {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setToken(token) {
  if (token) {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(data?.message ?? 'Something went wrong. Please try again.', response.status);
  }

  return data;
}

// Bypass `request()` - it always sends/expects JSON, which doesn't fit a
// binary file download or a multipart upload.
async function requestBlob(path) {
  const token = getToken();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const response = await fetch(`${API_BASE_URL}${path}`, { headers });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new ApiError(data?.message ?? 'Download failed. Please try again.', response.status);
  }
  return response.blob();
}

async function requestUpload(path, file) {
  const token = getToken();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const formData = new FormData();
  formData.append('file', file);
  const response = await fetch(`${API_BASE_URL}${path}`, { method: 'POST', headers, body: formData });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(data?.message ?? 'Import failed. Please try again.', response.status);
  }
  return data;
}

export const api = {
  // TODO(re-enable-otp): unused by the current login flow - kept for a
  // future re-enable. The backend routes are still live.
  sendOtp: (phone) => request('/auth/otp/send', { method: 'POST', body: { phone } }),
  login: (phone, otpCode) => request('/auth/login', { method: 'POST', body: { phone, otpCode } }),
  // Section 6-2/3: the only login mechanism while OTP is disabled - used by
  // both admin and warehouse accounts (this panel serves both).
  loginWithPassword: (phone, password) =>
    request('/auth/login-password', { method: 'POST', body: { phone, password } }),
  me: () => request('/auth/me'),
  pendingAccounts: () => request('/admin/pending-accounts'),
  approveAccount: (userId) => request(`/admin/accounts/${userId}/approve`, { method: 'POST' }),
  rejectAccount: (userId) => request(`/admin/accounts/${userId}/reject`, { method: 'POST' }),
  warehouseOrders: (status) =>
    request(`/warehouse/orders${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  advanceOrderStatus: (orderId) =>
    request(`/warehouse/orders/${orderId}/advance-status`, { method: 'POST' }),
  categories: () => request('/categories'),
  warehouseProducts: () => request('/warehouse/products'),
  createWarehouseProduct: (data) => request('/warehouse/products', { method: 'POST', body: data }),
  updateWarehouseProduct: (productId, changes) =>
    request(`/warehouse/products/${productId}`, { method: 'PATCH', body: changes }),
  warehouseOffers: () => request('/warehouse/offers'),
  createWarehouseOffer: (data) => request('/warehouse/offers', { method: 'POST', body: data }),
  pendingOffers: () => request('/admin/offers'),
  approveOffer: (offerId) => request(`/admin/offers/${offerId}/approve`, { method: 'POST' }),
  rejectOffer: (offerId) => request(`/admin/offers/${offerId}/reject`, { method: 'POST' }),
  warehouseReturns: () => request('/warehouse/returns'),
  approveReturn: (returnId) => request(`/warehouse/returns/${returnId}/approve`, { method: 'POST' }),
  rejectReturn: (returnId, rejectionNote) =>
    request(`/warehouse/returns/${returnId}/reject`, { method: 'POST', body: { rejectionNote } }),
  warehouseReviews: () => request('/warehouse/reviews'),
  ratePharmacy: (orderId, rating, comment) =>
    request('/warehouse/reviews', { method: 'POST', body: { orderId, rating, comment } }),
  adminProducts: () => request('/admin/products'),
  updateAdminProduct: (productId, changes) =>
    request(`/admin/products/${productId}`, { method: 'PATCH', body: changes }),
  deleteAdminProduct: (productId) => request(`/admin/products/${productId}`, { method: 'DELETE' }),
  exchangeRate: () => request('/exchange-rate'),
  adminExchangeRate: () => request('/admin/exchange-rate'),
  setExchangeRate: (usdToSyp) => request('/admin/exchange-rate', { method: 'PATCH', body: { usdToSyp } }),
  resetExchangeRate: () => request('/admin/exchange-rate/reset', { method: 'PATCH' }),
  adminCatalog: (search) =>
    request(`/admin/catalog${search ? `?q=${encodeURIComponent(search)}` : ''}`),
  downloadCatalogTemplate: () => requestBlob('/admin/catalog/template'),
  importCatalogExcel: (file) => requestUpload('/admin/catalog/import', file),
  updateCatalogItem: (id, changes) => request(`/admin/catalog/${id}`, { method: 'PATCH', body: changes }),
  deactivateCatalogItem: (id) => request(`/admin/catalog/${id}`, { method: 'DELETE' }),
  warehouseCatalogSearch: (q) =>
    request(`/warehouse/catalog/search${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  downloadWarehouseProductTemplate: () => requestBlob('/warehouse/products/template'),
  importWarehouseProducts: (file) => requestUpload('/warehouse/products/import', file),
  warehouseDiscounts: () => request('/warehouse/discounts'),
  createWarehouseDiscount: (data) => request('/warehouse/discounts', { method: 'POST', body: data }),
  updateWarehouseDiscount: (id, changes) =>
    request(`/warehouse/discounts/${id}`, { method: 'PATCH', body: changes }),
  deleteWarehouseDiscount: (id) => request(`/warehouse/discounts/${id}`, { method: 'DELETE' }),
  warehouseManufacturers: () => request('/warehouse/manufacturers'),
  warehouseBalances: () => request('/warehouse/balances'),
  warehouseBalanceDetail: (pharmacyId) => request(`/warehouse/balances/${pharmacyId}`),
  createPayment: (data) => request('/warehouse/payments', { method: 'POST', body: data }),
  updatePayment: (id, changes) => request(`/warehouse/payments/${id}`, { method: 'PATCH', body: changes }),
  deletePayment: (id) => request(`/warehouse/payments/${id}`, { method: 'DELETE' }),
};
