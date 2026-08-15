const mongoose = require('mongoose');
const { ApiError } = require('../utils/ApiError');
const User = require('../models/user.model');
const Pharmacy = require('../models/pharmacy.model');
const Warehouse = require('../models/warehouse.model');

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

module.exports = { listPendingAccounts, approveAccount, rejectAccount };
