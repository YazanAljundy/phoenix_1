const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5000/api';
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

// Like requestUpload, but for endpoints that take a file *alongside* other
// form fields (a banner's image + title/dates/productId) rather than just
// the file alone - caller builds the FormData itself.
async function requestFormData(path, formData) {
  const token = getToken();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const response = await fetch(`${API_BASE_URL}${path}`, { method: 'POST', headers, body: formData });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(data?.message ?? 'Upload failed. Please try again.', response.status);
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
  // No args: every pending account of both roles - used by the Dashboard's
  // stat card/recent list. (The Accounts management page uses adminAccounts
  // below instead.)
  pendingAccounts: ({ role, limit, after } = {}) => {
    const params = new URLSearchParams();
    if (role) params.set('role', role);
    if (limit) params.set('limit', limit);
    if (after) params.set('after', after);
    const qs = params.toString();
    return request(`/admin/pending-accounts${qs ? `?${qs}` : ''}`);
  },
  // The Accounts management page: both roles, every status, with type/status/
  // search filters and cursor "Load more" pagination. `role` is 'pharmacy' |
  // 'warehouse' (omit for all); `status` is 'active' | 'pending' | 'blocked'
  // (omit for all). Response carries { accounts, pagination:{hasMore,nextCursor},
  // counts:{all,active,pending,blocked} }.
  adminAccounts: ({ role, status, search, limit, after } = {}) => {
    const params = new URLSearchParams();
    if (role) params.set('role', role);
    if (status) params.set('status', status);
    if (search) params.set('search', search);
    if (limit) params.set('limit', limit);
    if (after) params.set('after', after);
    const qs = params.toString();
    return request(`/admin/accounts${qs ? `?${qs}` : ''}`);
  },
  createAdminWarehouse: (data) => request('/admin/warehouses', { method: 'POST', body: data }),
  approveAccount: (userId) => request(`/admin/accounts/${userId}/approve`, { method: 'POST' }),
  rejectAccount: (userId) => request(`/admin/accounts/${userId}/reject`, { method: 'POST' }),
  blockAccount: (userId) => request(`/admin/accounts/${userId}/block`, { method: 'POST' }),
  unblockAccount: (userId) => request(`/admin/accounts/${userId}/unblock`, { method: 'POST' }),
  sendAdminNotification: ({ titleAr, titleEn, bodyAr, bodyEn }) =>
    request('/admin/notifications', { method: 'POST', body: { titleAr, titleEn, bodyAr, bodyEn } }),
  warehouseOrders: ({ status, limit, after } = {}) => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (limit) params.set('limit', limit);
    if (after) params.set('after', after);
    const qs = params.toString();
    return request(`/warehouse/orders${qs ? `?${qs}` : ''}`);
  },
  warehouseOrderDetail: (orderId) => request(`/warehouse/orders/${orderId}`),
  advanceOrderStatus: (orderId) =>
    request(`/warehouse/orders/${orderId}/advance-status`, { method: 'POST' }),
  updateOrderItems: (orderId, { addItems, removeItems, updateItems }) =>
    request(`/warehouse/orders/${orderId}/items`, {
      method: 'PATCH',
      body: { addItems, removeItems, updateItems },
    }),
  // Per-order proof-of-delivery toggle - flips just order.requiresDeliverySealPhoto.
  setOrderDeliverySealRequirement: (orderId, requiresDeliverySealPhoto) =>
    request(`/warehouse/orders/${orderId}/delivery-seal`, {
      method: 'PATCH',
      body: { requiresDeliverySealPhoto },
    }),
  categories: () => request('/categories'),
  // No args: the full, alphabetical list - used by the banner/offer "linked
  // product" pickers, which need every product. Pass { limit, after } for
  // the Products management page's own paginated, newest-first view. Pass
  // { available: true } (the order-items editor's "add item" picker) to get
  // only products the pharmacy could actually receive right now.
  warehouseProducts: ({ limit, after, available } = {}) => {
    const params = new URLSearchParams();
    if (limit) params.set('limit', limit);
    if (after) params.set('after', after);
    if (available) params.set('available', 'true');
    const qs = params.toString();
    return request(`/warehouse/products${qs ? `?${qs}` : ''}`);
  },
  createWarehouseProduct: (data) => request('/warehouse/products', { method: 'POST', body: data }),
  updateWarehouseProduct: (productId, changes) =>
    request(`/warehouse/products/${productId}`, { method: 'PATCH', body: changes }),
  warehouseOffers: () => request('/warehouse/offers'),
  createWarehouseOffer: (data) => request('/warehouse/offers', { method: 'POST', body: data }),
  // An edit to a still-pending offer is applied in place; an edit to an
  // approved offer is parked for admin review (backend updateOffer).
  updateWarehouseOffer: (offerId, data) =>
    request(`/warehouse/offers/${offerId}`, { method: 'PATCH', body: data }),
  deleteWarehouseOffer: (offerId) => request(`/warehouse/offers/${offerId}`, { method: 'DELETE' }),
  // No args: the moderation queue (pending offers + parked edits) - used by the
  // Dashboard's stat card/recent list.
  pendingOffers: () => request('/admin/offers'),
  // Section 5: every offer, every warehouse, every status. Unpaginated - the
  // Offers page filters it client-side.
  allOffers: () => request('/admin/offers/all'),
  approveOffer: (offerId) => request(`/admin/offers/${offerId}/approve`, { method: 'POST' }),
  rejectOffer: (offerId) => request(`/admin/offers/${offerId}/reject`, { method: 'POST' }),
  updateAdminOffer: (offerId, data) => request(`/admin/offers/${offerId}`, { method: 'PATCH', body: data }),
  deleteAdminOffer: (offerId) => request(`/admin/offers/${offerId}`, { method: 'DELETE' }),
  // Always paginated, unlike `warehouseProducts` above: this backs the
  // advertisement product picker, which searches server-side a page at a time
  // rather than pulling the whole catalog down to filter it here.
  searchWarehouseProducts: ({ q, limit, after } = {}) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (limit) params.set('limit', limit);
    if (after) params.set('after', after);
    const qs = params.toString();
    return request(`/warehouse/products/search${qs ? `?${qs}` : ''}`);
  },
  warehouseAdvertisements: () => request('/warehouse/advertisements'),
  createWarehouseAdvertisement: (data) =>
    request('/warehouse/advertisements', { method: 'POST', body: data }),
  updateWarehouseAdvertisement: (advertisementId, data) =>
    request(`/warehouse/advertisements/${advertisementId}`, { method: 'PATCH', body: data }),
  deleteWarehouseAdvertisement: (advertisementId) =>
    request(`/warehouse/advertisements/${advertisementId}`, { method: 'DELETE' }),
  // Same two shapes as pendingOffers: no args for the full pending list,
  // { limit, after } for the management page's paginated view.
  pendingAdvertisements: ({ limit, after } = {}) => {
    const params = new URLSearchParams();
    if (limit) params.set('limit', limit);
    if (after) params.set('after', after);
    const qs = params.toString();
    return request(`/admin/advertisements${qs ? `?${qs}` : ''}`);
  },
  approveAdvertisement: (advertisementId) =>
    request(`/admin/advertisements/${advertisementId}/approve`, { method: 'POST' }),
  rejectAdvertisement: (advertisementId, rejectionNote) =>
    request(`/admin/advertisements/${advertisementId}/reject`, {
      method: 'POST',
      body: { rejectionNote },
    }),
  // No args: the full list - used by WarehouseOrderDetailPage's "does this
  // order already have a pending return" lookup. Pass { limit, after } for
  // the Returns management page's own paginated, newest-first view.
  warehouseReturns: ({ limit, after } = {}) => {
    const params = new URLSearchParams();
    if (limit) params.set('limit', limit);
    if (after) params.set('after', after);
    const qs = params.toString();
    return request(`/warehouse/returns${qs ? `?${qs}` : ''}`);
  },
  warehouseReturnDetail: (returnId) => request(`/warehouse/returns/${returnId}`),
  approveReturn: (returnId) => request(`/warehouse/returns/${returnId}/approve`, { method: 'POST' }),
  rejectReturn: (returnId, rejectionNote) =>
    request(`/warehouse/returns/${returnId}/reject`, { method: 'POST', body: { rejectionNote } }),
  warehouseReviews: ({ limit, after } = {}) => {
    const params = new URLSearchParams();
    if (limit) params.set('limit', limit);
    if (after) params.set('after', after);
    const qs = params.toString();
    return request(`/warehouse/reviews${qs ? `?${qs}` : ''}`);
  },
  ratePharmacy: (orderId, rating, comment) =>
    request('/warehouse/reviews', { method: 'POST', body: { orderId, rating, comment } }),
  // No args: every product - used by the Dashboard's count and the Banners
  // composer's product picker. Pass { search, warehouseId, limit, after }
  // for the Products management page's own paginated, filtered view.
  adminProducts: ({ search, warehouseId, limit, after } = {}) => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (warehouseId) params.set('warehouseId', warehouseId);
    if (limit) params.set('limit', limit);
    if (after) params.set('after', after);
    const qs = params.toString();
    return request(`/admin/products${qs ? `?${qs}` : ''}`);
  },
  adminProductWarehouses: () => request('/admin/products/warehouses'),
  updateAdminProduct: (productId, changes) =>
    request(`/admin/products/${productId}`, { method: 'PATCH', body: changes }),
  deleteAdminProduct: (productId) => request(`/admin/products/${productId}`, { method: 'DELETE' }),
  exchangeRate: () => request('/exchange-rate'),
  adminExchangeRate: () => request('/admin/exchange-rate'),
  setExchangeRate: (usdToSyp) => request('/admin/exchange-rate', { method: 'PATCH', body: { usdToSyp } }),
  resetExchangeRate: () => request('/admin/exchange-rate/reset', { method: 'PATCH' }),
  adminCatalog: ({ search, limit, after } = {}) => {
    const params = new URLSearchParams();
    if (search) params.set('q', search);
    if (limit) params.set('limit', limit);
    if (after) params.set('after', after);
    const qs = params.toString();
    return request(`/admin/catalog${qs ? `?${qs}` : ''}`);
  },
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
  warehouseBalances: ({ limit, after } = {}) => {
    const params = new URLSearchParams();
    if (limit) params.set('limit', limit);
    if (after) params.set('after', after);
    const qs = params.toString();
    return request(`/warehouse/balances${qs ? `?${qs}` : ''}`);
  },
  warehouseBalanceDetail: (pharmacyId) => request(`/warehouse/balances/${pharmacyId}`),
  createPayment: (data) => request('/warehouse/payments', { method: 'POST', body: data }),
  updatePayment: (id, changes) => request(`/warehouse/payments/${id}`, { method: 'PATCH', body: changes }),
  deletePayment: (id) => request(`/warehouse/payments/${id}`, { method: 'DELETE' }),
  warehouseSettings: () => request('/warehouse/settings'),
  // `requireDeliverySealPhoto` is optional - omitted keys are left untouched
  // server-side (warehouseSettings.service.js).
  updateWarehouseOrderLimits: ({ minOrderAmountUsd, maxOrderAmountUsd, requireDeliverySealPhoto }) =>
    request('/warehouse/settings', {
      method: 'PATCH',
      body: { minOrderAmountUsd, maxOrderAmountUsd, requireDeliverySealPhoto },
    }),
  warehouseBanners: ({ limit, after } = {}) => {
    const params = new URLSearchParams();
    if (limit) params.set('limit', limit);
    if (after) params.set('after', after);
    const qs = params.toString();
    return request(`/warehouse/banners${qs ? `?${qs}` : ''}`);
  },
  createWarehouseBanner: (formData) => requestFormData('/warehouse/banners', formData),
  updateWarehouseBanner: (id, changes) => request(`/warehouse/banners/${id}`, { method: 'PATCH', body: changes }),
  deleteWarehouseBanner: (id) => request(`/warehouse/banners/${id}`, { method: 'DELETE' }),
  // No `limit`: the full bucket for the given status - used by the
  // Dashboard's pending-count. Pass { status, limit, after } for the
  // Banners management page's own paginated view (status='all').
  adminBanners: (status, { limit, after } = {}) => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (limit) params.set('limit', limit);
    if (after) params.set('after', after);
    const qs = params.toString();
    return request(`/admin/banners${qs ? `?${qs}` : ''}`);
  },
  // --- Complaints -------------------------------------------------------
  // Admin: every complaint, newest first; pass { status } to filter. The
  // response also carries per-status `counts` for the filter pills.
  adminComplaints: ({ status, limit, after } = {}) => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (limit) params.set('limit', limit);
    if (after) params.set('after', after);
    const qs = params.toString();
    return request(`/admin/complaints${qs ? `?${qs}` : ''}`);
  },
  adminComplaintDetail: (complaintId) => request(`/admin/complaints/${complaintId}`),
  respondToComplaint: (complaintId, { response, status }) =>
    request(`/admin/complaints/${complaintId}/respond`, {
      method: 'POST',
      body: { response, status },
    }),
  updateComplaintStatus: (complaintId, status) =>
    request(`/admin/complaints/${complaintId}/status`, { method: 'PATCH', body: { status } }),
  // Warehouse: only the complaints filed against the caller's own warehouse,
  // read-only.
  warehouseComplaints: ({ limit, after } = {}) => {
    const params = new URLSearchParams();
    if (limit) params.set('limit', limit);
    if (after) params.set('after', after);
    const qs = params.toString();
    return request(`/warehouse/complaints${qs ? `?${qs}` : ''}`);
  },
  warehouseComplaintDetail: (complaintId) => request(`/warehouse/complaints/${complaintId}`),

  createAdminBanner: (formData) => requestFormData('/admin/banners', formData),
  approveBanner: (bannerId) => request(`/admin/banners/${bannerId}/approve`, { method: 'PATCH' }),
  rejectBanner: (bannerId, rejectionNote) =>
    request(`/admin/banners/${bannerId}/reject`, { method: 'PATCH', body: { rejectionNote } }),
  deleteAdminBanner: (id) => request(`/admin/banners/${id}`, { method: 'DELETE' }),
  updateAdminBanner: (id, changes) => request(`/admin/banners/${id}`, { method: 'PATCH', body: changes }),
};
