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
  // `code` and `details` are what the backend's errorHandler.js already sends
  // alongside every ApiError message - carried through so a caller can react
  // to a specific rejection (a rename that needs confirming, say) instead of
  // only being able to show the sentence.
  constructor(message, status, code = null, details = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
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
    throw new ApiError(
      data?.message ?? 'Something went wrong. Please try again.',
      response.status,
      data?.code ?? null,
      data?.details ?? null
    );
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
  // only products the pharmacy could actually receive right now. Pass
  // { manufacturer } (the catalog page, once a company card is opened) to get
  // that company's products only - an exact match, and applied server-side so
  // "Load more" pages within the company.
  warehouseProducts: ({ limit, after, available, manufacturer } = {}) => {
    const params = new URLSearchParams();
    if (limit) params.set('limit', limit);
    if (after) params.set('after', after);
    if (available) params.set('available', 'true');
    if (manufacturer) params.set('manufacturer', manufacturer);
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
    // `search` (was `q`) at the HTTP boundary - unified with every other
    // text-search endpoint. Kept as `q` in this function's own arguments so
    // every existing caller (e.g. the advertisement product picker) is
    // unchanged.
    if (q) params.set('search', q);
    if (limit) params.set('limit', limit);
    if (after) params.set('after', after);
    const qs = params.toString();
    return request(`/warehouse/products/search${qs ? `?${qs}` : ''}`);
  },
  // Pass { status } to filter to one of the package's three statuses; omit
  // for every one of the warehouse's own packages, as before this filter
  // existed.
  warehouseAdvertisements: ({ status } = {}) =>
    request(`/warehouse/advertisements${status ? `?status=${status}` : ''}`),
  createWarehouseAdvertisement: (data) =>
    request('/warehouse/advertisements', { method: 'POST', body: data }),
  updateWarehouseAdvertisement: (advertisementId, data) =>
    request(`/warehouse/advertisements/${advertisementId}`, { method: 'PATCH', body: data }),
  deleteWarehouseAdvertisement: (advertisementId) =>
    request(`/warehouse/advertisements/${advertisementId}`, { method: 'DELETE' }),
  // Either direction, restricted server-side to an approved package
  // (ADVERTISEMENT_NOT_APPROVED otherwise) - a warehouse can pause AND
  // re-enable its own package, same as an admin can for any package.
  setWarehouseAdvertisementAvailability: (advertisementId, isAvailable) =>
    request(`/warehouse/advertisements/${advertisementId}/availability`, {
      method: 'PATCH',
      body: { isAvailable },
    }),
  // Same two shapes as pendingOffers: no args for the full pending list,
  // { limit, after } for the management page's paginated view. `status`
  // ('pending' | 'approved' | 'rejected') picks which list that paginated
  // view shows - the Advertisements page's three tabs all use this.
  pendingAdvertisements: ({ status, limit, after } = {}) => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (limit) params.set('limit', limit);
    if (after) params.set('after', after);
    const qs = params.toString();
    return request(`/admin/advertisements${qs ? `?${qs}` : ''}`);
  },
  // Every advertisement, every warehouse, every status, unpaginated. Not used
  // by the Advertisements page (its Rejected tab now uses pendingAdvertisements
  // above like the other two) - kept for any other caller that wants the full
  // unfiltered set.
  allAdvertisements: () => request('/admin/advertisements/all'),
  approveAdvertisement: (advertisementId) =>
    request(`/admin/advertisements/${advertisementId}/approve`, { method: 'POST' }),
  rejectAdvertisement: (advertisementId, rejectionNote) =>
    request(`/admin/advertisements/${advertisementId}/reject`, {
      method: 'POST',
      body: { rejectionNote },
    }),
  // Direct content edit, at any status - the admin IS the approval authority,
  // so (unlike a warehouse edit) this never sends the package back for review.
  updateAdminAdvertisement: (advertisementId, data) =>
    request(`/admin/advertisements/${advertisementId}`, { method: 'PATCH', body: data }),
  deleteAdminAdvertisement: (advertisementId) =>
    request(`/admin/advertisements/${advertisementId}`, { method: 'DELETE' }),
  // Either direction. An admin can flip any package's availability regardless
  // of which warehouse owns it.
  setAdvertisementAvailability: (advertisementId, isAvailable) =>
    request(`/admin/advertisements/${advertisementId}/availability`, {
      method: 'PATCH',
      body: { isAvailable },
    }),
  // No args: the full list - used by WarehouseOrderDetailPage's "does this
  // order already have a pending return" lookup. Pass { status, limit, after }
  // for the Returns management page's own paginated, newest-first, filterable view.
  warehouseReturns: ({ status, limit, after } = {}) => {
    const params = new URLSearchParams();
    if (status && status !== 'all') params.set('status', status);
    if (limit) params.set('limit', limit);
    if (after) params.set('after', after);
    const qs = params.toString();
    return request(`/warehouse/returns${qs ? `?${qs}` : ''}`);
  },
  warehouseReturnDetail: (returnId) => request(`/warehouse/returns/${returnId}`),
  // Money-Flow V2: what approving would credit, before committing to it.
  // Read-only - creates nothing.
  returnCreditPreview: (returnId) => request(`/warehouse/returns/${returnId}/credit-preview`),
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
  // composer's product picker. Pass { search, warehouseId, categoryId,
  // manufacturer, limit, after } for the Products management page's own
  // paginated, filtered view.
  adminProducts: ({ search, warehouseId, categoryId, manufacturer, limit, after } = {}) => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (warehouseId) params.set('warehouseId', warehouseId);
    if (categoryId) params.set('categoryId', categoryId);
    if (manufacturer) params.set('manufacturer', manufacturer);
    if (limit) params.set('limit', limit);
    if (after) params.set('after', after);
    const qs = params.toString();
    return request(`/admin/products${qs ? `?${qs}` : ''}`);
  },
  // Just the number, for the Dashboard's stat card - it used to call
  // adminProducts() with no limit and read `.length`, which downloaded every
  // product on the platform to render one integer.
  adminProductsCount: () => request('/admin/products/count'),
  adminProductWarehouses: () => request('/admin/products/warehouses'),
  updateAdminProduct: (productId, changes) =>
    request(`/admin/products/${productId}`, { method: 'PATCH', body: changes }),
  deleteAdminProduct: (productId) => request(`/admin/products/${productId}`, { method: 'DELETE' }),
  exchangeRate: () => request('/exchange-rate'),
  // Money-Flow V2 - the platform's side of commission. The warehouse's own
  // Settlement tab shows the same computation for itself; this is every
  // warehouse at once, plus what each has actually handed over.
  //
  // `from`/`to` are free - the admin picks any window - and are applied to the
  // whole table, so the figures on every row describe the same period.
  adminCommissionOverview: ({ from, to } = {}) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString();
    return request(`/admin/commission/overview${qs ? `?${qs}` : ''}`);
  },
  adminCommissionWarehouse: (warehouseId, { from, to } = {}) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString();
    return request(`/admin/commission/warehouses/${warehouseId}${qs ? `?${qs}` : ''}`);
  },
  recordCommissionCollection: (data) =>
    request('/admin/commission/collections', { method: 'POST', body: data }),
  // Like a payment, a collection is corrected by reversing it, never by
  // editing or deleting - the row stays visible with the reason that undid it.
  reverseCommissionCollection: (id, body) =>
    request(`/admin/commission/collections/${id}/reverse`, { method: 'POST', body }),

  adminExchangeRate: () => request('/admin/exchange-rate'),
  setExchangeRate: (usdToSyp) => request('/admin/exchange-rate', { method: 'PATCH', body: { usdToSyp } }),
  resetExchangeRate: () => request('/admin/exchange-rate/reset', { method: 'PATCH' }),
  adminCatalog: ({ search, categoryId, manufacturer, limit, after } = {}) => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (categoryId) params.set('categoryId', categoryId);
    if (manufacturer) params.set('manufacturer', manufacturer);
    if (limit) params.set('limit', limit);
    if (after) params.set('after', after);
    const qs = params.toString();
    return request(`/admin/catalog${qs ? `?${qs}` : ''}`);
  },
  // Backs the Searchable Dropdown manufacturer filter on both Admin Products
  // and Admin Catalog - a type-ahead over the central catalog's distinct
  // manufacturer names, capped server-side (adminCatalog.service.js).
  searchAdminManufacturers: (search) =>
    request(`/admin/catalog/manufacturers${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  downloadCatalogTemplate: () => requestBlob('/admin/catalog/template'),
  importCatalogExcel: (file) => requestUpload('/admin/catalog/import', file),
  // `confirmed` re-sends the identical body with ?confirm=true, to go through
  // with a rename the server first refused because it would restate the
  // medicine's name across every warehouse stocking it.
  updateCatalogItem: (id, changes, { confirmed = false } = {}) =>
    request(`/admin/catalog/${id}${confirmed ? '?confirm=true' : ''}`, {
      method: 'PATCH',
      body: changes,
    }),
  deactivateCatalogItem: (id) => request(`/admin/catalog/${id}`, { method: 'DELETE' }),
  // `search` (was `q`) at the HTTP boundary - unified with every other
  // text-search endpoint.
  warehouseCatalogSearch: (q) =>
    request(`/warehouse/catalog/search${q ? `?search=${encodeURIComponent(q)}` : ''}`),
  downloadWarehouseProductTemplate: () => requestBlob('/warehouse/products/template'),
  importWarehouseProducts: (file) => requestUpload('/warehouse/products/import', file),
  warehouseDiscounts: () => request('/warehouse/discounts'),
  createWarehouseDiscount: (data) => request('/warehouse/discounts', { method: 'POST', body: data }),
  updateWarehouseDiscount: (id, changes) =>
    request(`/warehouse/discounts/${id}`, { method: 'PATCH', body: changes }),
  deleteWarehouseDiscount: (id) => request(`/warehouse/discounts/${id}`, { method: 'DELETE' }),
  // No args (the Discounts tab): every company name the warehouse has ever
  // imported, as plain strings. { inCatalog: true } (the catalog page's
  // company list): only companies with products in the catalog right now, as
  // { manufacturerAr, productCount } - see the backend controller for why
  // browsing needs the second list rather than the registry.
  warehouseManufacturers: ({ inCatalog } = {}) =>
    request(`/warehouse/manufacturers${inCatalog ? '?inCatalog=true' : ''}`),
  warehouseBalances: ({ limit, after } = {}) => {
    const params = new URLSearchParams();
    if (limit) params.set('limit', limit);
    if (after) params.set('after', after);
    const qs = params.toString();
    return request(`/warehouse/balances${qs ? `?${qs}` : ''}`);
  },
  warehouseBalanceDetail: (pharmacyId) => request(`/warehouse/balances/${pharmacyId}`),
  // Money-Flow V2: commission owed to the platform for a period, and what the
  // warehouse nets after it. Read-only.
  warehouseSettlement: ({ from, to } = {}) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString();
    return request(`/warehouse/settlement${qs ? `?${qs}` : ''}`);
  },
  // Money-Flow V2: payments are append-only. `updatePayment` / `deletePayment`
  // are gone - a mistake is corrected by reversing it, which keeps both the
  // original and the correction in the history.
  createPayment: (data) => request('/warehouse/payments', { method: 'POST', body: data }),
  reversePayment: (id, body) =>
    request(`/warehouse/payments/${id}/reverse`, { method: 'POST', body }),
  warehouseSettings: () => request('/warehouse/settings'),
  // `requireDeliverySealPhoto` is optional - omitted keys are left untouched
  // server-side (warehouseSettings.service.js).
  updateWarehouseOrderLimits: ({ minOrderAmountUsd, maxOrderAmountUsd, requireDeliverySealPhoto }) =>
    request('/warehouse/settings', {
      method: 'PATCH',
      body: { minOrderAmountUsd, maxOrderAmountUsd, requireDeliverySealPhoto },
    }),
  warehouseBanners: ({ status, limit, after } = {}) => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
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
  // read-only. Pass { status } to filter (same enum as the admin queue).
  warehouseComplaints: ({ status, limit, after } = {}) => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
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
