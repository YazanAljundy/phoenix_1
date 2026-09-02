// Regression tests for the read paths that were switched to .lean() and, on
// the auth service, given explicit .select() projections.
//
// .lean() is not free of behavioural risk: a lean document is raw BSON, so
// Mongoose does not apply schema defaults to it. Any field that was added to a
// schema after some documents already existed is therefore present on a
// hydrated document and absent on a lean one - which would silently drop keys
// from an API response.
//
// warehouses.minOrderAmountUsd / maxOrderAmountUsd are exactly that case (see
// the comment in warehouse.model.js), and the development database really does
// contain a warehouse without them. These tests pin the resulting JSON so the
// optimisation cannot quietly change the contract.
//
// The .select() projections in auth.service.js carry a matching risk in the
// other direction: a projection that forgets a field the viewmodel or a later
// guard reads would return undefined for it. The auth tests below pin the full
// key set of every auth response and exercise the blocked-status guard and the
// password comparison, so a too-narrow projection fails loudly here.
process.env.MONGODB_URI = 'mongodb://localhost:27017/phoenix-leanpath-test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-lean-tests';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const User = require('../src/models/user.model');
const Warehouse = require('../src/models/warehouse.model');
const Pharmacy = require('../src/models/pharmacy.model');
const Category = require('../src/models/category.model');

const warehouseService = require('../src/services/warehouse.service');
const categoryService = require('../src/services/category.service');
const authService = require('../src/services/auth.service');
const warehouseViewModel = require('../src/viewmodels/warehouse.viewmodel');
const categoryViewModel = require('../src/viewmodels/category.viewmodel');
const authViewModel = require('../src/viewmodels/auth.viewmodel');
const { authenticateToken } = require('../src/middlewares/auth.middleware');
const jwt = require('jsonwebtoken');

const LEGACY_WAREHOUSE_ID = new mongoose.Types.ObjectId();
const MODERN_WAREHOUSE_ID = new mongoose.Types.ObjectId();
const PHARMACY_USER_ID = new mongoose.Types.ObjectId();
const LEGACY_WAREHOUSE_USER_ID = new mongoose.Types.ObjectId();
const PASSWORD_USER_ID = new mongoose.Types.ObjectId();
const PASSWORD_USER_PHONE = '0910000009';
const PASSWORD_USER_SECRET = 'correct horse';

