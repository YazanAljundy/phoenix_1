const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5000/api';

// Why the access token lives in localStorage, and why that is not changing
// yet (audit F-05).
//
// localStorage is readable by any JavaScript running on this origin, so an
// XSS on this panel would yield a working admin token. The textbook answer
// is an HttpOnly cookie, which JavaScript cannot read at all. That is not a
// drop-in swap here, and the reasons are structural rather than effort:
//
//   - The token is a shared contract. The Flutter app sends the same JWT as
//     an `Authorization: Bearer` header from its own Dio interceptor, and
//     Socket.IO carries it in the handshake `auth` payload. A cookie only
//     helps the browser, so the server would have to accept both and the
//     two paths would drift.
//   - Cookies are sent automatically, which is exactly what makes them CSRF
//     -vulnerable. Today's Bearer header is immune by construction; moving
//     to cookies means introducing CSRF tokens across every mutating route.
//
// So the mitigation this round is to shrink the prize rather than move it:
// F-03 cut the access token from 7 days to 24 hours, and the refresh token
// that renews it is kept in sessionStorage (below) rather than here.
//
// Revisit HttpOnly cookies when the web panel no longer shares an auth
// contract with the mobile app, or when a CSRF layer exists for other
// reasons. Until then this is a known, accepted, and bounded risk.
const TOKEN_STORAGE_KEY = 'phoenix.admin.token';

// The refresh token deliberately does NOT sit beside the access token.
//
// It is valid for 30 days against the access token 24 hours, so putting it
// in localStorage would have made an XSS strictly more valuable than before
// F-03 - the opposite of the finding's intent. sessionStorage is scoped to
// the tab and cleared when it closes, which caps what a stolen refresh token
// is worth at one browsing session. The cost is that closing the browser
// means logging in again, which is the right trade for a panel that can
// approve accounts and move money.
const REFRESH_TOKEN_STORAGE_KEY = 'phoenix.admin.refresh';

export function getToken() {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setToken(token) {
  if (token) {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  }
  notifyTokenChanged(token ?? null);
}

export function getRefreshToken() {
  return sessionStorage.getItem(REFRESH_TOKEN_STORAGE_KEY);
}

export function setRefreshToken(token) {
  if (token) {
    sessionStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, token);
  } else {
    sessionStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
  }
}

// Stores or clears both halves of a session at once, so a caller can never
// leave one behind.
// Accepts null to clear, so `= {}` is not enough - a default only fills in
// for undefined and destructuring null throws.
export function setSession(session) {
  const { token, refreshToken } = session ?? {};
  setRefreshToken(refreshToken ?? null);
  setToken(token ?? null);
}

// The socket bakes the JWT into its handshake at connect time and replays
// that same value on every automatic reconnect, so it cannot notice a silent
// refresh on its own - it would keep retrying forever with a dead credential
// and, since nothing renders the connection state, do it invisibly.
// RealtimeProvider subscribes here and reconnects with the new token.
const tokenListeners = new Set();

export function onTokenChange(listener) {
  tokenListeners.add(listener);
  return () => tokenListeners.delete(listener);
}

function notifyTokenChanged(token) {
  for (const listener of tokenListeners) {
    try {
      listener(token);
    } catch {
      // A misbehaving listener must not break authentication.
    }
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

// The single in-flight refresh. A dashboard page can fire half a dozen
// requests at once and, at expiry, get half a dozen 401s back together.
// Because the backend rotates the refresh token on every use, letting them
// all refresh would mean five of the six spending an already-consumed token
// and logging the operator out. They await this one promise instead.
let inFlightRefresh = null;

async function performRefresh() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;

  try {
    const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!response.ok) return false;

    const data = await response.json().catch(() => null);
    if (!data?.token) return false;

    setSession({ token: data.token, refreshToken: data.refreshToken });
    return true;
  } catch {
    // Offline, DNS, CORS - "could not refresh", never "session is over".
    // Nothing is cleared here; that decision belongs to the caller.
    return false;
  }
}

function refreshSession() {
  if (!inFlightRefresh) {
    inFlightRefresh = performRefresh().finally(() => {
      inFlightRefresh = null;
    });
  }
  return inFlightRefresh;
}

function buildHeaders(extra = {}) {
  const headers = { ...extra };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function request(path, { method = 'GET', body, _retried = false } = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: buildHeaders({ 'Content-Type': 'application/json' }),
    body: body ? JSON.stringify(body) : undefined,
  });

  // Since F-03 an access token expires every 24h, so a 401 is routine rather
  // than session-ending: spend the refresh token and replay once. Only if
  // that fails does the 401 reach the caller as a real rejection.
  if (response.status === 401 && !_retried) {
    const refreshed = await refreshSession();
    if (refreshed) {
      return request(path, { method, body, _retried: true });
    }
  }

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
  const headers = buildHeaders();
  const response = await fetch(`${API_BASE_URL}${path}`, { headers });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new ApiError(data?.message ?? 'Download failed. Please try again.', response.status);
  }
  return response.blob();
}

async function requestUpload(path, file) {
  const headers = buildHeaders();
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
  const headers = buildHeaders();
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
  // `confirmed` re-sends the identical body with ?confirm=true, to go through
  // with a rename the server first refused because it would restate the
  // medicine's name across every warehouse stocking it.
  updateCatalogItem: (id, changes, { confirmed = false } = {}) =>
    request(`/admin/catalog/${id}${confirmed ? '?confirm=true' : ''}`, {
      method: 'PATCH',
      body: changes,
    }),
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
