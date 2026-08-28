const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const { ApiError } = require('../utils/ApiError');
const User = require('../models/user.model');
const Pharmacy = require('../models/pharmacy.model');
const Warehouse = require('../models/warehouse.model');
const notificationService = require('./notification.service');
const { emitToAdmins, EVENTS } = require('../realtime');

const BCRYPT_SALT_ROUNDS = 10;
const MIN_PASSWORD_LENGTH = 6;

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

// The decision events below exist for the multi-admin case: whoever acted
// already updates from their own HTTP response, but a second admin looking at
// the same queue would otherwise keep seeing - and could try to act on - an
// account that's already been handled.
async function approveAccount(userId) {
  const user = await findPendingUserOrThrow(userId);
  user.status = 'active';
  await user.save();

  emitToAdmins(EVENTS.ACCOUNT_STATUS_UPDATED, {
    userId: user._id.toString(),
    role: user.role,
    status: user.status,
  });

  return user;
}

// The schema (Section 8) has no separate "rejected" state for users - only
// pending/active/blocked - so rejecting a pending account maps to 'blocked',
// the same status used later for blocking an already-active account.
async function rejectAccount(userId) {
  const user = await findPendingUserOrThrow(userId);
  user.status = 'blocked';
  await user.save();

  emitToAdmins(EVENTS.ACCOUNT_STATUS_UPDATED, {
    userId: user._id.toString(),
    role: user.role,
    status: user.status,
  });

  return user;
}

function requiredString(value, field, code) {
  if (typeof value !== 'string' || !value.trim()) {
    throw ApiError.badRequest(`${field} is required.`, undefined, code);
  }
  return value.trim();
}

// Every warehouse starts on the same terms; changing them for one warehouse
// is a later, separate edit, not something the admin re-enters on every
// create. Deliberately NOT read from the request body - a client can't set
// its own rates by adding the fields to the payload.
const DEFAULT_DISCOUNT_RATE = 4;
const DEFAULT_COMMISSION_RATE = 1;

// Section 7 counterpart to approveAccount above: a warehouse the admin
// onboards directly, rather than one that self-registered and is waiting for
// approval. It's created already-active - the admin creating it IS the
// approval step, so there's deliberately no second confirmation.
//
// This is the only place in the app that mints a warehouse login. There's no
// warehouse self-registration route (auth.service.js's registerOrLogin is
// hardcoded to role 'pharmacy'), which is what keeps the role boundary intact.
async function createWarehouseAccount({
  ownerName,
  phone,
  password,
  nameAr,
  nameEn,
  city,
  address,
  deliveryType,
}) {
  const cleanOwnerName = requiredString(ownerName, 'Owner name', 'INVALID_OWNER_NAME');
  const cleanPhone = requiredString(phone, 'Phone', 'INVALID_PHONE');
  const cleanNameAr = requiredString(nameAr, 'Arabic warehouse name', 'INVALID_WAREHOUSE_NAME');
  const cleanCity = requiredString(city, 'City', 'INVALID_CITY');
  const cleanAddress = requiredString(address, 'Address', 'INVALID_ADDRESS');

  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw ApiError.badRequest(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      undefined,
      'INVALID_PASSWORD'
    );
  }

  // Optional per the admin form - the Warehouse model still requires it, so
  // it falls back to the Arabic name rather than being left unset.
  const cleanNameEn =
    typeof nameEn === 'string' && nameEn.trim() ? nameEn.trim() : cleanNameAr;

  const resolvedDeliveryType = deliveryType === undefined || deliveryType === null || deliveryType === ''
    ? 'self'
    : deliveryType;
  if (!Warehouse.schema.path('deliveryType').enumValues.includes(resolvedDeliveryType)) {
    throw ApiError.badRequest('Invalid delivery type.', undefined, 'INVALID_DELIVERY_TYPE');
  }

  // Checked up front for a clear error message; the unique index on
  // users.phone is still the real guard against a concurrent duplicate (see
  // the catch below).
  const existing = await User.findOne({ phone: cleanPhone });
  if (existing) {
    throw ApiError.conflict('An account already exists for this phone number.', 'PHONE_ALREADY_REGISTERED');
  }

  const hashedPassword = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

  let user;
  try {
    user = await User.create({
      name: cleanOwnerName,
      phone: cleanPhone,
      password: hashedPassword,
      role: 'warehouse',
      status: 'active',
    });
  } catch (err) {
    // 11000 = duplicate key: another request took this phone between the
    // findOne above and this insert.
    if (err && err.code === 11000) {
      throw ApiError.conflict('An account already exists for this phone number.', 'PHONE_ALREADY_REGISTERED');
    }
    throw err;
  }

  try {
    const warehouse = await Warehouse.create({
      userId: user._id,
      nameAr: cleanNameAr,
      nameEn: cleanNameEn,
      address: cleanAddress,
      city: cleanCity,
      phone: cleanPhone,
      discountRate: DEFAULT_DISCOUNT_RATE,
      commissionRate: DEFAULT_COMMISSION_RATE,
      deliveryType: resolvedDeliveryType,
      isActive: true,
    });

    return { user, warehouse };
  } catch (err) {
    // Without this the user row survives on its own: a login that resolves to
    // no warehouse profile, permanently holding a phone number that the admin
    // can't reuse to retry. Same cleanup-on-failure principle as the banner
    // upload handlers (adminBanner.controller.js).
    await User.deleteOne({ _id: user._id });
    throw err;
  }
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
  createWarehouseAccount,
  broadcastNotification,
};
