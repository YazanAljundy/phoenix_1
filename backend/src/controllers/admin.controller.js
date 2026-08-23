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

const approveAccount = asyncHandler(async (req, res) => {
  await adminService.approveAccount(req.params.userId);
  res.json({ success: true, message: 'Account approved.' });
});

const rejectAccount = asyncHandler(async (req, res) => {
  await adminService.rejectAccount(req.params.userId);
  res.json({ success: true, message: 'Account rejected.' });
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
  approveAccount,
  rejectAccount,
  createWarehouse,
  broadcastNotification,
};
