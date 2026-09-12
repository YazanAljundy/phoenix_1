// A package's availability - Advertisement.isAvailable - as a pause switch
// layered on top of moderation.
//
// `status` (pending/approved/rejected) stays the one-time decision on a
// package's content. `isAvailable` lets an approved package come off sale
// temporarily without losing that approval:
//   - a paused package is not listed, and cannot be bought,
//   - the cart endpoint still answers for it, reporting isAvailable:false,
//   - a warehouse can pause AND re-enable its own package, but only while it
//     is `approved` - a pending or rejected package answers ADVERTISEMENT_NOT_APPROVED,
//   - an admin can flip any package either way, at any status,
//   - an order already placed on it is untouched, and still editable from its
//     frozen snapshot.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-advertisement-availability-tests';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');

const { startMemoryMongo, stopMemoryMongo, syncIndexes } = require('./helpers/mongo');

const User = require('../src/models/user.model');
const Pharmacy = require('../src/models/pharmacy.model');
const Warehouse = require('../src/models/warehouse.model');
const Product = require('../src/models/product.model');
const Order = require('../src/models/order.model');
const OrderItem = require('../src/models/orderItem.model');
const Advertisement = require('../src/models/advertisement.model');
const ExchangeRate = require('../src/models/exchangeRate.model');
const LedgerEntry = require('../src/models/ledgerEntry.model');
const LedgerAccount = require('../src/models/ledgerAccount.model');

const advertisementService = require('../src/services/advertisement.service');
const warehouseAdvertisementService = require('../src/services/warehouseAdvertisement.service');
const adminAdvertisementService = require('../src/services/adminAdvertisement.service');
const orderService = require('../src/services/order.service');
const warehouseOrderService = require('../src/services/warehouseOrder.service');
const advertisementViewModel = require('../src/viewmodels/advertisement.viewmodel');
const adminAdvertisementViewModel = require('../src/viewmodels/adminAdvertisement.viewmodel');

const RATE = 10000;
const DAY = 24 * 60 * 60 * 1000;
const ids = {};
const past = (d) => new Date(Date.now() - d * DAY);
const future = (d) => new Date(Date.now() + d * DAY);

// Catalog $30 + $25 + $12 = $67; the package sells all three for $40.
const CATALOG = { A: 30, B: 25, C: 12 };
const PACKAGE_USD = 40;

function makePackage(overrides = {}) {
  return Advertisement.create({
    warehouseId: ids.warehouse,
    titleAr: 'باقة',
    titleEn: 'Package',
    items: [
      { productId: ids.productA, quantity: 1 },
      { productId: ids.productB, quantity: 1 },
      { productId: ids.productC, quantity: 1 },
    ],
    totalPriceUsd: PACKAGE_USD,
    startDate: past(1),
    endDate: future(30),
    status: 'approved',
    ...overrides,
  });
}

function buy(packages) {
  return orderService.createOrder({
    userId: ids.phUser,
    pharmacyId: ids.pharmacy,
    warehouseId: ids.warehouse,
    items: [],
    notes: null,
    packages: packages.map(({ advertisementId, copies = 1 }) => ({
      advertisementId: advertisementId.toString(),
      copies,
    })),
  });
}

const pauseAsWarehouse = (advertisementId) =>
  warehouseAdvertisementService.updateAdvertisementAvailability(advertisementId, ids.warehouse, false);
const reactivateAsWarehouse = (advertisementId) =>
  warehouseAdvertisementService.updateAdvertisementAvailability(advertisementId, ids.warehouse, true);

const listedIds = async () =>
  (await advertisementService.listActiveAdvertisements()).map((row) => String(row.advertisement._id));

// Asserts an ApiError by its code - assert.rejects with a regex would only
// match the message.
const rejectsWith = (code, extra = () => {}) => (err) => {
  assert.strictEqual(err.code, code);
  extra(err);
  return true;
};