test.before(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  await mongoose.connection.dropDatabase();

  const legacyUserId = LEGACY_WAREHOUSE_USER_ID;
  const modernUserId = new mongoose.Types.ObjectId();
  await User.create([
    { _id: legacyUserId, name: 'Legacy WH', phone: '0910000001', role: 'warehouse', status: 'active' },
    { _id: modernUserId, name: 'Modern WH', phone: '0910000002', role: 'warehouse', status: 'active' },
    { _id: PHARMACY_USER_ID, name: 'Pharm', phone: '0910000003', role: 'pharmacy', status: 'active' },
    {
      _id: PASSWORD_USER_ID, name: 'Pw Pharm', phone: PASSWORD_USER_PHONE,
      role: 'pharmacy', status: 'active',
      password: await bcrypt.hash(PASSWORD_USER_SECRET, 10),
    },
  ]);
  await Pharmacy.create([
    {
      userId: PHARMACY_USER_ID, nameAr: 'ص', nameEn: 'Ph', ownerName: 'Owner',
      address: 'addr', city: 'Latakia', phone: '0910000003', addedBy: 'self',
    },
    {
      userId: PASSWORD_USER_ID, nameAr: 'ص2', nameEn: 'PwPh', ownerName: 'Pw Owner',
      address: 'addr', city: 'Latakia', phone: PASSWORD_USER_PHONE, addedBy: 'self',
    },
  ]);

  // Inserted through the raw driver, bypassing Mongoose, so the two
  // order-limit fields are genuinely absent - reproducing a warehouse that
  // predates them, exactly like the one in the development database.
  await mongoose.connection.collection('warehouses').insertOne({
    _id: LEGACY_WAREHOUSE_ID,
    userId: legacyUserId,
    nameAr: 'قديم', nameEn: 'Legacy Warehouse',
    address: 'addr', city: 'Latakia', phone: '0910000001',
    logo: null, discountRate: 4, commissionRate: 1,
    deliveryStartTime: null, deliveryEndTime: null, inventoryUpdateTime: null,
    averageRating: 0, reviewsCount: 0, deliveryType: 'self',
    isActive: true, createdAt: new Date(), updatedAt: new Date(), __v: 0,
  });

  await Warehouse.create({
    _id: MODERN_WAREHOUSE_ID, userId: modernUserId,
    nameAr: 'حديث', nameEn: 'Modern Warehouse',
    address: 'addr', city: 'Latakia', phone: '0910000002', isActive: true,
    minOrderAmountUsd: 25, maxOrderAmountUsd: 500,
  });

  await Category.create([
    { nameAr: 'ف1', nameEn: 'Cat 1', icon: 'i1', sortOrder: 2 },
    { nameAr: 'ف2', nameEn: 'Cat 2', icon: 'i2', sortOrder: 1 },
  ]);
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test('warehouse list still reports order limits for a document that predates those fields', async () => {
  const warehouses = await warehouseService.listAvailableWarehouses();
  const payload = warehouseViewModel.toWarehouseListResponse(warehouses);

  const legacy = payload.warehouses.find((w) => w.nameEn === 'Legacy Warehouse');
  assert.ok(legacy, 'the legacy warehouse must still be listed');
  assert.ok('minOrderAmountUsd' in legacy, 'key must be present, not dropped by .lean()');
  assert.ok('maxOrderAmountUsd' in legacy, 'key must be present, not dropped by .lean()');
  assert.strictEqual(legacy.minOrderAmountUsd, 0, 'the schema default must still be reported');
  assert.strictEqual(legacy.maxOrderAmountUsd, null, 'the schema default must still be reported');

  const modern = payload.warehouses.find((w) => w.nameEn === 'Modern Warehouse');
  assert.strictEqual(modern.minOrderAmountUsd, 25, 'a stored value must be passed through unchanged');
  assert.strictEqual(modern.maxOrderAmountUsd, 500);
});

test('warehouse list response keeps exactly its documented key set', async () => {
  const warehouses = await warehouseService.listAvailableWarehouses();
  const { warehouses: rows } = warehouseViewModel.toWarehouseListResponse(warehouses);
  assert.deepStrictEqual(
    Object.keys(rows[0]).sort(),
    ['city', 'id', 'logo', 'maxOrderAmountUsd', 'minOrderAmountUsd', 'nameAr', 'nameEn', 'phone'].sort()
  );
});

test('warehouse profile also reports the defaulted order limits', async () => {
  const data = await warehouseService.getWarehouseProfile(LEGACY_WAREHOUSE_ID);
  const payload = warehouseViewModel.toWarehouseProfileResponse(data);
  assert.strictEqual(payload.minOrderAmountUsd, 0);
  assert.strictEqual(payload.maxOrderAmountUsd, null);
  assert.strictEqual(payload.nameEn, 'Legacy Warehouse');
  assert.deepStrictEqual(payload.recentReviews, []);
  assert.strictEqual(payload.reviewsCount, 0);
  assert.strictEqual(payload.averageRating, 0);
});

test('isWarehouseAvailable is unchanged by its narrowed projection', async () => {
  assert.strictEqual(await warehouseService.isWarehouseAvailable(LEGACY_WAREHOUSE_ID), true);
  assert.strictEqual(await warehouseService.isWarehouseAvailable(MODERN_WAREHOUSE_ID), true);
  assert.strictEqual(await warehouseService.isWarehouseAvailable('not-an-object-id'), false);
  assert.strictEqual(
    await warehouseService.isWarehouseAvailable(new mongoose.Types.ObjectId()),
    false,
    'an unknown id must not resolve'
  );

  // A warehouse whose owning user is no longer active must stop being
  // available - the second query still has to work after the projection.
  await User.updateOne({ _id: (await Warehouse.findById(MODERN_WAREHOUSE_ID)).userId }, { status: 'blocked' });
  assert.strictEqual(await warehouseService.isWarehouseAvailable(MODERN_WAREHOUSE_ID), false);
  await User.updateOne({ _id: (await Warehouse.findById(MODERN_WAREHOUSE_ID)).userId }, { status: 'active' });
  assert.strictEqual(await warehouseService.isWarehouseAvailable(MODERN_WAREHOUSE_ID), true);
});

test('categories response is unchanged and still sorted by sortOrder', async () => {
  const categories = await categoryService.listCategories();
  const payload = categoryViewModel.toCategoryListResponse(categories);
  assert.deepStrictEqual(payload.categories.map((c) => c.nameEn), ['Cat 2', 'Cat 1']);
  assert.deepStrictEqual(
    Object.keys(payload.categories[0]).sort(),
    ['icon', 'id', 'nameAr', 'nameEn', 'sortOrder'].sort()
  );
});

test('GET /auth/me payload is unchanged for a pharmacy user', async () => {
  const result = await authService.getMe(PHARMACY_USER_ID);
  const payload = authViewModel.toMeResponse(result);
  assert.deepStrictEqual(
    Object.keys(payload.user).sort(),
    ['id', 'lang', 'name', 'phone', 'role', 'status'].sort()
  );
  assert.strictEqual(payload.user.role, 'pharmacy');
  assert.strictEqual(payload.user.status, 'active');
  assert.strictEqual(payload.user.lang, 'ar', 'schema default must survive');
  assert.ok(payload.pharmacy, 'the pharmacy profile must still be resolved');
  assert.strictEqual(payload.pharmacy.nameEn, 'Ph');
  assert.strictEqual(payload.pharmacy.verificationPhoto, null);
  assert.strictEqual(payload.warehouse, null);
  assert.ok(!('password' in payload.user), 'password must never be serialised');
});

test('GET /auth/me payload is unchanged for a warehouse user', async () => {
  const result = await authService.getMe(LEGACY_WAREHOUSE_USER_ID);
  const payload = authViewModel.toMeResponse(result);
  assert.deepStrictEqual(
    Object.keys(payload.user).sort(),
    ['id', 'lang', 'name', 'phone', 'role', 'status'].sort()
  );
  assert.strictEqual(payload.user.role, 'warehouse');
  assert.strictEqual(payload.pharmacy, null);
  assert.ok(payload.warehouse, 'the warehouse profile must still be resolved');
  assert.deepStrictEqual(
    Object.keys(payload.warehouse).sort(),
    ['city', 'id', 'logo', 'nameAr', 'nameEn', 'phone'].sort()
  );
  assert.strictEqual(payload.warehouse.nameEn, 'Legacy Warehouse');
  assert.strictEqual(payload.warehouse.logo, null);
});

test('loginWithPassword is unaffected by the +password projection', async () => {
  const result = await authService.loginWithPassword({
    phone: PASSWORD_USER_PHONE,
    password: PASSWORD_USER_SECRET,
  });
  assert.ok(result.token, 'a token must still be issued');

  const payload = authViewModel.toAuthResponse(result);
  assert.deepStrictEqual(
    Object.keys(payload.user).sort(),
    ['id', 'lang', 'name', 'phone', 'role', 'status'].sort()
  );
  assert.strictEqual(payload.user.phone, PASSWORD_USER_PHONE);
  assert.ok(!('password' in payload.user), 'password must never be serialised');
  assert.strictEqual(payload.pharmacy.nameEn, 'PwPh', 'the profile projection must still resolve');

  await assert.rejects(
    () => authService.loginWithPassword({ phone: PASSWORD_USER_PHONE, password: 'wrong' }),
    /Incorrect phone number or password/,
    'the password comparison still runs, so the hash was really fetched'
  );

  await User.updateOne({ _id: PASSWORD_USER_ID }, { status: 'blocked' });
  await assert.rejects(
    () => authService.loginWithPassword({ phone: PASSWORD_USER_PHONE, password: PASSWORD_USER_SECRET }),
    /blocked/,
    'the status guard still has the field it needs'
  );
  await User.updateOne({ _id: PASSWORD_USER_ID }, { status: 'active' });
});

test('registerOrLogin re-entry returns the full auth shape for an existing user', async () => {
  const result = await authService.registerOrLogin({
    name: 'ignored', pharmacyName: 'ignored', phone: PASSWORD_USER_PHONE,
    address: 'ignored', password: 'ignored',
  });
  const payload = authViewModel.toAuthResponse(result);
  assert.deepStrictEqual(
    Object.keys(payload.user).sort(),
    ['id', 'lang', 'name', 'phone', 'role', 'status'].sort()
  );
  assert.strictEqual(payload.user.name, 'Pw Pharm', 'the stored name, not the re-typed one');
  assert.strictEqual(payload.pharmacy.ownerName, 'Pw Owner');
  assert.ok(result.token);
});

test('authenticateToken still enforces its rules with the narrowed projection', async () => {
  const token = jwt.sign({ sub: PHARMACY_USER_ID.toString(), role: 'pharmacy' }, process.env.JWT_SECRET);
  const user = await authenticateToken(token);
  assert.strictEqual(String(user._id), PHARMACY_USER_ID.toString());
  assert.strictEqual(user.role, 'pharmacy');
  assert.strictEqual(user.status, 'active');

  await assert.rejects(() => authenticateToken(null), /Authentication token is required/);
  await assert.rejects(() => authenticateToken('not-a-jwt'), /Invalid or expired token/);

  const ghost = jwt.sign({ sub: new mongoose.Types.ObjectId().toString() }, process.env.JWT_SECRET);
  await assert.rejects(() => authenticateToken(ghost), /User no longer exists/);

  await User.updateOne({ _id: PHARMACY_USER_ID }, { status: 'blocked' });
  await assert.rejects(() => authenticateToken(token), /This account has been blocked/);
  await User.updateOne({ _id: PHARMACY_USER_ID }, { status: 'active' });
});
