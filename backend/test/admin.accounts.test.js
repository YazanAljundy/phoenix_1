// Accounts management section (Section 3+): admin.service.listAccounts /
// countAccounts / blockAccount / unblockAccount, plus the createWarehouseAccount
// realtime signal and the admin-only route guard.
//
// Runs against its own database and drops it at the end - same pattern as
// projection.select.test.js / complaint.test.js. The realtime module is stubbed
// through require.cache (before the services load) so an admin-room emission can
// be observed without a socket server, while the Mongoose models stay real.
process.env.MONGODB_URI = 'mongodb://localhost:27017/phoenix-admin-accounts-test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-admin-accounts-tests';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const mongoose = require('mongoose');

const emitted = [];

function stubModule(relativePath, exportsValue) {
  const resolved = require.resolve(path.join(__dirname, '..', 'src', relativePath));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsValue };
}

stubModule('realtime/index.js', {
  emitToAdmins: (event, payload) => emitted.push({ room: 'admin', event, payload }),
  emitToWarehouse: (warehouseId, event, payload) =>
    emitted.push({ room: `warehouse:${warehouseId}`, event, payload }),
  EVENTS: {
    ACCOUNT_PENDING: 'account.pending',
    ACCOUNT_STATUS_UPDATED: 'account.status.updated',
  },
});

const User = require('../src/models/user.model');
const Pharmacy = require('../src/models/pharmacy.model');
const Warehouse = require('../src/models/warehouse.model');
const adminService = require('../src/services/admin.service');
const adminViewModel = require('../src/viewmodels/admin.viewmodel');
const { authorize } = require('../src/middlewares/auth.middleware');

// The services raise ApiError with a stable `code`; assert against that, not the
// human message.
function withCode(expected) {
  return (err) => {
    assert.strictEqual(err.code, expected, `expected error code ${expected}, got ${err.code}`);
    return true;
  };
}

const ids = {};

async function seedPharmacy(key, { name, nameEn, nameAr, owner, city, phone, status }) {
  const user = await User.create({ name, phone, role: 'pharmacy', status });
  await Pharmacy.create({
    userId: user._id,
    nameAr,
    nameEn,
    ownerName: owner,
    address: `${city} street`,
    city,
    phone,
    addedBy: 'self',
  });
  ids[key] = user._id;
}

async function seedWarehouse(key, { name, nameEn, nameAr, city, phone, status }) {
  const user = await User.create({ name, phone, role: 'warehouse', status });
  await Warehouse.create({
    userId: user._id,
    nameAr,
    nameEn,
    address: `${city} road`,
    city,
    phone,
    deliveryType: 'self',
    isActive: true,
  });
  ids[key] = user._id;
}