test.before(async () => {
  await startMemoryMongo({ dbName: 'feniq-advertisement-availability-test' });
  await syncIndexes(Order);
  await ExchangeRate.create({ _id: 'singleton', usdToSyp: RATE, source: 'manual' });

  const [whUser, otherWhUser, phUser, adminUser] = await User.create([
    { name: 'WH', phone: '0942000901', role: 'warehouse', status: 'active' },
    { name: 'WH2', phone: '0942000902', role: 'warehouse', status: 'active' },
    { name: 'PH', phone: '0932000901', role: 'pharmacy', status: 'active' },
    { name: 'Admin', phone: '0942000903', role: 'admin', status: 'active' },
  ]);
  ids.whUser = whUser._id;
  ids.phUser = phUser._id;
  ids.adminUser = adminUser._id;

  const [warehouse, otherWarehouse] = await Warehouse.create([
    { userId: whUser._id, nameAr: 'م', nameEn: 'Warehouse', address: 'r', city: 'Latakia', phone: '0942000901', deliveryType: 'self', isActive: true, discountRate: 0, commissionRate: 0 },
    { userId: otherWhUser._id, nameAr: 'م2', nameEn: 'Warehouse 2', address: 'r', city: 'Latakia', phone: '0942000902', deliveryType: 'self', isActive: true, discountRate: 0, commissionRate: 0 },
  ]);
  ids.warehouse = warehouse._id;
  ids.otherWarehouse = otherWarehouse._id;

  const pharmacy = await Pharmacy.create({
    userId: phUser._id, nameAr: 'ص', nameEn: 'Pharmacy', ownerName: 'O',
    address: 'a', city: 'Latakia', phone: '0932000901', addedBy: 'self',
  });
  ids.pharmacy = pharmacy._id;

  for (const [key, priceUsd] of Object.entries(CATALOG)) {
    const product = await Product.create({
      warehouseId: warehouse._id, nameAr: key, nameEn: `Product ${key}`, manufacturerAr: 'شركة',
      price: priceUsd, unitAr: 'علبة', unitEn: 'box', isAvailable: true, isActive: true,
    });
    ids[`product${key}`] = product._id;
  }
});

test.after(async () => {
  await stopMemoryMongo();
});

test.afterEach(async () => {
  await Promise.all([
    Advertisement.deleteMany({}), Order.deleteMany({}), OrderItem.deleteMany({}),
    LedgerEntry.deleteMany({}), LedgerAccount.deleteMany({}),
  ]);
});

// ---------------------------------------------------------------------------
// Pharmacist-facing: the list, checkout and the cart endpoint
// ---------------------------------------------------------------------------

test('a paused package is not listed by GET /advertisements/active', async () => {
  const live = await makePackage({ titleEn: 'Live' });
  const paused = await makePackage({ titleEn: 'Paused' });
  await pauseAsWarehouse(paused._id);

  const listed = await listedIds();
  assert.ok(listed.includes(String(live._id)), 'the available package stays listed');
  assert.ok(!listed.includes(String(paused._id)), 'the paused package is hidden');
});

