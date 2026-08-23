const mongoose = require('mongoose');
const { ApiError } = require('../utils/ApiError');
const User = require('../models/user.model');
const Pharmacy = require('../models/pharmacy.model');
const Warehouse = require('../models/warehouse.model');
const notificationService = require('./notification.service');

// Section 7: pharmacies and warehouses both start users.status = 'pending' and
// don't appear/operate in the app until an admin approves them. Admins are the
// only ones with this authority (never the warehouse itself).
async function listPendingAccounts() {
  const pendingUsers = await User.find({
    status: 'pending',
    role: { $in: ['pharmacy', 'warehouse'] },
  }).sort({ createdAt: 1 });

  const pharmacyUserIds = pendingUsers.filter((u) => u.role === 'pharmacy').map((u) => u._id);
  const warehouseUserIds = pendingUsers.filter((u) => u.role === 'warehouse').map((u) => u._id);

  const [pharmacies, warehouses] = await Promise.all([
    Pharmacy.find({ userId: { $in: pharmacyUserIds } }),
    Warehouse.find({ userId: { $in: warehouseUserIds } }),
  ]);

  const pharmacyByUserId = new Map(pharmacies.map((p) => [p.userId.toString(), p]));
  const warehouseByUserId = new Map(warehouses.map((w) => [w.userId.toString(), w]));

  return pendingUsers.map((user) => ({
    user,
    pharmacy: pharmacyByUserId.get(user._id.toString()) ?? null,
    warehouse: warehouseByUserId.get(user._id.toString()) ?? null,
  }));
}

const PENDING_ACCOUNTS_DEFAULT_LIMIT = 20;

// The tab counts (how many pending pharmacies/warehouses there are) must
// stay accurate regardless of pagination - a couple of cheap counts, not
// tied to whichever page/role is currently loaded.
async function countPendingAccountsByRole() {
  const [pharmacyCount, warehouseCount] = await Promise.all([
    User.countDocuments({ status: 'pending', role: 'pharmacy' }),
    User.countDocuments({ status: 'pending', role: 'warehouse' }),
  ]);
  return { pharmacyCount, warehouseCount };
}

// The Pending Accounts management page (unlike listPendingAccounts above -
// still used as-is by the Dashboard's stat card/recent-list, which needs
// every pending account of both roles at once) wants one role's queue at a
// time with "Load more" - same oldest-first order as before (an ObjectId's
// embedded timestamp makes `_id` ascending equivalent to `createdAt`
// ascending), just scoped to whichever tab is active.
async function listPaginatedPendingAccounts(role, { limit = PENDING_ACCOUNTS_DEFAULT_LIMIT, after = null } = {}) {
  const filter = { status: 'pending', role };
  if (after !== null) {
    filter._id = { $gt: after };
  }

  const users = await User.find(filter).sort({ _id: 1 }).limit(limit + 1);
  const hasMore = users.length > limit;
  const page = hasMore ? users.slice(0, limit) : users;
  const nextCursor = page.length > 0 ? String(page[page.length - 1]._id) : null;

  if (page.length === 0) return { rows: [], hasMore: false, nextCursor: null };

  const userIds = page.map((u) => u._id);
  if (role === 'pharmacy') {
    const pharmacies = await Pharmacy.find({ userId: { $in: userIds } });
    const pharmacyByUserId = new Map(pharmacies.map((p) => [p.userId.toString(), p]));
    const rows = page.map((user) => ({
      user,
      pharmacy: pharmacyByUserId.get(user._id.toString()) ?? null,
      warehouse: null,
    }));
    return { rows, hasMore, nextCursor };
  }

  const warehouses = await Warehouse.find({ userId: { $in: userIds } });
  const warehouseByUserId = new Map(warehouses.map((w) => [w.userId.toString(), w]));
  const rows = page.map((user) => ({
    user,
    pharmacy: null,
    warehouse: warehouseByUserId.get(user._id.toString()) ?? null,
  }));
  return { rows, hasMore, nextCursor };
}

async function findPendingUserOrThrow(userId) {
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    throw ApiError.badRequest('Invalid account id.');
  }
  const user = await User.findById(userId);
  if (!user) {
    throw ApiError.notFound('Account not found.');
  }
  if (user.status !== 'pending') {
    throw ApiError.badRequest('This account is not pending approval.');
  }
  return user;
}

async function approveAccount(userId) {
  const user = await findPendingUserOrThrow(userId);
  user.status = 'active';
  await user.save();
  return user;
}

// The schema (Section 8) has no separate "rejected" state for users - only
// pending/active/blocked - so rejecting a pending account maps to 'blocked',
// the same status used later for blocking an already-active account.
async function rejectAccount(userId) {
  const user = await findPendingUserOrThrow(userId);
  user.status = 'blocked';
  await user.save();
  return user;
}

// A general announcement from the admin - to every active pharmacy/warehouse
// account, not other admins (this is the admin broadcasting to the app's
// users, not to its own peers).
async function broadcastNotification({ titleAr, titleEn, bodyAr, bodyEn, adminUserId }) {
  if (!titleAr || !titleEn || !bodyAr || !bodyEn) {
    throw ApiError.badRequest(
      'titleAr, titleEn, bodyAr and bodyEn are all required.',
      undefined,
      'INVALID_REQUEST'
    );
  }

  const users = await User.find({ status: 'active', role: { $in: ['pharmacy', 'warehouse'] } }, '_id');
  await notificationService.sendToAll(
    users.map((u) => u._id),
    { titleAr, titleEn, bodyAr, bodyEn, type: 'system', sentByAdminId: adminUserId }
  );
  return users.length;
}

module.exports = {
  listPendingAccounts,
  listPaginatedPendingAccounts,
  countPendingAccountsByRole,
  approveAccount,
  rejectAccount,
  broadcastNotification,
};
