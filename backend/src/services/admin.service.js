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

// The two account types this section manages. Admins are never listed or acted
// on here - they have no Pharmacy/Warehouse profile and are not part of the
// approval/block lifecycle.
const ACCOUNT_ROLES = ['pharmacy', 'warehouse'];

// Same helper as productCatalog.service.escapeRegex - inlined rather than
// imported so this service (loaded on every admin request) doesn't pull the
// catalog/Excel module graph in behind it.
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Section 7: pharmacies and warehouses both start users.status = 'pending' and
// don't appear/operate in the app until an admin approves them. Admins are the
// only ones with this authority (never the warehouse itself).
async function listPendingAccounts() {
  // .select() on all three: admin.viewmodel.js reuses auth.viewmodel.js's
  // serializeUser / serializePharmacy / serializeWarehouse, whose field sets
  // are exactly these. `userId` stays on the profile rows as the join key.
  // Nothing here is saved (approve/reject load their own document via
  // findPendingUserOrThrow).
  const pendingUsers = await User.find({
    status: 'pending',
    role: { $in: ['pharmacy', 'warehouse'] },
  })
    .select('name phone role status lang')
    .sort({ createdAt: 1 });

  const pharmacyUserIds = pendingUsers.filter((u) => u.role === 'pharmacy').map((u) => u._id);
  const warehouseUserIds = pendingUsers.filter((u) => u.role === 'warehouse').map((u) => u._id);

  const [pharmacies, warehouses] = await Promise.all([
    Pharmacy.find({ userId: { $in: pharmacyUserIds } })
      .select('userId nameAr nameEn ownerName address city phone verificationPhoto'),
    Warehouse.find({ userId: { $in: warehouseUserIds } })
      .select('userId nameAr nameEn city phone logo'),
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

  // Same projection reasoning as listPendingAccounts above.
  const users = await User.find(filter).select('name phone role status lang').sort({ _id: 1 }).limit(limit + 1);
  const hasMore = users.length > limit;
  const page = hasMore ? users.slice(0, limit) : users;
  const nextCursor = page.length > 0 ? String(page[page.length - 1]._id) : null;

  if (page.length === 0) return { rows: [], hasMore: false, nextCursor: null };

  const userIds = page.map((u) => u._id);
  if (role === 'pharmacy') {
    const pharmacies = await Pharmacy.find({ userId: { $in: userIds } })
      .select('userId nameAr nameEn ownerName address city phone verificationPhoto');
    const pharmacyByUserId = new Map(pharmacies.map((p) => [p.userId.toString(), p]));
    const rows = page.map((user) => ({
      user,
      pharmacy: pharmacyByUserId.get(user._id.toString()) ?? null,
      warehouse: null,
    }));
    return { rows, hasMore, nextCursor };
  }

  const warehouses = await Warehouse.find({ userId: { $in: userIds } })
    .select('userId nameAr nameEn city phone logo');
  const warehouseByUserId = new Map(warehouses.map((w) => [w.userId.toString(), w]));
  const rows = page.map((user) => ({
    user,
    pharmacy: null,
    warehouse: warehouseByUserId.get(user._id.toString()) ?? null,
  }));
  return { rows, hasMore, nextCursor };
}

// --- Accounts management page --------------------------------------------------
//
// The Accounts page (unlike listPaginatedPendingAccounts above, which is the
// pending-only approval queue kept for the Dashboard) shows accounts of both
// types in every status, with type + status + server-side search filters and
// the same cursor "Load more" pagination every other admin list uses. Read-only
// -> .lean() throughout (approve/reject/block/unblock each load their own
// document via find*OrThrow and .save() it).

const ACCOUNTS_DEFAULT_LIMIT = 20;
// Mirrors user.model.js's status enum. Kept as a literal (not read from
// User.schema at load time) so the module still loads under the model-stubbed
// realtime emission tests.
const ACCOUNT_STATUSES = ['pending', 'active', 'blocked'];
// Reuses the exact projections/serializers of listPaginatedPendingAccounts;
// createdAt is added for the page's "Created" column (admin.viewmodel reads it).
const ACCOUNTS_USER_SELECT = 'name phone role status lang createdAt';
const ACCOUNTS_PHARMACY_SELECT = 'userId nameAr nameEn ownerName address city phone verificationPhoto';
const ACCOUNTS_WAREHOUSE_SELECT = 'userId nameAr nameEn city phone logo';

function resolveAccountRoles(role) {
  if (role === undefined || role === null || role === '') return ACCOUNT_ROLES;
  if (!ACCOUNT_ROLES.includes(role)) {
    throw ApiError.badRequest('Invalid account type filter.', undefined, 'INVALID_ROLE_FILTER');
  }
  return [role];
}

function assertValidStatusFilter(status) {
  if (status === undefined || status === null || status === '') return null;
  if (!ACCOUNT_STATUSES.includes(status)) {
    throw ApiError.badRequest('Invalid status filter.', undefined, 'INVALID_STATUS_FILTER');
  }
  return status;
}

// Server-side search: the term can match the User (name/phone) OR its profile
// (business name in either language, owner name, city, profile phone). Same
// shape as adminProduct.service's search - regex-match the related collections
// first, then fold their userIds into an $or on the User query. Returns the
// `$or` array, or null when there's nothing to search for. Regex is
// case-insensitive and escaped (unanchored, so it's a scan of these small
// admin-only collections - see docs/PERFORMANCE_OPTIMIZATION.md).
async function buildAccountSearchOr(roles, search) {
  const term = typeof search === 'string' ? search.trim() : '';
  if (!term) return null;

  const pattern = new RegExp(escapeRegex(term), 'i');
  const [pharmacies, warehouses] = await Promise.all([
    roles.includes('pharmacy')
      ? Pharmacy.find({
          $or: [
            { nameAr: pattern },
            { nameEn: pattern },
            { ownerName: pattern },
            { city: pattern },
            { phone: pattern },
          ],
        })
          .select('userId')
          .lean()
      : [],
    roles.includes('warehouse')
      ? Warehouse.find({
          $or: [{ nameAr: pattern }, { nameEn: pattern }, { city: pattern }, { phone: pattern }],
        })
          .select('userId')
          .lean()
      : [],
  ]);

  const profileUserIds = [...pharmacies, ...warehouses].map((doc) => doc.userId);
  return [{ name: pattern }, { phone: pattern }, { _id: { $in: profileUserIds } }];
}

async function listAccounts({ role, status, search, limit = ACCOUNTS_DEFAULT_LIMIT, after = null } = {}) {
  const roles = resolveAccountRoles(role);
  const statusFilter = assertValidStatusFilter(status);

  const base = { role: { $in: roles } };
  if (statusFilter) base.status = statusFilter;

  // `_id` appears in both the search `$or` and the cursor bound, which can't
  // share one object key - collect them under `$and`.
  const and = [];
  const searchOr = await buildAccountSearchOr(roles, search);
  if (searchOr) and.push({ $or: searchOr });
  if (after !== null) and.push({ _id: { $lt: after } });
  const filter = and.length > 0 ? { ...base, $and: and } : base;

  // Newest-first: a management list, not the FIFO approval queue. An ObjectId's
  // embedded timestamp makes `_id` descending equivalent to `createdAt`
  // descending, and `_id` is the stable unique cursor key.
  const users = await User.find(filter)
    .select(ACCOUNTS_USER_SELECT)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .lean();

  const hasMore = users.length > limit;
  const page = hasMore ? users.slice(0, limit) : users;
  const nextCursor = page.length > 0 ? String(page[page.length - 1]._id) : null;

  if (page.length === 0) return { rows: [], hasMore: false, nextCursor: null };

  const pharmacyUserIds = page.filter((u) => u.role === 'pharmacy').map((u) => u._id);
  const warehouseUserIds = page.filter((u) => u.role === 'warehouse').map((u) => u._id);

  const [pharmacies, warehouses] = await Promise.all([
    pharmacyUserIds.length > 0
      ? Pharmacy.find({ userId: { $in: pharmacyUserIds } }).select(ACCOUNTS_PHARMACY_SELECT).lean()
      : [],
    warehouseUserIds.length > 0
      ? Warehouse.find({ userId: { $in: warehouseUserIds } }).select(ACCOUNTS_WAREHOUSE_SELECT).lean()
      : [],
  ]);

  const pharmacyByUserId = new Map(pharmacies.map((p) => [p.userId.toString(), p]));
  const warehouseByUserId = new Map(warehouses.map((w) => [w.userId.toString(), w]));

  const rows = page.map((user) => ({
    user,
    pharmacy: pharmacyByUserId.get(user._id.toString()) ?? null,
    warehouse: warehouseByUserId.get(user._id.toString()) ?? null,
  }));

  return { rows, hasMore, nextCursor };
}

// Per-status totals for the filter pills - scoped to the current type filter and
// search term, independent of pagination and of the selected status. One grouped
// aggregate (served by the {role:1,status:1} index), same reasoning as
// adminComplaint.service's getStatusCounts.
async function countAccounts({ role, search } = {}) {
  const roles = resolveAccountRoles(role);
  const match = { role: { $in: roles } };
  const searchOr = await buildAccountSearchOr(roles, search);
  if (searchOr) match.$and = [{ $or: searchOr }];

  const grouped = await User.aggregate([
    { $match: match },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);

  const counts = { all: 0 };
  for (const status of ACCOUNT_STATUSES) counts[status] = 0;
  for (const { _id: status, count } of grouped) {
    if (counts[status] !== undefined) counts[status] = count;
    counts.all += count;
  }
  return counts;
}

// Block / Unblock target: a real pharmacy or warehouse account. Admins are
// never reachable here (they're not an ACCOUNT_ROLE), so an admin can't be
// blocked through this path even with a valid admin userId.
async function findManageableAccountOrThrow(userId) {
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    throw ApiError.badRequest('Invalid account id.', undefined, 'INVALID_ACCOUNT_ID');
  }
  const user = await User.findById(userId);
  if (!user || !ACCOUNT_ROLES.includes(user.role)) {
    throw ApiError.notFound('Account not found.', 'ACCOUNT_NOT_FOUND');
  }
  return user;
}

// active -> blocked. Only an active account can be blocked: a pending account is
// handled through Approve/Reject, and an already-blocked one is a no-op the UI
// never offers. The event mirrors approve/reject so a second admin's Accounts
// page drops the stale row - emitted only after the write is durable.
async function blockAccount(userId) {
  const user = await findManageableAccountOrThrow(userId);
  if (user.status !== 'active') {
    throw ApiError.badRequest(
      'Only an active account can be blocked.',
      undefined,
      'INVALID_STATUS_TRANSITION'
    );
  }
  user.status = 'blocked';
  await user.save();

  emitToAdmins(EVENTS.ACCOUNT_STATUS_UPDATED, {
    userId: user._id.toString(),
    role: user.role,
    status: user.status,
  });

  return user;
}

// blocked -> active. An admin-only administrative action: it lifts a block (or a
// rejection, which also lands in 'blocked' - see rejectAccount), it does not let
// an account activate itself. Unblock always resolves to 'active'.
async function unblockAccount(userId) {
  const user = await findManageableAccountOrThrow(userId);
  if (user.status !== 'blocked') {
    throw ApiError.badRequest(
      'Only a blocked account can be unblocked.',
      undefined,
      'INVALID_STATUS_TRANSITION'
    );
  }
  user.status = 'active';
  await user.save();

  emitToAdmins(EVENTS.ACCOUNT_STATUS_UPDATED, {
    userId: user._id.toString(),
    role: user.role,
    status: user.status,
  });

  return user;
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
  const existing = await User.findOne({ phone: cleanPhone }).select('_id');
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

    // Section 7: an admin-onboarded warehouse is born active - there's no
    // pending step. Reuses the account lifecycle event (not a new one) so a
    // second admin's Accounts page picks up the new row without a manual
    // refresh. Emitted only now, once both the User and Warehouse are durable.
    emitToAdmins(EVENTS.ACCOUNT_STATUS_UPDATED, {
      userId: user._id.toString(),
      role: 'warehouse',
      status: 'active',
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

  // .lean(): only `_id` is read, and this scans every active account -
  // hydrating each one into a document is pure waste on a broadcast.
  const users = await User.find(
    { status: 'active', role: { $in: ['pharmacy', 'warehouse'] } },
    '_id'
  ).lean();
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
  listAccounts,
  countAccounts,
  approveAccount,
  rejectAccount,
  blockAccount,
  unblockAccount,
  createWarehouseAccount,
  broadcastNotification,
};
