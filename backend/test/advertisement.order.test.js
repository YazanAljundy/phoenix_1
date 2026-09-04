// Phase 2: ordering a warehouse advertisement package.
//
// A package carries no per-product price: every product is billed at its
// CURRENT catalog price, and the package total is the discount, applied once at
// the order level. The SERVER decides every figure - the client names an
// advertisement by id and nothing else.
//
// Own database, dropped at the end - same pattern as advertisement.test.js.
process.env.MONGODB_URI = 'mongodb://localhost:27017/phoenix-advertisement-order-test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-advertisement-order-tests';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');

const User = require('../src/models/user.model');
const Pharmacy = require('../src/models/pharmacy.model');
const Warehouse = require('../src/models/warehouse.model');
const Product = require('../src/models/product.model');
const Order = require('../src/models/order.model');
const OrderItem = require('../src/models/orderItem.model');
const Advertisement = require('../src/models/advertisement.model');
const ExchangeRate = require('../src/models/exchangeRate.model');

const orderService = require('../src/services/order.service');
const advertisementService = require('../src/services/advertisement.service');
const advertisementViewModel = require('../src/viewmodels/advertisement.viewmodel');
const warehouseOrderService = require('../src/services/warehouseOrder.service');
const balanceService = require('../src/services/pharmacyBalance.service');

const RATE = 10000; // 1 USD = 10,000 SYP, so SYP figures below are USD * 10,000.
const ids = {};

const DAY = 24 * 60 * 60 * 1000;
const past = (days) => new Date(Date.now() - days * DAY);
const future = (days) => new Date(Date.now() + days * DAY);

async function makeProduct(key, warehouseId, nameEn, priceUsd) {
  const product = await Product.create({
    warehouseId,
    nameEn,
    nameAr: nameEn,
    manufacturerAr: 'شركة',
    manufacturerEn: 'Pharma',
    price: priceUsd,
    unitAr: 'علبة',
    unitEn: 'box',
    isAvailable: true,
    isActive: true,
  });
  ids[key] = product._id;
  return product;
}

// Products A / B / C have catalog prices $30 / $25 / $12 (sum $67). The package
// total is $40, so the package discount is $27.
async function makeAdvertisement(overrides = {}) {
  return Advertisement.create({
    warehouseId: ids.warehouse,
    titleAr: 'باقة',
    titleEn: 'Package',
    items: [{ productId: ids.productA }, { productId: ids.productB }, { productId: ids.productC }],
    totalPriceUsd: 40,
    startDate: past(1),
    endDate: future(30),
    status: 'approved',
    ...overrides,
  });
}

function packageItems() {
  return [
    { productId: ids.productA.toString(), quantity: 1 },
    { productId: ids.productB.toString(), quantity: 1 },
    { productId: ids.productC.toString(), quantity: 1 },
  ];
}

function submit(extra = {}) {
  return orderService.createOrder({
    userId: ids.whUser,
    pharmacyId: ids.pharmacy,
    warehouseId: ids.warehouse,
    items: packageItems(),
    notes: null,
    ...extra,
  });
}

