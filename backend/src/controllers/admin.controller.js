const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const adminService = require('../services/admin.service');
const adminViewModel = require('../viewmodels/admin.viewmodel');
const { parseCursorQuery, parseObjectIdCursor, paginationMeta } = require('../utils/pagination');

// Two shapes on one endpoint: the Dashboard's stat card/recent-list calls
// this with no `limit` and needs every pending account of both roles at
// once - only the Pending Accounts management page opts into pagination,
// which is role-scoped (one tab at a time) so it also requires `role`.
const listPendingAccounts = asyncHandler(async (req, res) => {
  if (req.query.limit === undefined) {
    const items = await adminService.listPendingAccounts();
    res.json({ success: true, ...adminViewModel.toPendingAccountsResponse(items) });
    return;
  }

  const role = req.query.role;
  if (role !== 'pharmacy' && role !== 'warehouse') {
    throw ApiError.badRequest('Invalid role filter.', undefined, 'INVALID_ROLE_FILTER');
  }
  const { limit, after } = parseCursorQuery(req.query, 20);
  const cursor = parseObjectIdCursor(after);
  const [{ rows, hasMore, nextCursor }, counts] = await Promise.all([
    adminService.listPaginatedPendingAccounts(role, { limit, after: cursor }),
    adminService.countPendingAccountsByRole(),
  ]);
  res.json({
    success: true,
    ...adminViewModel.toPendingAccountsResponse(rows),
    pagination: paginationMeta(hasMore, nextCursor),
    pharmacyCount: counts.pharmacyCount,
    warehouseCount: counts.warehouseCount,
  });
});

// The Accounts management page: both roles, every status, with type + status +
// server-side search filters and the same cursor "Load more" pagination the
// other admin lists use. The `role`/`status` query params only ever narrow the
// result set - authorization is the router-level authorize('admin') and never
// anything a client sends (a `?role=admin` is rejected as an invalid filter,
// not honoured). Counts travel with the page so the filter pills stay accurate
// regardless of pagination.
const listAccounts = asyncHandler(async (req, res) => {
  const { role, status } = req.query;
  const search = typeof req.query.search === 'string' ? req.query.search : '';
  const { limit, after } = parseCursorQuery(req.query, 20);
  const cursor = parseObjectIdCursor(after);

  const [{ rows, hasMore, nextCursor }, counts] = await Promise.all([
    adminService.listAccounts({ role, status, search, limit, after: cursor }),
    adminService.countAccounts({ role, search }),
  ]);

  res.json({
    success: true,
    ...adminViewModel.toAccountsResponse(rows),
    pagination: paginationMeta(hasMore, nextCursor),
    counts,
  });
});

const approveAccount = asyncHandler(async (req, res) => {
  await adminService.approveAccount(req.params.userId);
  res.json({ success: true, message: 'Account approved.' });
});

const rejectAccount = asyncHandler(async (req, res) => {
  await adminService.rejectAccount(req.params.userId);
  res.json({ success: true, message: 'Account rejected.' });
});

// active -> blocked. Admin-only (router guard); a pharmacy or warehouse can
// never reach this. The service validates the state transition and emits the
// realtime signal only after the write succeeds.
const blockAccount = asyncHandler(async (req, res) => {
  await adminService.blockAccount(req.params.userId);
  res.json({ success: true, message: 'Account blocked.' });
});

// blocked -> active. Admin-only administrative action - it does not let an
// account activate itself or bypass approval.
const unblockAccount = asyncHandler(async (req, res) => {
  await adminService.unblockAccount(req.params.userId);
  res.json({ success: true, message: 'Account unblocked.' });
});

// The response deliberately carries no password - not even the one just
// submitted. The admin panel already has the plaintext it typed and shows it
// once locally; echoing it back would put it in server logs/proxies for no
// gain.
const createWarehouse = asyncHandler(async (req, res) => {
  const { user, warehouse } = await adminService.createWarehouseAccount(req.body);
  res.status(201).json({
    success: true,
    message: 'Warehouse created.',
    userId: user._id,
    warehouseId: warehouse._id,
    phone: user.phone,
    nameAr: warehouse.nameAr,
  });
});

const broadcastNotification = asyncHandler(async (req, res) => {
  const { titleAr, titleEn, bodyAr, bodyEn } = req.body;
  const recipientCount = await adminService.broadcastNotification({
    titleAr,
    titleEn,
    bodyAr,
    bodyEn,
    adminUserId: req.user._id,
  });
  res.json({ success: true, message: 'Notification sent.', recipientCount });
});

module.exports = {
  listPendingAccounts,
  listAccounts,
  approveAccount,
  rejectAccount,
  blockAccount,
  unblockAccount,
  createWarehouse,
  broadcastNotification,
};
