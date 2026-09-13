// Packages as locked groups.
//
// A package is bought as a UNIT: the pharmacy picks a package and how many
// copies of it, and pays `totalPriceUsd x copies`. Once the order exists, the
// terms it was bought on are frozen onto it (Order.orderPackageGroups) and the
// live Advertisement is never read again - so editing, expiring or deleting
// the package cannot restate an order already placed.
//
// The products inside a package are still real OrderItem lines (the warehouse
// picks them, the invoice lists them, a return is raised against them) but
// they are LOCKED: only the group's `copies` is still editable, and only as a
// whole.
//
// These are the three pricing defects the redesign closes, asserted directly:
//   - a live re-read of the package price restating a placed order
//   - a duplicate-line map silently dropping the package (a 3.4x overcharge)
//   - a live exchange rate mixed into an order frozen at another
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-package-group-tests';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');

const { startMemoryMongo, stopMemoryMongo, syncIndexes } = require('./helpers/mongo');

const User = require('../src/models/user.model');
const Pharmacy = require('../src/models/pharmacy.model');
const Warehouse = require('../src/models/warehouse.model');
const Product = require('../src/models/product.model');
const Offer = require('../src/models/offer.model');
const Order = require('../src/models/order.model');
const OrderItem = require('../src/models/orderItem.model');
const Advertisement = require('../src/models/advertisement.model');
const ExchangeRate = require('../src/models/exchangeRate.model');
const LedgerEntry = require('../src/models/ledgerEntry.model');

const orderService = require('../src/services/order.service');
const warehouseOrderService = require('../src/services/warehouseOrder.service');
const ledger = require('../src/services/ledger.service');

const RATE = 10000;
const DAY = 24 * 60 * 60 * 1000;
const ids = {};
const past = (d) => new Date(Date.now() - d * DAY);
const future = (d) => new Date(Date.now() + d * DAY);

// Catalog $30 + $25 + $12 = $67; the package sells all three for $40.
const CATALOG = { A: 30, B: 25, C: 12 };
const PACKAGE_USD = 40;