test.before(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  await mongoose.connection.dropDatabase();

  const admin = await User.create({
    name: 'The Admin',
    phone: '0900000000',
    role: 'admin',
    status: 'active',
  });
  ids.admin = admin._id;

  // 6 pharmacies: 3 active, 2 pending, 1 blocked.
  await seedPharmacy('phAlphaActive', {
    name: 'Sami Alpha', nameEn: 'Alpha Pharmacy', nameAr: 'صيدلية ألفا',
    owner: 'Sami Alpha', city: 'Latakia', phone: '0931000001', status: 'active',
  });
  await seedPharmacy('phBetaActive', {
    name: 'Nour Beta', nameEn: 'Beta Pharmacy', nameAr: 'صيدلية بيتا',
    owner: 'Nour Beta', city: 'Aleppo', phone: '0931000002', status: 'active',
  });
  await seedPharmacy('phGammaActive', {
    name: 'Rana Gamma', nameEn: 'Gamma Pharmacy', nameAr: 'صيدلية غاما',
    owner: 'Rana Gamma', city: 'Homs', phone: '0931000003', status: 'active',
  });
  await seedPharmacy('phDeltaPending', {
    name: 'Omar Delta', nameEn: 'Delta Pharmacy', nameAr: 'صيدلية دلتا',
    owner: 'Omar Delta', city: 'Latakia', phone: '0931000004', status: 'pending',
  });
  await seedPharmacy('phEpsilonPending', {
    name: 'Lina Epsilon', nameEn: 'Epsilon Pharmacy', nameAr: 'صيدلية إبسيلون',
    owner: 'Lina Epsilon', city: 'Latakia', phone: '0931000005', status: 'pending',
  });
  await seedPharmacy('phZetaBlocked', {
    name: 'Ziad Zeta', nameEn: 'Zeta Pharmacy', nameAr: 'صيدلية زيتا',
    owner: 'Ziad Zeta', city: 'Latakia', phone: '0931000006', status: 'blocked',
  });

  // 3 warehouses: 2 active, 1 blocked. Never pending.
  await seedWarehouse('whNorthActive', {
    name: 'North WH Owner', nameEn: 'North Warehouse', nameAr: 'مستودع الشمال',
    city: 'Latakia', phone: '0941000001', status: 'active',
  });
  await seedWarehouse('whSouthActive', {
    name: 'South WH Owner', nameEn: 'South Warehouse', nameAr: 'مستودع الجنوب',
    city: 'Damascus', phone: '0941000002', status: 'active',
  });
  await seedWarehouse('whEastBlocked', {
    name: 'East WH Owner', nameEn: 'East Warehouse', nameAr: 'مستودع الشرق',
    city: 'Latakia', phone: '0941000003', status: 'blocked',
  });
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test.beforeEach(() => {
  emitted.length = 0;
});

// --- listAccounts: type + status filtering ---------------------------------

test('lists accounts of both roles when no filter is given', async () => {
  const { rows } = await adminService.listAccounts({ limit: 100 });
  assert.strictEqual(rows.length, 9);
  const roles = new Set(rows.map((r) => r.user.role));
  assert.deepStrictEqual([...roles].sort(), ['pharmacy', 'warehouse']);
  // Newest-first.
  const created = rows.map((r) => r.user._id.toString());
  assert.deepStrictEqual(created, [...created].sort().reverse());
});

test('role filter = pharmacy returns only pharmacies (+ their profile)', async () => {
  const { rows } = await adminService.listAccounts({ role: 'pharmacy', limit: 100 });
  assert.strictEqual(rows.length, 6);
  assert.ok(rows.every((r) => r.user.role === 'pharmacy' && r.pharmacy && !r.warehouse));
});

test('role filter = warehouse returns only warehouses (+ their profile)', async () => {
  const { rows } = await adminService.listAccounts({ role: 'warehouse', limit: 100 });
  assert.strictEqual(rows.length, 3);
  assert.ok(rows.every((r) => r.user.role === 'warehouse' && r.warehouse && !r.pharmacy));
});

test('status filter = active / pending / blocked', async () => {
  const active = await adminService.listAccounts({ status: 'active', limit: 100 });
  assert.strictEqual(active.rows.length, 5);
  assert.ok(active.rows.every((r) => r.user.status === 'active'));

  const pending = await adminService.listAccounts({ status: 'pending', limit: 100 });
  assert.strictEqual(pending.rows.length, 2);
  assert.ok(pending.rows.every((r) => r.user.role === 'pharmacy'));

  const blocked = await adminService.listAccounts({ status: 'blocked', limit: 100 });
  assert.strictEqual(blocked.rows.length, 2);
});

test('warehouse + pending is naturally empty (warehouses are never pending)', async () => {
  const { rows } = await adminService.listAccounts({ role: 'warehouse', status: 'pending', limit: 100 });
  assert.deepStrictEqual(rows, []);
});

test('an invalid role/status filter is rejected, not silently honoured', async () => {
  await assert.rejects(
    () => adminService.listAccounts({ role: 'admin' }),
    withCode('INVALID_ROLE_FILTER')
  );
  await assert.rejects(
    () => adminService.listAccounts({ status: 'deleted' }),
    withCode('INVALID_STATUS_FILTER')
  );
});

// --- Pagination -----------------------------------------------------------

test('cursor pagination walks the whole set with no repeats or gaps', async () => {
  // The service returns a raw last-id cursor even on the final page (same as
  // listPaginatedPendingAccounts); the controller's paginationMeta nulls it
  // when hasMore is false. Here we drive the service, so stop on hasMore.
  const seen = [];
  let cursor = null;
  for (let i = 0; i < 10; i += 1) {
    const page = await adminService.listAccounts({ role: 'pharmacy', limit: 2, after: cursor });
    seen.push(...page.rows.map((r) => r.user._id.toString()));
    if (!page.hasMore) break;
    assert.ok(page.nextCursor);
    cursor = page.nextCursor;
  }
  assert.strictEqual(seen.length, 6);
  assert.strictEqual(new Set(seen).size, 6);
});

// --- Search --------------------------------------------------------------

test('search matches the business name (nameEn / nameAr)', async () => {
  const byEn = await adminService.listAccounts({ search: 'Gamma Pharmacy', limit: 100 });
  assert.strictEqual(byEn.rows.length, 1);
  assert.strictEqual(byEn.rows[0].pharmacy.nameEn, 'Gamma Pharmacy');

  const byAr = await adminService.listAccounts({ search: 'مستودع الشمال', limit: 100 });
  assert.strictEqual(byAr.rows.length, 1);
  assert.strictEqual(byAr.rows[0].warehouse.nameEn, 'North Warehouse');
});

test('search matches phone, owner name and city', async () => {
  const byPhone = await adminService.listAccounts({ search: '0931000002', limit: 100 });
  assert.strictEqual(byPhone.rows.length, 1);
  assert.strictEqual(byPhone.rows[0].pharmacy.nameEn, 'Beta Pharmacy');

  const byOwner = await adminService.listAccounts({ search: 'Rana', limit: 100 });
  assert.strictEqual(byOwner.rows.length, 1);
  assert.strictEqual(byOwner.rows[0].pharmacy.ownerName, 'Rana Gamma');

  const byCity = await adminService.listAccounts({ search: 'Aleppo', role: 'pharmacy', limit: 100 });
  assert.strictEqual(byCity.rows.length, 1);
  assert.strictEqual(byCity.rows[0].pharmacy.city, 'Aleppo');
});

test('search combines with role + status', async () => {
  // "Latakia" hits 4 pharmacies (1 active, 2 pending, 1 blocked) + 2 warehouses.
  const pendingInLatakia = await adminService.listAccounts({
    role: 'pharmacy',
    status: 'pending',
    search: 'Latakia',
    limit: 100,
  });
  assert.strictEqual(pendingInLatakia.rows.length, 2);
  assert.ok(pendingInLatakia.rows.every((r) => r.user.status === 'pending'));
});

test('search combines with pagination', async () => {
  const seen = [];
  let cursor = null;
  for (let i = 0; i < 10; i += 1) {
    const page = await adminService.listAccounts({ search: 'Pharmacy', limit: 2, after: cursor });
    seen.push(...page.rows.map((r) => r.pharmacy.nameEn));
    if (!page.hasMore) break;
    cursor = page.nextCursor;
  }
  assert.strictEqual(seen.length, 6);
  assert.strictEqual(new Set(seen).size, 6);
});

// --- countAccounts -----------------------------------------------------

test('counts are scoped to the type filter; warehouses never carry pending', async () => {
  const all = await adminService.countAccounts({});
  assert.deepStrictEqual(all, { all: 9, active: 5, pending: 2, blocked: 2 });

  const pharmacy = await adminService.countAccounts({ role: 'pharmacy' });
  assert.deepStrictEqual(pharmacy, { all: 6, active: 3, pending: 2, blocked: 1 });

  const warehouse = await adminService.countAccounts({ role: 'warehouse' });
  assert.deepStrictEqual(warehouse, { all: 3, active: 2, pending: 0, blocked: 1 });
});

test('counts reflect the search term', async () => {
  const counts = await adminService.countAccounts({ search: 'Latakia' });
  // 4 Latakia pharmacies (1 active / 2 pending / 1 blocked) + 2 Latakia warehouses (1 active / 1 blocked).
  assert.deepStrictEqual(counts, { all: 6, active: 2, pending: 2, blocked: 2 });
});

// --- viewmodel projection guard --------------------------------------------

test('toAccountsResponse carries createdAt, status and profile fields (.lean projection)', async () => {
  const { rows } = await adminService.listAccounts({ role: 'pharmacy', status: 'active', limit: 1 });
  const { accounts } = adminViewModel.toAccountsResponse(rows);
  const item = accounts[0];
  assert.ok(item.user.createdAt instanceof Date, 'user.createdAt survives the projection');
  assert.strictEqual(item.user.status, 'active');
  assert.ok(item.user.phone);
  assert.ok(item.user.role);
  assert.ok(item.pharmacy.nameEn);
  assert.ok(item.pharmacy.ownerName);
  assert.strictEqual(item.warehouse, null);
});

// --- Block / Unblock -----------------------------------------------------

async function setStatus(userId, status) {
  await User.updateOne({ _id: userId }, { $set: { status } });
}

test('blockAccount: active pharmacy -> blocked, one admin event', async () => {
  await setStatus(ids.phAlphaActive, 'active');
  const user = await adminService.blockAccount(ids.phAlphaActive.toString());
  assert.strictEqual(user.status, 'blocked');
  assert.strictEqual((await User.findById(ids.phAlphaActive)).status, 'blocked');
  assert.strictEqual(emitted.length, 1);
  assert.deepStrictEqual(emitted[0], {
    room: 'admin',
    event: 'account.status.updated',
    payload: { userId: ids.phAlphaActive.toString(), role: 'pharmacy', status: 'blocked' },
  });
});

test('unblockAccount: blocked pharmacy -> active, one admin event', async () => {
  await setStatus(ids.phAlphaActive, 'blocked');
  const user = await adminService.unblockAccount(ids.phAlphaActive.toString());
  assert.strictEqual(user.status, 'active');
  assert.strictEqual(emitted.length, 1);
  assert.strictEqual(emitted[0].payload.status, 'active');
  assert.strictEqual(emitted[0].payload.role, 'pharmacy');
});

test('blockAccount / unblockAccount work for warehouses too', async () => {
  await setStatus(ids.whNorthActive, 'active');
  await adminService.blockAccount(ids.whNorthActive.toString());
  assert.strictEqual((await User.findById(ids.whNorthActive)).status, 'blocked');
  assert.strictEqual(emitted[0].payload.role, 'warehouse');

  emitted.length = 0;
  await adminService.unblockAccount(ids.whNorthActive.toString());
  assert.strictEqual((await User.findById(ids.whNorthActive)).status, 'active');
  assert.strictEqual(emitted[0].payload.status, 'active');
});

test('blocking a non-active account is rejected and emits nothing', async () => {
  await assert.rejects(
    () => adminService.blockAccount(ids.phDeltaPending.toString()),
    withCode('INVALID_STATUS_TRANSITION')
  );
  await setStatus(ids.phZetaBlocked, 'blocked');
  await assert.rejects(
    () => adminService.blockAccount(ids.phZetaBlocked.toString()),
    withCode('INVALID_STATUS_TRANSITION')
  );
  assert.deepStrictEqual(emitted, []);
});

test('unblocking a non-blocked account is rejected and emits nothing', async () => {
  await setStatus(ids.phBetaActive, 'active');
  await assert.rejects(
    () => adminService.unblockAccount(ids.phBetaActive.toString()),
    withCode('INVALID_STATUS_TRANSITION')
  );
  assert.deepStrictEqual(emitted, []);
});

test('block/unblock on an unknown id or an admin id is rejected', async () => {
  await assert.rejects(
    () => adminService.blockAccount('not-an-object-id'),
    withCode('INVALID_ACCOUNT_ID')
  );
  await assert.rejects(
    () => adminService.blockAccount(new mongoose.Types.ObjectId().toString()),
    withCode('ACCOUNT_NOT_FOUND')
  );
  await assert.rejects(
    () => adminService.blockAccount(ids.admin.toString()),
    withCode('ACCOUNT_NOT_FOUND')
  );
  assert.deepStrictEqual(emitted, []);
});

// --- Add Warehouse: born active + realtime signal -------------------------

test('createWarehouseAccount emits one account.status.updated {warehouse, active}', async () => {
  const { user, warehouse } = await adminService.createWarehouseAccount({
    ownerName: 'Fresh Owner',
    phone: '0949999999',
    password: 'secret1',
    nameAr: 'مستودع جديد',
    nameEn: 'Fresh Warehouse',
    city: 'Latakia',
    address: 'Fresh road',
    deliveryType: 'self',
  });

  assert.strictEqual(user.status, 'active');
  assert.strictEqual((await User.findById(user._id)).status, 'active');
  assert.ok(await Warehouse.findOne({ userId: user._id }));

  const accountEvents = emitted.filter((e) => e.event === 'account.status.updated');
  assert.strictEqual(accountEvents.length, 1);
  assert.deepStrictEqual(accountEvents[0], {
    room: 'admin',
    event: 'account.status.updated',
    payload: { userId: user._id.toString(), role: 'warehouse', status: 'active' },
  });
  assert.ok(warehouse._id);
});

// --- Route guard: admin-only, query params never grant access -------------

test('authorize("admin") rejects pharmacy/warehouse and ignores query params', () => {
  const asPharmacy = { user: { role: 'pharmacy' }, query: { role: 'admin', status: 'active' } };
  const asWarehouse = { user: { role: 'warehouse' }, query: {} };
  assert.throws(() => authorize('admin')(asPharmacy, {}, () => {}), /permission/);
  assert.throws(() => authorize('admin')(asWarehouse, {}, () => {}), /permission/);

  let passed = false;
  authorize('admin')({ user: { role: 'admin' }, query: {} }, {}, () => {
    passed = true;
  });
  assert.ok(passed, 'an admin passes the guard');
});