test.before(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await ExchangeRate.create({ _id: 'singleton', usdToSyp: RATE, source: 'manual' });

  const [whUser, otherWhUser, phUser] = await User.create([
    { name: 'WH', phone: '0942000601', role: 'warehouse', status: 'active' },
    { name: 'WH2', phone: '0942000602', role: 'warehouse', status: 'active' },
    { name: 'PH', phone: '0932000601', role: 'pharmacy', status: 'active' },
  ]);
  ids.whUser = whUser._id;

  // discountRate/commissionRate zeroed (default 4/1) so most tests isolate the
  // package arithmetic; the two that care turn them on and put them back.
  const [warehouse, otherWarehouse] = await Warehouse.create([
    { userId: whUser._id, nameAr: 'م', nameEn: 'Warehouse', address: 'r', city: 'Latakia', phone: '0942000601', deliveryType: 'self', isActive: true, discountRate: 0, commissionRate: 0 },
    { userId: otherWhUser._id, nameAr: 'م2', nameEn: 'Warehouse 2', address: 'r', city: 'Latakia', phone: '0942000602', deliveryType: 'self', isActive: true, discountRate: 0, commissionRate: 0 },
  ]);
  ids.warehouse = warehouse._id;
  ids.otherWarehouse = otherWarehouse._id;

  const pharmacy = await Pharmacy.create({
    userId: phUser._id, nameAr: 'ص', nameEn: 'Pharmacy', ownerName: 'O',
    address: 'a', city: 'Latakia', phone: '0932000601', addedBy: 'self',
  });
  ids.pharmacy = pharmacy._id;

  await makeProduct('productA', ids.warehouse, 'Product A', 30);
  await makeProduct('productB', ids.warehouse, 'Product B', 25);
  await makeProduct('productC', ids.warehouse, 'Product C', 12);
  await makeProduct('extra', ids.warehouse, 'Extra Product', 5);
  await makeProduct('foreign', ids.otherWarehouse, 'Foreign Product', 9);
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test.afterEach(async () => {
  await Promise.all([
    Advertisement.deleteMany({}),
    Order.deleteMany({}),
    OrderItem.deleteMany({}),
  ]);
  await Product.updateMany({ warehouseId: ids.warehouse }, { isAvailable: true, isActive: true });
  // Reset any catalog price a test moved.
  await Product.updateOne({ _id: ids.productA }, { price: 30 });
});

// --- Which advertisements a pharmacy may see ------------------------------

test('an active advertisement is returned with catalog prices and a saving %', async () => {
  const advertisement = await makeAdvertisement();
  const { advertisements } = advertisementViewModel.toActiveAdvertisementsResponse(
    await advertisementService.listActiveAdvertisements()
  );

  assert.strictEqual(advertisements.length, 1);
  assert.strictEqual(String(advertisements[0].id), String(advertisement._id));
  assert.strictEqual(advertisements[0].totalPriceUsd, 40);
  assert.strictEqual(advertisements[0].itemsTotalUsd, 67); // 30 + 25 + 12
  // (67 - 40) / 67 = 40.3% -> 40
  assert.strictEqual(advertisements[0].savingPercentage, 40);
  assert.strictEqual(advertisements[0].items.length, 3);
  const a = advertisements[0].items.find((i) => i.nameEn === 'Product A');
  assert.strictEqual(a.priceUsd, 30);
  assert.strictEqual(a.advertisedPriceUsd, undefined);
});

test('pending, rejected, expired and not-yet-started advertisements are all excluded', async () => {
  await makeAdvertisement({ status: 'pending' });
  await makeAdvertisement({ status: 'rejected', rejectionNote: 'no' });
  await makeAdvertisement({ startDate: past(30), endDate: past(1) });
  await makeAdvertisement({ startDate: future(1), endDate: future(30) });

  assert.deepStrictEqual(await advertisementService.listActiveAdvertisements(), []);
});

test('each excluded advertisement is also unorderable, with one generic code', async () => {
  for (const overrides of [
    { status: 'pending' },
    { status: 'rejected', rejectionNote: 'no' },
    { startDate: past(30), endDate: past(1) },
    { startDate: future(1), endDate: future(30) },
  ]) {
    const advertisement = await makeAdvertisement(overrides);
    await assert.rejects(
      () => submit({ advertisementId: advertisement._id.toString() }),
      (err) => err.code === 'ADVERTISEMENT_UNAVAILABLE',
      JSON.stringify(overrides)
    );
    await Advertisement.deleteMany({});
  }
});

test('a nonexistent advertisement is rejected', async () => {
  await assert.rejects(
    () => submit({ advertisementId: new mongoose.Types.ObjectId().toString() }),
    (err) => err.code === 'ADVERTISEMENT_UNAVAILABLE'
  );
  await assert.rejects(
    () => submit({ advertisementId: 'not-an-id' }),
    (err) => err.code === 'ADVERTISEMENT_UNAVAILABLE'
  );
});

// --- Per-product quantities ----------------------------------------------

// Package "A x5, B x2" - catalog subtotal 5x30 + 2x25 = $200, total $150.
function makeQtyAdvertisement(overrides = {}) {
  return Advertisement.create({
    warehouseId: ids.warehouse,
    titleAr: 'باقة', titleEn: 'Bulk Package',
    items: [
      { productId: ids.productA, quantity: 5 },
      { productId: ids.productB, quantity: 2 },
    ],
    totalPriceUsd: 150,
    startDate: past(1), endDate: future(30), status: 'approved',
    ...overrides,
  });
}

function submitQty(items, advertisementId) {
  return orderService.createOrder({
    userId: ids.whUser, pharmacyId: ids.pharmacy, warehouseId: ids.warehouse,
    items, notes: null, advertisementId,
  });
}

test('ordering exactly the advertised quantities is charged the package total', async () => {
  const advertisement = await makeQtyAdvertisement();
  const order = await submitQty(
    [
      { productId: ids.productA.toString(), quantity: 5 },
      { productId: ids.productB.toString(), quantity: 2 },
    ],
    advertisement._id.toString()
  );

  assert.strictEqual(order.totalPrice, 200 * RATE); // 5x30 + 2x25
  assert.strictEqual(order.advertisementDiscountAmount, 50 * RATE); // 200 - 150
  assert.strictEqual(order.finalPrice, 150 * RATE);
});

test('ordering MORE than the advertised quantity bills the extras at catalog price, discount unchanged', async () => {
  const advertisement = await makeQtyAdvertisement();
  const order = await submitQty(
    [
      { productId: ids.productA.toString(), quantity: 10 }, // 5 extra
      { productId: ids.productB.toString(), quantity: 2 },
    ],
    advertisement._id.toString()
  );

  assert.strictEqual(order.totalPrice, 350 * RATE); // 10x30 + 2x25
  assert.strictEqual(order.advertisementDiscountAmount, 50 * RATE); // still 200 - 150
  // package total 150 + 5 extra A at $30 = 300
  assert.strictEqual(order.finalPrice, 300 * RATE);
});

test('ordering FEWER than the advertised quantity breaks the package', async () => {
  const advertisement = await makeQtyAdvertisement();
  await assert.rejects(
    () =>
      submitQty(
        [
          { productId: ids.productA.toString(), quantity: 4 }, // one short
          { productId: ids.productB.toString(), quantity: 2 },
        ],
        advertisement._id.toString()
      ),
    (err) => err.code === 'ADVERTISEMENT_ITEM_MISSING'
  );
});

test('the cart payload and the active list carry each line quantity + weighted total', async () => {
  const advertisement = await makeQtyAdvertisement();

  const { advertisements } = advertisementViewModel.toActiveAdvertisementsResponse(
    await advertisementService.listActiveAdvertisements()
  );
  const listed = advertisements.find((a) => String(a.id) === String(advertisement._id));
  assert.strictEqual(listed.itemsTotalUsd, 200);
  assert.strictEqual(listed.items.find((i) => i.nameEn === 'Product A').quantity, 5);

  const { advertisementCart } = advertisementViewModel.toAdvertisementCartResponse(
    await advertisementService.prepareAdvertisementCart(advertisement._id.toString())
  );
  assert.strictEqual(advertisementCart.itemsTotalUsd, 200);
  assert.strictEqual(advertisementCart.items.find((i) => i.nameEn === 'Product A').quantity, 5);
});

// --- The package price is what gets charged -------------------------------

test('the order is charged the package total, and the discount is catalog-sum minus total', async () => {
  const advertisement = await makeAdvertisement();
  const order = await submit({ advertisementId: advertisement._id.toString() });

  assert.strictEqual(order.totalPrice, 67 * RATE); // the catalog prices
  assert.strictEqual(order.advertisementDiscountAmount, 27 * RATE); // 67 - 40
  assert.strictEqual(String(order.advertisementId), String(advertisement._id));
  assert.strictEqual(order.discountAmount, 0);
  assert.strictEqual(order.finalPrice, 40 * RATE); // the package total
});

test('each package line is billed at the current catalog price', async () => {
  const advertisement = await makeAdvertisement();
  const order = await submit({ advertisementId: advertisement._id.toString() });

  const byName = new Map((await OrderItem.find({ orderId: order._id })).map((i) => [i.productNameEn, i]));
  assert.strictEqual(byName.get('Product A').discountPrice, 30 * RATE);
  assert.strictEqual(byName.get('Product A').unitPrice, 30 * RATE);
  assert.strictEqual(byName.get('Product B').discountPrice, 25 * RATE);
  assert.strictEqual(byName.get('Product C').discountPrice, 12 * RATE);
  // The whole saving is the one order-level line, not per-item.
  assert.ok(byName.get('Product A').savingsUsd === 0);
});

test('the discount follows a catalog price change - live, not a snapshot', async () => {
  const advertisement = await makeAdvertisement();
  await Product.updateOne({ _id: ids.productA }, { price: 50 }); // was 30

  const order = await submit({ advertisementId: advertisement._id.toString() });

  assert.strictEqual(order.totalPrice, 87 * RATE); // 50 + 25 + 12
  assert.strictEqual(order.advertisementDiscountAmount, 47 * RATE); // 87 - 40
  // The pharmacy still pays exactly the package total.
  assert.strictEqual(order.finalPrice, 40 * RATE);
});

test('the products own catalog prices are never modified by an order', async () => {
  const advertisement = await makeAdvertisement();
  await submit({ advertisementId: advertisement._id.toString() });

  const priceByName = new Map(
    (await Product.find({ warehouseId: ids.warehouse }).select('nameEn price priceHistory')).map((p) => [
      p.nameEn,
      p,
    ])
  );
  assert.strictEqual(priceByName.get('Product A').price, 30);
  assert.strictEqual(priceByName.get('Product B').price, 25);
  assert.strictEqual(priceByName.get('Product A').priceHistory.length, 0);
});

test('extra products added alongside the package price normally', async () => {
  const advertisement = await makeAdvertisement();
  const order = await submit({
    advertisementId: advertisement._id.toString(),
    items: [...packageItems(), { productId: ids.extra.toString(), quantity: 2 }],
  });

  assert.strictEqual(order.totalPrice, 77 * RATE); // 67 + 2 x 5
  assert.strictEqual(order.advertisementDiscountAmount, 27 * RATE); // unchanged
  assert.strictEqual(order.finalPrice, 50 * RATE);
});

test('extra units of a package product are charged the catalog price, discount counted once', async () => {
  const advertisement = await makeAdvertisement();
  const order = await submit({
    advertisementId: advertisement._id.toString(),
    items: [
      { productId: ids.productA.toString(), quantity: 3 },
      { productId: ids.productB.toString(), quantity: 1 },
      { productId: ids.productC.toString(), quantity: 1 },
    ],
  });

  assert.strictEqual(order.totalPrice, 127 * RATE); // 3x30 + 25 + 12
  assert.strictEqual(order.advertisementDiscountAmount, 27 * RATE); // one of each
  assert.strictEqual(order.finalPrice, 100 * RATE);
});

test('a package total at or above the catalog sum never becomes a surcharge', async () => {
  const advertisement = await makeAdvertisement({ totalPriceUsd: 100 });
  const order = await submit({ advertisementId: advertisement._id.toString() });

  assert.strictEqual(order.advertisementDiscountAmount, 0);
  assert.strictEqual(order.finalPrice, order.totalPrice); // 67 * RATE
});

// --- Security: the client cannot name its own price -----------------------

test('a client-supplied discount, total or price is ignored entirely', async () => {
  const advertisement = await makeAdvertisement();
  const order = await orderService.createOrder({
    userId: ids.whUser,
    pharmacyId: ids.pharmacy,
    warehouseId: ids.warehouse,
    items: packageItems(),
    notes: null,
    advertisementId: advertisement._id.toString(),
    discountAmount: 999999999,
    advertisementDiscountAmount: 999999999,
    totalPrice: 1,
    finalPrice: 1,
    commissionAmount: 0,
  });

  assert.strictEqual(order.totalPrice, 67 * RATE);
  assert.strictEqual(order.advertisementDiscountAmount, 27 * RATE);
  assert.strictEqual(order.finalPrice, 40 * RATE);
});

test('a client-sent per-line price cannot change what is charged', async () => {
  const advertisement = await makeAdvertisement();
  const order = await orderService.createOrder({
    userId: ids.whUser,
    pharmacyId: ids.pharmacy,
    warehouseId: ids.warehouse,
    items: packageItems().map((item) => ({ ...item, discountPrice: 1, advertisedPriceUsd: 0.01 })),
    notes: null,
    advertisementId: advertisement._id.toString(),
  });

  assert.strictEqual(order.totalPrice, 67 * RATE);
  assert.strictEqual(order.finalPrice, 40 * RATE);
});

test('an advertisement from another warehouse is rejected', async () => {
  const advertisement = await Advertisement.create({
    warehouseId: ids.otherWarehouse,
    titleAr: 'ب', titleEn: 'Other Package',
    items: [{ productId: ids.foreign }],
    totalPriceUsd: 4,
    startDate: past(1), endDate: future(30), status: 'approved',
  });

  await assert.rejects(
    () => submit({ advertisementId: advertisement._id.toString() }),
    (err) => err.code === 'ADVERTISEMENT_WAREHOUSE_MISMATCH'
  );
  assert.strictEqual(await Order.countDocuments({}), 0);
});

test('an incomplete package is rejected', async () => {
  const advertisement = await makeAdvertisement();
  await assert.rejects(
    () =>
      submit({
        advertisementId: advertisement._id.toString(),
        items: [{ productId: ids.productA.toString(), quantity: 1 }],
      }),
    (err) => err.code === 'ADVERTISEMENT_ITEM_MISSING'
  );
});

test('an unavailable or deactivated package product blocks the order', async () => {
  const advertisement = await makeAdvertisement();

  await Product.updateOne({ _id: ids.productB }, { isAvailable: false });
  await assert.rejects(
    () => submit({ advertisementId: advertisement._id.toString() }),
    (err) => err.code === 'STOCK_CHECK_FAILED'
  );

  await Product.updateOne({ _id: ids.productB }, { isAvailable: true, isActive: false });
  await assert.rejects(
    () => submit({ advertisementId: advertisement._id.toString() }),
    (err) => err.code === 'STOCK_CHECK_FAILED'
  );

  assert.strictEqual(await Order.countDocuments({}), 0);
});

// --- Nothing else changes -------------------------------------------------

test('a normal order without an advertisement is completely unaffected', async () => {
  const order = await submit();

  assert.strictEqual(order.advertisementId, null);
  assert.strictEqual(order.advertisementDiscountAmount, 0);
  assert.strictEqual(order.totalPrice, 67 * RATE);
  assert.strictEqual(order.finalPrice, 67 * RATE);
});

test('commission still follows totalPrice, unreduced by the package discount', async () => {
  await Warehouse.updateOne({ _id: ids.warehouse }, { commissionRate: 10, discountRate: 0 });
  const advertisement = await makeAdvertisement();
  const order = await submit({ advertisementId: advertisement._id.toString() });

  assert.strictEqual(order.commissionAmount, Math.round(67 * RATE * 0.1));
  assert.strictEqual(order.finalPrice, 40 * RATE);
  await Warehouse.updateOne({ _id: ids.warehouse }, { commissionRate: 0 });
});

test('the platform discount and the package discount are both applied, separately', async () => {
  await Warehouse.updateOne({ _id: ids.warehouse }, { discountRate: 10 });
  const advertisement = await makeAdvertisement();
  const order = await submit({ advertisementId: advertisement._id.toString() });

  // totalPrice 670,000; platform 10% = 67,000; package = 670,000 - 400,000 = 270,000.
  assert.strictEqual(order.discountAmount, 67000);
  assert.strictEqual(order.advertisementDiscountAmount, 270000);
  assert.strictEqual(order.finalPrice, 670000 - 67000 - 270000); // == 400,000 - 67,000
  await Warehouse.updateOne({ _id: ids.warehouse }, { discountRate: 0 });
});

test('the pharmacy balance is built from the discounted finalPrice', async () => {
  const advertisement = await makeAdvertisement();
  const order = await submit({ advertisementId: advertisement._id.toString() });
  await Order.updateOne({ _id: order._id }, { status: 'delivered' });

  const balance = await balanceService.recomputeBalance(ids.pharmacy, ids.warehouse);
  assert.strictEqual(balance.totalOrdersUsd, 40); // the package price, not $67
  assert.strictEqual(balance.balanceUsd, 40);
});

// --- Order editing --------------------------------------------------------

test('a warehouse edit that keeps the package intact preserves the discount', async () => {
  const advertisement = await makeAdvertisement();
  const order = await submit({ advertisementId: advertisement._id.toString() });

  await warehouseOrderService.updateOrderItems(order._id.toString(), ids.warehouse, ids.whUser, {
    addItems: [{ productId: ids.extra.toString(), quantity: 1 }],
  });

  const reread = await Order.findById(order._id);
  assert.strictEqual(String(reread.advertisementId), String(advertisement._id));
  assert.strictEqual(reread.advertisementDiscountAmount, 27 * RATE); // 67 - 40
  assert.strictEqual(reread.totalPrice, 72 * RATE); // 67 + the $5 extra
  assert.strictEqual(reread.finalPrice, 45 * RATE); // 72 - 27
});

test('a warehouse edit that breaks the package drops the discount and reprices', async () => {
  const advertisement = await makeAdvertisement();
  const order = await submit({ advertisementId: advertisement._id.toString() });
  const productCItem = (await OrderItem.find({ orderId: order._id })).find(
    (i) => String(i.productId) === String(ids.productC)
  );

  await warehouseOrderService.updateOrderItems(order._id.toString(), ids.warehouse, ids.whUser, {
    removeItems: [productCItem._id.toString()],
  });

  const reread = await Order.findById(order._id);
  assert.strictEqual(reread.advertisementId, null);
  assert.strictEqual(reread.advertisementDiscountAmount, 0);
  assert.strictEqual(reread.totalPrice, 55 * RATE); // 30 + 25 catalog prices
  assert.strictEqual(reread.finalPrice, 55 * RATE);
});

// --- Reorder / returns ----------------------------------------------------

test('reordering an advertisement order does not resurrect package pricing', async () => {
  const advertisement = await makeAdvertisement();
  const order = await submit({ advertisementId: advertisement._id.toString() });
  await Order.updateOne({ _id: order._id }, { status: 'delivered' });
  await Advertisement.updateOne({ _id: advertisement._id }, { endDate: past(1) });

  const { items } = await orderService.prepareReorder(order._id.toString(), ids.pharmacy);
  const byName = new Map(items.map((i) => [i.product.nameEn, i]));
  assert.strictEqual(byName.get('Product A').product.price, 30);
  assert.strictEqual(byName.get('Product B').product.price, 25);

  const reordered = await submit();
  assert.strictEqual(reordered.advertisementId, null);
  assert.strictEqual(reordered.advertisementDiscountAmount, 0);
  assert.strictEqual(reordered.totalPrice, 67 * RATE);
});

test('a replacement order for a returned package item is still zero-priced', async () => {
  const advertisement = await makeAdvertisement();
  const order = await submit({ advertisementId: advertisement._id.toString() });

  const replacement = await orderService.createOrder({
    userId: ids.whUser,
    pharmacyId: ids.pharmacy,
    warehouseId: ids.warehouse,
    items: [{ productId: ids.productA.toString(), quantity: 1 }],
    notes: `Replacement for return on order #${order.orderNumber}`,
    isReplacement: true,
  });

  assert.strictEqual(replacement.totalPrice, 0);
  assert.strictEqual(replacement.finalPrice, 0);
  assert.strictEqual(replacement.advertisementDiscountAmount, 0);
  assert.strictEqual(replacement.advertisementId, null);
});

// --- The cart-prefill endpoint --------------------------------------------

test('the cart payload carries the catalog prices and the package totals', async () => {
  const advertisement = await makeAdvertisement();
  const { advertisementCart } = advertisementViewModel.toAdvertisementCartResponse(
    await advertisementService.prepareAdvertisementCart(advertisement._id.toString())
  );

  assert.strictEqual(advertisementCart.items.length, 3);
  assert.strictEqual(advertisementCart.totalPriceUsd, 40);
  assert.strictEqual(advertisementCart.itemsTotalUsd, 67);
  assert.strictEqual(String(advertisementCart.warehouseId), String(ids.warehouse));
  const productA = advertisementCart.items.find((i) => i.nameEn === 'Product A');
  // The cart renders discountPriceUsd as the line price - the catalog price.
  assert.strictEqual(productA.discountPriceUsd, 30);
  assert.strictEqual(productA.priceUsd, 30);
  assert.strictEqual(productA.advertisedPriceUsd, undefined);
  assert.strictEqual(productA.quantity, 1);
});

test('an unavailable product is reported, not silently dropped into the cart', async () => {
  const advertisement = await makeAdvertisement();
  await Product.updateOne({ _id: ids.productB }, { isAvailable: false });

  const { advertisementCart } = advertisementViewModel.toAdvertisementCartResponse(
    await advertisementService.prepareAdvertisementCart(advertisement._id.toString())
  );

  assert.strictEqual(advertisementCart.items.length, 2);
  assert.strictEqual(advertisementCart.itemsTotalUsd, 42); // 30 + 12, the available ones
  assert.strictEqual(advertisementCart.unavailableItems.length, 1);
  assert.strictEqual(advertisementCart.unavailableItems[0].productNameEn, 'Product B');
});

test('the cart endpoint refuses an advertisement that is not live', async () => {
  const advertisement = await makeAdvertisement({ status: 'pending' });
  await assert.rejects(
    () => advertisementService.prepareAdvertisementCart(advertisement._id.toString()),
    (err) => err.code === 'ADVERTISEMENT_UNAVAILABLE'
  );
});
