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

export const api = {
  sendOtp: (phone) => request('/auth/otp/send', { method: 'POST', body: { phone } }),
  login: (phone, otpCode) => request('/auth/login', { method: 'POST', body: { phone, otpCode } }),
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
};