async function makePackage(overrides = {}) {
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

function buy({ advertisementId, copies = 1, items = [], ...extra }) {
  return orderService.createOrder({
    userId: ids.whUser,
    pharmacyId: ids.pharmacy,
    warehouseId: ids.warehouse,
    items,
    notes: null,
    packages: advertisementId ? [{ advertisementId: advertisementId.toString(), copies }] : [],
    ...extra,
  });
}

const groupIdOf = (order) => order.orderPackageGroups[0]._id.toString();

test.before(async () => {
  await startMemoryMongo({ dbName: 'feniq-package-groups-test' });
  await syncIndexes(Order);
  await ExchangeRate.create({ _id: 'singleton', usdToSyp: RATE, source: 'manual' });

  const [whUser, phUser] = await User.create([
    { name: 'WH', phone: '0942000801', role: 'warehouse', status: 'active' },
    { name: 'PH', phone: '0932000801', role: 'pharmacy', status: 'active' },
  ]);
  ids.whUser = whUser._id;

  const warehouse = await Warehouse.create({
    userId: whUser._id, nameAr: 'م', nameEn: 'Warehouse', address: 'r', city: 'Latakia',
    phone: '0942000801', deliveryType: 'self', isActive: true, discountRate: 4, commissionRate: 1,
  });
  ids.warehouse = warehouse._id;

  const pharmacy = await Pharmacy.create({
    userId: phUser._id, nameAr: 'ص', nameEn: 'Pharmacy', ownerName: 'O',
    address: 'a', city: 'Latakia', areaType: 'city', phone: '0932000801', addedBy: 'self',
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
    Advertisement.deleteMany({}), Order.deleteMany({}), OrderItem.deleteMany({}), Offer.deleteMany({}),
    LedgerEntry.deleteMany({}), require('../src/models/ledgerAccount.model').deleteMany({}),
  ]);
  await ExchangeRate.updateOne({ _id: 'singleton' }, { usdToSyp: RATE });
});

// ---------------------------------------------------------------------------
// Buying a package
// ---------------------------------------------------------------------------

test('a package is stored as one group carrying its own frozen terms', async () => {
  const pkg = await makePackage();
  const order = await buy({ advertisementId: pkg._id });

  assert.strictEqual(order.orderPackageGroups.length, 1);
  const group = order.orderPackageGroups[0];
  assert.strictEqual(String(group.advertisementId), String(pkg._id));
  assert.strictEqual(group.copies, 1);
  assert.strictEqual(group.totalPriceUsd, PACKAGE_USD);
  assert.strictEqual(group.advertisementSnapshot.totalPriceUsd, PACKAGE_USD);
  assert.strictEqual(group.advertisementSnapshot.usdToSyp, RATE, 'the order own rate, frozen');
  assert.strictEqual(group.advertisementSnapshot.items.length, 3);
});

test('the client sends only an id and a copy count - never a price', async () => {
  const pkg = await makePackage();
  const order = await orderService.createOrder({
    userId: ids.whUser, pharmacyId: ids.pharmacy, warehouseId: ids.warehouse,
    items: [], notes: null,
    packages: [
      // Every one of these is ignored: the server re-reads the package itself.
      {
        advertisementId: pkg._id.toString(), copies: 1,
        totalPriceUsd: 1, discountAmount: 999999, price: 1, items: [],
      },
    ],
  });
  assert.strictEqual(order.orderPackageGroups[0].totalPriceUsd, PACKAGE_USD);
  assert.strictEqual(order.finalPrice, 384000, '$40 x 10,000, less the 4% platform discount');
});

test('every product in the package becomes a locked line at quantity x copies', async () => {
  const pkg = await makePackage({
    items: [
      { productId: ids.productA, quantity: 10 },
      { productId: ids.productB, quantity: 1 },
    ],
    totalPriceUsd: 100,
  });
  const order = await buy({ advertisementId: pkg._id, copies: 2 });
  const lines = await OrderItem.find({ orderId: order._id }).lean();

  const lineA = lines.find((l) => String(l.productId) === String(ids.productA));
  const lineB = lines.find((l) => String(l.productId) === String(ids.productB));
  assert.strictEqual(lineA.quantity, 20, '10 per copy x 2 copies');
  assert.strictEqual(lineB.quantity, 2);
  assert.strictEqual(String(lineA.packageGroupId), groupIdOf(order));
  assert.strictEqual(String(lineB.packageGroupId), groupIdOf(order));
});

test('copies multiply the package price, and the discount stays one figure', async () => {
  const pkg = await makePackage();
  const order = await buy({ advertisementId: pkg._id, copies: 3 });

  assert.strictEqual(order.orderPackageGroups[0].copies, 3);
  assert.strictEqual(order.orderPackageGroups[0].totalPriceUsd, 120);
  assert.strictEqual(order.totalPrice, 2010000, '$67 x 3 copies at catalog price');
  assert.strictEqual(order.advertisementDiscountAmount, 810000, '($67 - $40) x 3 x 10,000');
  assert.strictEqual(order.finalPrice, 1152000, '$120 x 10,000, less 4%');
});

test('the same package named twice is one group with the copies added up', async () => {
  const pkg = await makePackage();
  const order = await orderService.createOrder({
    userId: ids.whUser, pharmacyId: ids.pharmacy, warehouseId: ids.warehouse,
    items: [], notes: null,
    packages: [
      { advertisementId: pkg._id.toString(), copies: 1 },
      { advertisementId: pkg._id.toString(), copies: 2 },
    ],
  });
  assert.strictEqual(order.orderPackageGroups.length, 1);
  assert.strictEqual(order.orderPackageGroups[0].copies, 3);
});

test('an order can hold two different packages side by side', async () => {
  const first = await makePackage();
  const second = await makePackage({
    items: [{ productId: ids.productA, quantity: 2 }],
    totalPriceUsd: 50,
  });
  const order = await orderService.createOrder({
    userId: ids.whUser, pharmacyId: ids.pharmacy, warehouseId: ids.warehouse,
    items: [], notes: null,
    packages: [
      { advertisementId: first._id.toString(), copies: 1 },
      { advertisementId: second._id.toString(), copies: 1 },
    ],
  });
  assert.strictEqual(order.orderPackageGroups.length, 2);
  // $67 + $60 catalog = $127; packages price them at $40 + $50 = $90.
  assert.strictEqual(order.totalPrice, 1270000);
  assert.strictEqual(order.advertisementDiscountAmount, 370000);
  assert.strictEqual(order.finalPrice, 864000, '$90 x 10,000, less 4%');
});

test('a cart holding nothing but a package is a valid order', async () => {
  const pkg = await makePackage();
  const order = await buy({ advertisementId: pkg._id });
  assert.strictEqual(order.orderNumber > 0, true);
  const lines = await OrderItem.countDocuments({ orderId: order._id });
  assert.strictEqual(lines, 3);
});

test('an empty cart with no packages is still refused', async () => {
  await assert.rejects(
    () => orderService.createOrder({
      userId: ids.whUser, pharmacyId: ids.pharmacy, warehouseId: ids.warehouse,
      items: [], notes: null, packages: [],
    }),
    (err) => err.code === 'CART_EMPTY'
  );
});

test('copies must be a whole number of at least one', async () => {
  const pkg = await makePackage();
  for (const copies of [0, -1, 1.5, 'two']) {
    await assert.rejects(
      () => buy({ advertisementId: pkg._id, copies }),
      (err) => err.code === 'INVALID_PACKAGE_COPIES',
      `copies=${copies}`
    );
  }
});

// ---------------------------------------------------------------------------
// A loose line and a package line for the same product are independent
// ---------------------------------------------------------------------------

test('buying a product loose alongside a package keeps its own offer', async () => {
  await Offer.create({
    warehouseId: ids.warehouse, productId: ids.productA, titleAr: 'ع', titleEn: 'o',
    discountPercentage: 20, startDate: past(1), endDate: future(30), status: 'approved',
  });
  const pkg = await makePackage();
  const order = await buy({
    advertisementId: pkg._id,
    items: [{ productId: ids.productA.toString(), quantity: 3, displayedUnitPriceUsd: 24 }],
  });

  const lines = await OrderItem.find({ orderId: order._id }).lean();
  const linesA = lines.filter((l) => String(l.productId) === String(ids.productA));
  assert.strictEqual(linesA.length, 2, 'the package line and the loose line stay separate');

  const packageLine = linesA.find((l) => l.packageGroupId);
  const looseLine = linesA.find((l) => !l.packageGroupId);
  assert.strictEqual(packageLine.discountPrice, 300000, 'inside the package: catalog price');
  assert.strictEqual(looseLine.discountPrice, 240000, 'outside it: the 20% offer applies');
  assert.strictEqual(looseLine.quantity, 3);
});

// ---------------------------------------------------------------------------
// The package is validated server-side, every time
// ---------------------------------------------------------------------------

test('a package from another warehouse is refused', async () => {
  const [otherUser] = await User.create([
    { name: 'W2', phone: '0942000802', role: 'warehouse', status: 'active' },
  ]);
  const other = await Warehouse.create({
    userId: otherUser._id, nameAr: 'م2', nameEn: 'W2', address: 'r', city: 'Latakia',
    phone: '0942000802', deliveryType: 'self', isActive: true,
  });
  const pkg = await makePackage({ warehouseId: other._id });

  await assert.rejects(
    () => buy({ advertisementId: pkg._id }),
    (err) => err.code === 'ADVERTISEMENT_WAREHOUSE_MISMATCH'
  );
  await Warehouse.deleteOne({ _id: other._id });
  await User.deleteOne({ _id: otherUser._id });
});

test('a pending, rejected, expired or not-yet-started package cannot be bought', async () => {
  for (const overrides of [
    { status: 'pending' },
    { status: 'rejected' },
    { endDate: past(1) },
    { startDate: future(1), endDate: future(30) },
  ]) {
    const pkg = await makePackage(overrides);
    await assert.rejects(
      () => buy({ advertisementId: pkg._id }),
      (err) => err.code === 'ADVERTISEMENT_UNAVAILABLE',
      JSON.stringify(overrides)
    );
    await Advertisement.deleteOne({ _id: pkg._id });
  }
});

test('an unavailable product blocks the whole package', async () => {
  const pkg = await makePackage();
  await Product.updateOne({ _id: ids.productC }, { isAvailable: false });
  await assert.rejects(
    () => buy({ advertisementId: pkg._id }),
    (err) => err.code === 'ADVERTISEMENT_PRODUCT_UNAVAILABLE'
  );
  await Product.updateOne({ _id: ids.productC }, { isAvailable: true });
});

// ---------------------------------------------------------------------------
// The lock
// ---------------------------------------------------------------------------

test('a package line cannot be removed on its own', async () => {
  const pkg = await makePackage();
  const order = await buy({ advertisementId: pkg._id });
  const line = await OrderItem.findOne({ orderId: order._id, packageGroupId: { $ne: null } });

  await assert.rejects(
    () => warehouseOrderService.updateOrderItems(
      order._id.toString(), ids.warehouse, ids.whUser,
      { removeItems: [line._id.toString()] }
    ),
    (err) => err.code === 'PACKAGE_ITEMS_LOCKED' && err.statusCode === 400
  );
});

test('a package line quantity cannot be edited on its own', async () => {
  const pkg = await makePackage();
  const order = await buy({ advertisementId: pkg._id });
  const line = await OrderItem.findOne({ orderId: order._id, packageGroupId: { $ne: null } });

  await assert.rejects(
    () => warehouseOrderService.updateOrderItems(
      order._id.toString(), ids.warehouse, ids.whUser,
      { updateItems: [{ orderItemId: line._id.toString(), quantity: 99 }] }
    ),
    (err) => err.code === 'PACKAGE_ITEMS_LOCKED'
  );
});

test('the lock holds even when the request also carries a legitimate edit', async () => {
  const pkg = await makePackage();
  const order = await buy({
    advertisementId: pkg._id,
    items: [{ productId: ids.productA.toString(), quantity: 2, displayedUnitPriceUsd: 30 }],
  });
  const packageLine = await OrderItem.findOne({ orderId: order._id, packageGroupId: { $ne: null } });

  await assert.rejects(
    () => warehouseOrderService.updateOrderItems(
      order._id.toString(), ids.warehouse, ids.whUser,
      {
        addItems: [{ productId: ids.productB.toString(), quantity: 1 }],
        removeItems: [packageLine._id.toString()],
      }
    ),
    (err) => err.code === 'PACKAGE_ITEMS_LOCKED'
  );
  // Nothing was written - the whole request is refused, not half-applied.
  const reread = await Order.findById(order._id).lean();
  assert.strictEqual(reread.totalPrice, order.totalPrice);
  assert.strictEqual(await OrderItem.countDocuments({ orderId: order._id }), 4);
});

test('a loose line on a package order is still freely editable', async () => {
  const pkg = await makePackage();
  const order = await buy({
    advertisementId: pkg._id,
    items: [{ productId: ids.productA.toString(), quantity: 2, displayedUnitPriceUsd: 30 }],
  });
  const looseLine = await OrderItem.findOne({ orderId: order._id, packageGroupId: null });

  await warehouseOrderService.updateOrderItems(
    order._id.toString(), ids.warehouse, ids.whUser,
    { updateItems: [{ orderItemId: looseLine._id.toString(), quantity: 5 }] }
  );
  const reread = await Order.findById(order._id).lean();
  assert.strictEqual(reread.advertisementDiscountAmount, 270000, 'the package is untouched');
  assert.strictEqual(reread.orderPackageGroups.length, 1);
});

// ---------------------------------------------------------------------------
// Editing copies - the only package edit there is
// ---------------------------------------------------------------------------

test('raising copies restates every package line and the price', async () => {
  const pkg = await makePackage();
  const order = await buy({ advertisementId: pkg._id });

  await warehouseOrderService.updateOrderItems(
    order._id.toString(), ids.warehouse, ids.whUser,
    { updatePackages: [{ groupId: groupIdOf(order), copies: 2 }] }
  );

  const reread = await Order.findById(order._id).lean();
  assert.strictEqual(reread.orderPackageGroups[0].copies, 2);
  assert.strictEqual(reread.orderPackageGroups[0].totalPriceUsd, 80);
  assert.strictEqual(reread.totalPrice, 1340000, '$67 x 2');
  assert.strictEqual(reread.advertisementDiscountAmount, 540000);
  assert.strictEqual(reread.finalPrice, 768000, '$80 x 10,000, less 4%');

  const lines = await OrderItem.find({ orderId: order._id }).lean();
  assert.deepStrictEqual(lines.map((l) => l.quantity).sort(), [2, 2, 2]);
});

test('removing the whole group drops its lines and its discount', async () => {
  const pkg = await makePackage();
  const order = await buy({
    advertisementId: pkg._id,
    items: [{ productId: ids.productA.toString(), quantity: 1, displayedUnitPriceUsd: 30 }],
  });

  await warehouseOrderService.updateOrderItems(
    order._id.toString(), ids.warehouse, ids.whUser,
    { removePackages: [groupIdOf(order)] }
  );

  const reread = await Order.findById(order._id).lean();
  assert.strictEqual(reread.orderPackageGroups.length, 0);
  assert.strictEqual(reread.advertisementDiscountAmount, 0);
  assert.strictEqual(reread.advertisementId, null);
  const lines = await OrderItem.find({ orderId: order._id }).lean();
  assert.strictEqual(lines.length, 1, 'only the loose line is left');
  assert.strictEqual(reread.totalPrice, 300000);
});

test('an order cannot be emptied by removing its only package', async () => {
  const pkg = await makePackage();
  const order = await buy({ advertisementId: pkg._id });
  await assert.rejects(
    () => warehouseOrderService.updateOrderItems(
      order._id.toString(), ids.warehouse, ids.whUser,
      { removePackages: [groupIdOf(order)] }
    ),
    (err) => err.code === 'CANNOT_REMOVE_LAST_ITEM'
  );
});

test('a package group that is not on this order is refused', async () => {
  const pkg = await makePackage();
  const order = await buy({ advertisementId: pkg._id });
  await assert.rejects(
    () => warehouseOrderService.updateOrderItems(
      order._id.toString(), ids.warehouse, ids.whUser,
      { updatePackages: [{ groupId: new (require('mongoose').Types.ObjectId)().toString(), copies: 2 }] }
    ),
    (err) => err.code === 'PACKAGE_GROUP_NOT_FOUND'
  );
});

// ---------------------------------------------------------------------------
// The three defects this redesign closes
// ---------------------------------------------------------------------------

test('editing the package price never restates an order already placed', async () => {
  const pkg = await makePackage();
  const order = await buy({ advertisementId: pkg._id });
  const before = { discount: order.advertisementDiscountAmount, final: order.finalPrice };

  // The warehouse slashes the package to $5 and it re-enters moderation.
  pkg.totalPriceUsd = 5;
  pkg.status = 'pending';
  await pkg.save();

  await warehouseOrderService.updateOrderItems(
    order._id.toString(), ids.warehouse, ids.whUser,
    { addItems: [{ productId: ids.productC.toString(), quantity: 1 }] }
  );

  const reread = await Order.findById(order._id).lean();
  assert.strictEqual(reread.advertisementDiscountAmount, before.discount, 'the agreed discount holds');
  assert.strictEqual(reread.orderPackageGroups[0].advertisementSnapshot.totalPriceUsd, PACKAGE_USD);
  // The order grew by one $12 unit and by nothing else.
  assert.strictEqual(reread.finalPrice, before.final + Math.round(120000 * 0.96));
});

test('raising the package price does not overcharge an order already placed', async () => {
  const pkg = await makePackage();
  const order = await buy({ advertisementId: pkg._id });

  pkg.totalPriceUsd = 200;
  await pkg.save();

  await warehouseOrderService.updateOrderItems(
    order._id.toString(), ids.warehouse, ids.whUser,
    { updatePackages: [{ groupId: groupIdOf(order), copies: 2 }] }
  );

  const reread = await Order.findById(order._id).lean();
  assert.strictEqual(reread.finalPrice, 768000, 'still $40 a copy, the agreed price');
});

test('a package deleted after the order still reprices from the snapshot', async () => {
  const pkg = await makePackage();
  const order = await buy({ advertisementId: pkg._id });
  await Advertisement.deleteOne({ _id: pkg._id });

  await warehouseOrderService.updateOrderItems(
    order._id.toString(), ids.warehouse, ids.whUser,
    { updatePackages: [{ groupId: groupIdOf(order), copies: 2 }] }
  );

  const reread = await Order.findById(order._id).lean();
  assert.strictEqual(reread.finalPrice, 768000);
  assert.strictEqual(reread.advertisementDiscountAmount, 540000);
});

test('an expired package still reprices from the snapshot', async () => {
  const pkg = await makePackage();
  const order = await buy({ advertisementId: pkg._id });
  await Advertisement.updateOne({ _id: pkg._id }, { endDate: past(1), status: 'rejected' });

  await warehouseOrderService.updateOrderItems(
    order._id.toString(), ids.warehouse, ids.whUser,
    { updatePackages: [{ groupId: groupIdOf(order), copies: 2 }] }
  );

  const reread = await Order.findById(order._id).lean();
  assert.strictEqual(reread.finalPrice, 768000);
});

test('an exchange-rate move between order and edit cannot touch the package price', async () => {
  const pkg = await makePackage();
  const order = await buy({ advertisementId: pkg._id });

  // The lira halves in value.
  await ExchangeRate.updateOne({ _id: 'singleton' }, { usdToSyp: 20000 });

  await warehouseOrderService.updateOrderItems(
    order._id.toString(), ids.warehouse, ids.whUser,
    { updatePackages: [{ groupId: groupIdOf(order), copies: 2 }] }
  );

  const reread = await Order.findById(order._id).lean();
  // Both the lines and the package total are the order's own frozen rate, so
  // the discount is exactly twice the one-copy figure - not zero, and not
  // doubled by today's rate.
  assert.strictEqual(reread.advertisementDiscountAmount, 540000);
  assert.strictEqual(reread.finalPrice, 768000, '$80 at the ORDER rate of 10,000, less 4%');
});

test('the package cannot be dropped by splitting a line - there is no way in', async () => {
  const pkg = await makePackage({
    items: [
      { productId: ids.productA, quantity: 10 },
      { productId: ids.productB, quantity: 1 },
      { productId: ids.productC, quantity: 1 },
    ],
    totalPriceUsd: 100,
  });
  const order = await buy({ advertisementId: pkg._id });
  const before = await Order.findById(order._id).lean();
  const lineA = await OrderItem.findOne({ orderId: order._id, productId: ids.productA });

  // The old 3.4x overcharge: drop the package line to 6 and add 4 back as a
  // second line. Now it cannot even be attempted - the line is locked.
  await assert.rejects(
    () => warehouseOrderService.updateOrderItems(
      order._id.toString(), ids.warehouse, ids.whUser,
      {
        updateItems: [{ orderItemId: lineA._id.toString(), quantity: 6 }],
        addItems: [{ productId: ids.productA.toString(), quantity: 4 }],
      }
    ),
    (err) => err.code === 'PACKAGE_ITEMS_LOCKED'
  );

  const after = await Order.findById(order._id).lean();
  assert.strictEqual(after.finalPrice, before.finalPrice);
  assert.strictEqual(after.advertisementDiscountAmount, before.advertisementDiscountAmount);
});

// ---------------------------------------------------------------------------
// The legacy single-advertisement shape still works
// ---------------------------------------------------------------------------

test('an older client sending advertisementId gets a one-copy group', async () => {
  const pkg = await makePackage();
  const order = await orderService.createOrder({
    userId: ids.whUser, pharmacyId: ids.pharmacy, warehouseId: ids.warehouse,
    items: [], notes: null,
    advertisementId: pkg._id.toString(),
  });
  assert.strictEqual(order.orderPackageGroups.length, 1);
  assert.strictEqual(order.orderPackageGroups[0].copies, 1);
  assert.strictEqual(String(order.advertisementId), String(pkg._id), 'legacy mirror still set');
  assert.strictEqual(order.finalPrice, 384000);
});


// ---------------------------------------------------------------------------
// Two packages on one order
//
// Everything downstream that attributes money to a package has to survive an
// order carrying more than one. `advertisementDiscountAmount` is an order-level
// TOTAL and is correct by construction; the risk is any code that reads the
// single `Order.advertisementId` mirror and treats it as "the package this
// order is about".
// ---------------------------------------------------------------------------

test('two packages on one order keep separate snapshots and one combined discount', async () => {
  // A: 1x A + 1x B + 1x C, catalog $67, sold for $40.
  const first = await makePackage();
  // B: 2x A, catalog $60 a copy, sold for $45 a copy - deliberately a
  // different price AND different contents from A.
  const second = await makePackage({
    items: [{ productId: ids.productA, quantity: 2 }],
    totalPriceUsd: 45,
  });

  const order = await orderService.createOrder({
    userId: ids.whUser, pharmacyId: ids.pharmacy, warehouseId: ids.warehouse,
    items: [], notes: null,
    packages: [
      { advertisementId: first._id.toString(), copies: 1 },
      { advertisementId: second._id.toString(), copies: 2 },
    ],
  });

  assert.strictEqual(order.orderPackageGroups.length, 2);

  const groupA = order.orderPackageGroups.find(
    (g) => String(g.advertisementId) === String(first._id)
  );
  const groupB = order.orderPackageGroups.find(
    (g) => String(g.advertisementId) === String(second._id)
  );

  // Each group carries ITS OWN frozen terms - not a shared or merged one.
  assert.strictEqual(groupA.advertisementSnapshot.totalPriceUsd, 40);
  assert.strictEqual(groupA.advertisementSnapshot.items.length, 3);
  assert.strictEqual(groupA.copies, 1);
  assert.strictEqual(groupA.totalPriceUsd, 40);

  assert.strictEqual(groupB.advertisementSnapshot.totalPriceUsd, 45);
  assert.strictEqual(groupB.advertisementSnapshot.items.length, 1);
  assert.strictEqual(groupB.copies, 2);
  assert.strictEqual(groupB.totalPriceUsd, 90);

  // Catalog: A's $67, plus B's 2 copies x 2 units of $30 = $120. Total $187.
  assert.strictEqual(order.totalPrice, 1870000);
  // Discounts: A saves $67-$40 = $27; B saves $120-$90 = $30. Together $57.
  assert.strictEqual(order.advertisementDiscountAmount, 570000, 'A $27 + B $30');
  // The pharmacy pays $40 + $90 = $130, less the 4% platform discount.
  assert.strictEqual(order.finalPrice, 1248000);

  // Every line is bound to the group that produced it, and product A appears
  // once per group rather than being merged across them.
  const lines = await OrderItem.find({ orderId: order._id }).lean();
  const groupAIds = lines.filter((l) => String(l.packageGroupId) === String(groupA._id));
  const groupBIds = lines.filter((l) => String(l.packageGroupId) === String(groupB._id));
  assert.strictEqual(groupAIds.length, 3);
  assert.strictEqual(groupBIds.length, 1);
  assert.strictEqual(groupBIds[0].quantity, 4, '2 per copy x 2 copies');

  // The order-level list names both packages. The singular mirror names only
  // the first and is documented as approximate, so nothing that attributes
  // money may read it.
  assert.deepStrictEqual(
    order.advertisementIds.map(String).sort(),
    [String(first._id), String(second._id)].sort()
  );
  assert.strictEqual(String(order.advertisementId), String(groupA.advertisementId));
});

test('dropping one of two packages leaves the other named on the order', async () => {
  const first = await makePackage();
  const second = await makePackage({
    items: [{ productId: ids.productA, quantity: 2 }],
    totalPriceUsd: 45,
  });
  const order = await orderService.createOrder({
    userId: ids.whUser, pharmacyId: ids.pharmacy, warehouseId: ids.warehouse,
    items: [], notes: null,
    packages: [
      { advertisementId: first._id.toString(), copies: 1 },
      { advertisementId: second._id.toString(), copies: 1 },
    ],
  });
  const groupA = order.orderPackageGroups.find(
    (g) => String(g.advertisementId) === String(first._id)
  );

  await warehouseOrderService.updateOrderItems(
    order._id.toString(), ids.warehouse, ids.whUser,
    { removePackages: [groupA._id.toString()] }
  );

  const reread = await Order.findById(order._id).lean();
  assert.deepStrictEqual(
    reread.advertisementIds.map(String),
    [String(second._id)],
    'the dropped package leaves no id behind'
  );
  assert.strictEqual(String(reread.advertisementId), String(second._id));
});

test('each package on a two-package order reprices independently', async () => {
  const first = await makePackage();
  const second = await makePackage({
    items: [{ productId: ids.productA, quantity: 2 }],
    totalPriceUsd: 45,
  });
  const order = await orderService.createOrder({
    userId: ids.whUser, pharmacyId: ids.pharmacy, warehouseId: ids.warehouse,
    items: [], notes: null,
    packages: [
      { advertisementId: first._id.toString(), copies: 1 },
      { advertisementId: second._id.toString(), copies: 2 },
    ],
  });
  const groupB = order.orderPackageGroups.find(
    (g) => String(g.advertisementId) === String(second._id)
  );

  // Drop B to one copy. A must be untouched.
  await warehouseOrderService.updateOrderItems(
    order._id.toString(), ids.warehouse, ids.whUser,
    { updatePackages: [{ groupId: groupB._id.toString(), copies: 1 }] }
  );

  const reread = await Order.findById(order._id).lean();
  const rereadA = reread.orderPackageGroups.find(
    (g) => String(g.advertisementId) === String(first._id)
  );
  const rereadB = reread.orderPackageGroups.find(
    (g) => String(g.advertisementId) === String(second._id)
  );
  assert.strictEqual(rereadA.copies, 1, 'A untouched');
  assert.strictEqual(rereadA.totalPriceUsd, 40);
  assert.strictEqual(rereadB.copies, 1);
  assert.strictEqual(rereadB.totalPriceUsd, 45);
  // Catalog now $67 + $60 = $127; discount $27 + ($60-$45)=$15 -> $42.
  assert.strictEqual(reread.totalPrice, 1270000);
  assert.strictEqual(reread.advertisementDiscountAmount, 420000);
  assert.strictEqual(reread.finalPrice, 816000, '$85 x 10,000, less 4%');
});

test('the ledger charge attributes every package on the order, not just the first', async () => {
  const first = await makePackage();
  const second = await makePackage({
    items: [{ productId: ids.productA, quantity: 2 }],
    totalPriceUsd: 45,
  });
  const order = await orderService.createOrder({
    userId: ids.whUser, pharmacyId: ids.pharmacy, warehouseId: ids.warehouse,
    items: [], notes: null,
    packages: [
      { advertisementId: first._id.toString(), copies: 1 },
      { advertisementId: second._id.toString(), copies: 2 },
    ],
  });

  let current = order;
  for (let i = 0; i < 4; i += 1) {
    current = await warehouseOrderService.advanceOrderStatus(
      current._id.toString(), ids.warehouse, ids.whUser
    );
  }

  const account = await ledger.findAccount(ids.pharmacy, ids.warehouse);
  assert.strictEqual(account.balanceCache.syp, 1248000, 'both package prices, less 4%');

  // The charge freezes the pricing breakdown for a dispute years later. The
  // combined saving is booked, so the record of WHICH packages produced it has
  // to name both - naming only the first would attribute $57 of saving to a
  // package that only accounts for $27 of it.
  const charge = await LedgerEntry.findOne({ 'source.orderId': order._id, kind: 'charge' }).lean();
  assert.ok(charge, 'a charge was posted');
  assert.strictEqual(charge.metadata.advertisementDiscountSyp, 570000);

  const attributed = (charge.metadata.advertisementIds ?? []).map(String);
  assert.deepStrictEqual(
    attributed.sort(),
    [String(first._id), String(second._id)].sort(),
    'both packages are named on the charge'
  );
});

// ---------------------------------------------------------------------------
// A legacy order is locked exactly like a current one
//
// An older app build sends { advertisementId, items } with the package's own
// products inlined. Those products still have to end up on a LOCKED group -
// the lock cannot depend on the client being new, and cannot wait for the
// migration to run.
// ---------------------------------------------------------------------------

test('a legacy order tags its package lines with a group id at creation', async () => {
  const pkg = await makePackage();
  const order = await orderService.createOrder({
    userId: ids.whUser, pharmacyId: ids.pharmacy, warehouseId: ids.warehouse,
    notes: null,
    // The pre-packages shape: the id, AND the package's products inlined.
    advertisementId: pkg._id.toString(),
    items: [
      { productId: ids.productA.toString(), quantity: 1 },
      { productId: ids.productB.toString(), quantity: 1 },
      { productId: ids.productC.toString(), quantity: 1 },
    ],
  });

  assert.strictEqual(order.orderPackageGroups.length, 1);
  const groupId = order.orderPackageGroups[0]._id.toString();

  const lines = await OrderItem.find({ orderId: order._id }).lean();
  assert.strictEqual(lines.length, 3, 'no duplicate loose lines');
  assert.strictEqual(
    lines.every((l) => String(l.packageGroupId) === groupId),
    true,
    'every package line is bound to the group'
  );
});

test('a legacy order refuses a per-line edit exactly like a current one', async () => {
  const pkg = await makePackage();
  const order = await orderService.createOrder({
    userId: ids.whUser, pharmacyId: ids.pharmacy, warehouseId: ids.warehouse,
    notes: null,
    advertisementId: pkg._id.toString(),
    items: [
      { productId: ids.productA.toString(), quantity: 1 },
      { productId: ids.productB.toString(), quantity: 1 },
      { productId: ids.productC.toString(), quantity: 1 },
    ],
  });
  const line = await OrderItem.findOne({ orderId: order._id });

  await assert.rejects(
    () => warehouseOrderService.updateOrderItems(
      order._id.toString(), ids.warehouse, ids.whUser,
      { removeItems: [line._id.toString()] }
    ),
    (err) => err.code === 'PACKAGE_ITEMS_LOCKED' && err.statusCode === 400,
    'removing a legacy package line'
  );

  await assert.rejects(
    () => warehouseOrderService.updateOrderItems(
      order._id.toString(), ids.warehouse, ids.whUser,
      { updateItems: [{ orderItemId: line._id.toString(), quantity: 9 }] }
    ),
    (err) => err.code === 'PACKAGE_ITEMS_LOCKED',
    'editing a legacy package line'
  );
});

test('a legacy order with extras keeps the extras loose and editable', async () => {
  const pkg = await makePackage();
  const order = await orderService.createOrder({
    userId: ids.whUser, pharmacyId: ids.pharmacy, warehouseId: ids.warehouse,
    notes: null,
    advertisementId: pkg._id.toString(),
    items: [
      // 3 of A: 1 belongs to the package, 2 are extras.
      { productId: ids.productA.toString(), quantity: 3 },
      { productId: ids.productB.toString(), quantity: 1 },
      { productId: ids.productC.toString(), quantity: 1 },
    ],
  });

  const lines = await OrderItem.find({ orderId: order._id }).lean();
  const loose = lines.filter((l) => !l.packageGroupId);
  assert.strictEqual(loose.length, 1, 'the extras are their own loose line');
  assert.strictEqual(loose[0].quantity, 2);
  assert.strictEqual(String(loose[0].productId), String(ids.productA));

  // And that loose line is still freely editable.
  await warehouseOrderService.updateOrderItems(
    order._id.toString(), ids.warehouse, ids.whUser,
    { updateItems: [{ orderItemId: loose[0]._id.toString(), quantity: 5 }] }
  );
  const reread = await Order.findById(order._id).lean();
  assert.strictEqual(reread.advertisementDiscountAmount, 270000, 'the package is untouched');
});