test('a package saved before isAvailable existed is still listed and buyable', async () => {
  // Written straight to the collection so the field is genuinely absent, as on
  // every package that predates it - Model.create would store the default.
  const { insertedId } = await Advertisement.collection.insertOne({
    warehouseId: ids.warehouse,
    titleAr: 'قديمة',
    titleEn: 'Legacy',
    items: [{ productId: ids.productA, quantity: 1 }],
    totalPriceUsd: 20,
    startDate: past(1),
    endDate: future(30),
    status: 'approved',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  assert.ok((await listedIds()).includes(String(insertedId)), 'a missing flag must not read as paused');
  const order = await buy([{ advertisementId: insertedId }]);
  assert.strictEqual(order.orderPackageGroups.length, 1);
});

test('buying a paused package is refused with 400 PACKAGE_UNAVAILABLE, and no order is written', async () => {
  const pkg = await makePackage();
  await pauseAsWarehouse(pkg._id);

  await assert.rejects(
    () => buy([{ advertisementId: pkg._id }]),
    rejectsWith('PACKAGE_UNAVAILABLE', (err) => {
      assert.strictEqual(err.statusCode, 400);
      assert.deepStrictEqual(err.details.advertisementIds, [String(pkg._id)]);
    })
  );
  assert.strictEqual(await Order.countDocuments({}), 0);
});

test('every paused package in the cart is reported in the one refusal', async () => {
  const first = await makePackage({ titleEn: 'First' });
  const second = await makePackage({ titleEn: 'Second' });
  const live = await makePackage({ titleEn: 'Live' });
  await pauseAsWarehouse(first._id);
  await adminAdvertisementService.setAdvertisementAvailability(second._id, false);

  await assert.rejects(
    () => buy([{ advertisementId: first._id }, { advertisementId: live._id }, { advertisementId: second._id }]),
    rejectsWith('PACKAGE_UNAVAILABLE', (err) => {
      assert.deepStrictEqual(
        [...err.details.advertisementIds].sort(),
        [String(first._id), String(second._id)].sort()
      );
    })
  );
});

test('the cart endpoint still answers for a package paused after it was added, with isAvailable:false', async () => {
  const pkg = await makePackage();

  const before = advertisementViewModel.toAdvertisementCartResponse(
    await advertisementService.prepareAdvertisementCart(pkg._id)
  );
  assert.strictEqual(before.advertisementCart.isAvailable, true);

  await pauseAsWarehouse(pkg._id);

  const after = advertisementViewModel.toAdvertisementCartResponse(
    await advertisementService.prepareAdvertisementCart(pkg._id)
  );
  assert.strictEqual(after.advertisementCart.isAvailable, false);
  // Still the whole payload, so a cart holding it can say what it is.
  assert.strictEqual(after.advertisementCart.items.length, 3);
  assert.strictEqual(after.advertisementCart.totalPriceUsd, PACKAGE_USD);
});

// ---------------------------------------------------------------------------
// The warehouse's one-way switch
// ---------------------------------------------------------------------------

test('a warehouse pauses its own package at once, with no admin involved', async () => {
  const pkg = await makePackage();

  const row = await pauseAsWarehouse(pkg._id);

  const stored = await Advertisement.findById(pkg._id);
  assert.strictEqual(stored.isAvailable, false);
  assert.strictEqual(stored.status, 'approved', 'pausing never touches the approval');
  assert.strictEqual(row.advertisement.isAvailable, false);
});

test('pausing an already-paused package is harmless', async () => {
  const pkg = await makePackage();
  await pauseAsWarehouse(pkg._id);
  await pauseAsWarehouse(pkg._id);
  assert.strictEqual((await Advertisement.findById(pkg._id)).isAvailable, false);
});

test('a warehouse re-enables its own package through its endpoint', async () => {
  const pkg = await makePackage();
  await pauseAsWarehouse(pkg._id);

  const row = await reactivateAsWarehouse(pkg._id);

  const stored = await Advertisement.findById(pkg._id);
  assert.strictEqual(stored.isAvailable, true);
  assert.strictEqual(stored.status, 'approved', 're-enabling never touches the approval');
  assert.strictEqual(row.advertisement.isAvailable, true);
  assert.ok((await listedIds()).includes(String(pkg._id)), 'listed again');
});

test('re-enabling an already-available package is harmless', async () => {
  const pkg = await makePackage();
  await reactivateAsWarehouse(pkg._id);
  assert.strictEqual((await Advertisement.findById(pkg._id)).isAvailable, true);
});

test('a warehouse cannot pause or re-enable a package that is not approved', async () => {
  const pending = await makePackage({ status: 'pending' });
  const rejected = await makePackage({ status: 'rejected', rejectionNote: 'no' });

  for (const pkg of [pending, rejected]) {
    await assert.rejects(
      () => warehouseAdvertisementService.updateAdvertisementAvailability(pkg._id, ids.warehouse, false),
      rejectsWith('ADVERTISEMENT_NOT_APPROVED', (err) => {
        assert.strictEqual(err.statusCode, 400);
      })
    );
    await assert.rejects(
      () => reactivateAsWarehouse(pkg._id),
      rejectsWith('ADVERTISEMENT_NOT_APPROVED', (err) => {
        assert.strictEqual(err.statusCode, 400);
      })
    );
  }
  assert.strictEqual((await Advertisement.findById(pending._id)).isAvailable, true);
  assert.strictEqual((await Advertisement.findById(rejected._id)).isAvailable, true);
});

test('toggling availability never changes status or moderation fields', async () => {
  const pkg = await makePackage();
  const beforeApprovedAt = pkg.approvedAt;

  await pauseAsWarehouse(pkg._id);
  let stored = await Advertisement.findById(pkg._id);
  assert.strictEqual(stored.status, 'approved');
  assert.strictEqual(stored.rejectionNote, null);
  assert.strictEqual(String(stored.approvedAt), String(beforeApprovedAt));

  await reactivateAsWarehouse(pkg._id);
  stored = await Advertisement.findById(pkg._id);
  assert.strictEqual(stored.status, 'approved');
  assert.strictEqual(stored.rejectionNote, null);
  assert.strictEqual(String(stored.approvedAt), String(beforeApprovedAt));
});

test("a warehouse cannot pause another warehouse's package (IDOR)", async () => {
  const pkg = await makePackage();

  await assert.rejects(
    () => warehouseAdvertisementService.updateAdvertisementAvailability(pkg._id, ids.otherWarehouse, false),
    rejectsWith('ADVERTISEMENT_NOT_FOUND')
  );
  assert.strictEqual((await Advertisement.findById(pkg._id)).isAvailable, true);
});

test("a warehouse cannot re-enable another warehouse's package (IDOR)", async () => {
  const pkg = await makePackage();
  await pauseAsWarehouse(pkg._id);

  await assert.rejects(
    () => warehouseAdvertisementService.updateAdvertisementAvailability(pkg._id, ids.otherWarehouse, true),
    rejectsWith('ADVERTISEMENT_NOT_FOUND')
  );
  assert.strictEqual((await Advertisement.findById(pkg._id)).isAvailable, false);
});

test('the availability must be a real boolean', async () => {
  const pkg = await makePackage();
  for (const value of ['false', 0, null, undefined]) {
    await assert.rejects(
      () => warehouseAdvertisementService.updateAdvertisementAvailability(pkg._id, ids.warehouse, value),
      rejectsWith('INVALID_AVAILABILITY')
    );
    await assert.rejects(
      () => adminAdvertisementService.setAdvertisementAvailability(pkg._id, value),
      rejectsWith('INVALID_AVAILABILITY')
    );
  }
  assert.strictEqual((await Advertisement.findById(pkg._id)).isAvailable, true);
});

test('editing a paused package cannot un-pause it, and neither can re-approving it', async () => {
  const pkg = await makePackage();
  await pauseAsWarehouse(pkg._id);

  await warehouseAdvertisementService.updateAdvertisement(pkg._id, ids.warehouse, {
    titleAr: 'باقة معدلة',
    titleEn: 'Edited package',
    items: [{ productId: ids.productA.toString(), quantity: 1 }],
    totalPriceUsd: 25,
    startDate: past(1),
    endDate: future(30),
    // Smuggled in: must be ignored, not applied.
    isAvailable: true,
  });
  const edited = await Advertisement.findById(pkg._id);
  assert.strictEqual(edited.status, 'pending', 'the edit goes back to moderation as before');
  assert.strictEqual(edited.isAvailable, false, 'an edit is not a way back');

  await adminAdvertisementService.approveAdvertisement(pkg._id, ids.adminUser);
  const approved = await Advertisement.findById(pkg._id);
  assert.strictEqual(approved.status, 'approved');
  assert.strictEqual(approved.isAvailable, false, 'approval leaves the pause exactly as it was');
  assert.ok(!(await listedIds()).includes(String(pkg._id)));
});

// ---------------------------------------------------------------------------
// The admin's two-way switch
// ---------------------------------------------------------------------------

test('an admin re-enables a package its warehouse paused', async () => {
  const pkg = await makePackage();
  await pauseAsWarehouse(pkg._id);

  const updated = await adminAdvertisementService.setAdvertisementAvailability(pkg._id, true);

  assert.strictEqual(updated.isAvailable, true);
  assert.strictEqual((await Advertisement.findById(pkg._id)).isAvailable, true);
  assert.ok((await listedIds()).includes(String(pkg._id)), 'listed again');
  const order = await buy([{ advertisementId: pkg._id }]);
  assert.strictEqual(order.orderPackageGroups.length, 1, 'and buyable again');
});

test('an admin pauses a package that was available', async () => {
  const pkg = await makePackage();

  const updated = await adminAdvertisementService.setAdvertisementAvailability(pkg._id, false);

  assert.strictEqual(updated.isAvailable, false);
  assert.ok(!(await listedIds()).includes(String(pkg._id)));
  await assert.rejects(() => buy([{ advertisementId: pkg._id }]), rejectsWith('PACKAGE_UNAVAILABLE'));
});

test('an admin setting an unknown package is a 404', async () => {
  await assert.rejects(
    () => adminAdvertisementService.setAdvertisementAvailability('0123456789abcdef01234567', false),
    rejectsWith('ADVERTISEMENT_NOT_FOUND')
  );
  await assert.rejects(
    () => adminAdvertisementService.setAdvertisementAvailability('not-an-id', false),
    rejectsWith('ADVERTISEMENT_NOT_FOUND')
  );
});

test('the admin can list approved packages, paused ones included, with their state', async () => {
  const live = await makePackage({ titleEn: 'Live' });
  const paused = await makePackage({ titleEn: 'Paused' });
  await makePackage({ titleEn: 'Pending', status: 'pending' });
  await pauseAsWarehouse(paused._id);

  const { rows, totalCount } = await adminAdvertisementService.listPaginatedAdvertisements({
    status: 'approved',
    limit: 10,
  });
  assert.strictEqual(totalCount, 2);
  const { advertisements } = adminAdvertisementViewModel.toPendingAdvertisementsResponse(rows);
  const byId = new Map(advertisements.map((ad) => [String(ad.id), ad]));
  assert.strictEqual(byId.get(String(live._id)).isAvailable, true);
  assert.strictEqual(byId.get(String(paused._id)).isAvailable, false);

  await assert.rejects(
    () => adminAdvertisementService.listPaginatedAdvertisements({ status: 'everything', limit: 10 }),
    rejectsWith('INVALID_STATUS')
  );
});

// ---------------------------------------------------------------------------
// Orders already placed
// ---------------------------------------------------------------------------

test('an order placed before the package was paused is untouched, and its copies can still be edited', async () => {
  const pkg = await makePackage();
  const order = await buy([{ advertisementId: pkg._id, copies: 1 }]);
  const groupId = order.orderPackageGroups[0]._id.toString();
  const placedFinalPrice = order.finalPrice;

  await pauseAsWarehouse(pkg._id);

  // Nothing about the placed order moved.
  const reloaded = await Order.findById(order._id);
  assert.strictEqual(reloaded.finalPrice, placedFinalPrice);
  assert.strictEqual(reloaded.orderPackageGroups.length, 1);
  assert.strictEqual(reloaded.orderPackageGroups[0].copies, 1);

  // And the warehouse can still restate its copies from the frozen snapshot,
  // whatever the live package's availability now is.
  await warehouseOrderService.updateOrderItems(order._id.toString(), ids.warehouse, ids.whUser, {
    updatePackages: [{ groupId, copies: 2 }],
  });

  const edited = await Order.findById(order._id);
  const group = edited.orderPackageGroups[0];
  assert.strictEqual(group.copies, 2);
  assert.strictEqual(group.totalPriceUsd, PACKAGE_USD * 2);

  const lines = await OrderItem.find({ orderId: order._id, packageGroupId: group._id });
  assert.strictEqual(lines.length, 3);
  assert.ok(lines.every((line) => line.quantity === 2), 'every package line restated at 1 x 2 copies');
});
