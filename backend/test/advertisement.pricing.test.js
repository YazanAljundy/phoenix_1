// Money-Flow V2 - what a warehouse actually nets on an advertised package.
//
// V1 took the 4% platform discount on the CATALOG subtotal and the 1%
// commission on that same pre-discount figure, even when the pharmacy was
// buying a package for far less. A warehouse advertising a $40 package
// collected $36.65 of it - an 8.375% cut off its own advertised price rather
// than the intended ~5%.
//
// V2 takes the discount on what the pharmacy would otherwise pay (the package
// price) and the commission on what it finally does pay, which gives a
// predictable cut:
//
//     discountRate + commissionRate x (1 - discountRate)
//   = 4% + 1% x 0.96
//   = 4.96%
//
// The first test below is the worked example, asserted end to end against the
// real order-creation path.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-ad-pricing';
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

const orderService = require('../src/services/order.service');
const warehouseOrderService = require('../src/services/warehouseOrder.service');
const { rollUpOrderMoney } = require('../src/services/order.service');

const RATE = 10000;
const DAY = 24 * 60 * 60 * 1000;
const ids = {};

const past = (days) => new Date(Date.now() - days * DAY);
const future = (days) => new Date(Date.now() + days * DAY);

// Catalog $30 + $25 + $12 = $67; the package sells all three for $40.
const CATALOG = { A: 30, B: 25, C: 12 };
const PACKAGE_USD = 40;

async function makeAdvertisement(overrides = {}) {
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

async function setRates({ discountRate, commissionRate }) {
  await Warehouse.updateOne({ _id: ids.warehouse }, { discountRate, commissionRate });
}

test.before(async () => {
  await startMemoryMongo({ dbName: 'feniq-ad-pricing-test' });
  await syncIndexes(Order);
  await ExchangeRate.create({ _id: 'singleton', usdToSyp: RATE, source: 'manual' });

  const [whUser, phUser] = await User.create([
    { name: 'WH', phone: '0942000701', role: 'warehouse', status: 'active' },
    { name: 'PH', phone: '0932000701', role: 'pharmacy', status: 'active' },
  ]);
  ids.whUser = whUser._id;

  const warehouse = await Warehouse.create({
    userId: whUser._id, nameAr: 'م', nameEn: 'Warehouse', address: 'r', city: 'Latakia',
    phone: '0942000701', deliveryType: 'self', isActive: true,
    discountRate: 4, commissionRate: 1,
  });
  ids.warehouse = warehouse._id;

  const pharmacy = await Pharmacy.create({
    userId: phUser._id, nameAr: 'ص', nameEn: 'Pharmacy', ownerName: 'O',
    address: 'a', city: 'Latakia', phone: '0932000701', addedBy: 'self',
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
  await Promise.all([Advertisement.deleteMany({}), Order.deleteMany({}), OrderItem.deleteMany({})]);
  await setRates({ discountRate: 4, commissionRate: 1 });
  await Product.updateOne({ _id: ids.productA }, { price: CATALOG.A });
});

// ---------------------------------------------------------------------------
// THE WORKED EXAMPLE
// ---------------------------------------------------------------------------

test('worked example: $67 catalog, $40 package, rate 10,000, 4% + 1%', async () => {
  const advertisement = await makeAdvertisement();
  const order = await submit({ advertisementId: advertisement._id.toString() });

  // Context only - the catalog sum drives the "you save 40%" badge on the ad
  // card, and no longer has any part in what is charged.
  assert.strictEqual(order.totalPrice, 670000, 'catalog subtotal');
  assert.strictEqual(order.advertisementDiscountAmount, 270000, '670,000 - 400,000');

  // The package price is the base the platform discount comes off.
  //   packageBase      = round(40 x 10,000) = 400,000
  //   platformDiscount = round(400,000 x 4%) =  16,000
  assert.strictEqual(order.discountAmount, 16000, '4% of the PACKAGE price, not the catalog sum');

  // What the pharmacy pays.
  assert.strictEqual(order.finalPrice, 384000);
  assert.strictEqual(order.finalAmountUsd, 38.4);

  // Commission on the revenue actually realised.
  assert.strictEqual(order.commissionAmount, 3840, 'round(384,000 x 1%)');

  // What the warehouse keeps.
  const warehouseNet = order.finalPrice - order.commissionAmount;
  assert.strictEqual(warehouseNet, 380160);

  // ...and the cut off its own advertised price: 4.96%.
  const advertisedSyp = PACKAGE_USD * RATE;
  const effectiveCutPct = ((advertisedSyp - warehouseNet) / advertisedSyp) * 100;
  assert.strictEqual(Number(effectiveCutPct.toFixed(3)), 4.96);
});

test('the effective cut is discountRate + commissionRate x (1 - discountRate)', async () => {
  for (const [discountRate, commissionRate] of [
    [4, 1],
    [10, 5],
    [0, 2],
    [3, 0],
  ]) {
    await setRates({ discountRate, commissionRate });
    const advertisement = await makeAdvertisement();
    const order = await submit({ advertisementId: advertisement._id.toString() });

    const advertisedSyp = PACKAGE_USD * RATE;
    const net = order.finalPrice - order.commissionAmount;
    const actualPct = ((advertisedSyp - net) / advertisedSyp) * 100;
    const expectedPct = discountRate + commissionRate * (1 - discountRate / 100);

    assert.strictEqual(
      Number(actualPct.toFixed(4)),
      Number(expectedPct.toFixed(4)),
      `discountRate ${discountRate}%, commissionRate ${commissionRate}%`
    );

    await Advertisement.deleteMany({});
    await Order.deleteMany({});
    await OrderItem.deleteMany({});
  }
});

// ---------------------------------------------------------------------------
// The rules behind it
// ---------------------------------------------------------------------------

test('the platform discount is taken on the package price, not the catalog sum', async () => {
  await setRates({ discountRate: 10, commissionRate: 0 });
  const advertisement = await makeAdvertisement();
  const order = await submit({ advertisementId: advertisement._id.toString() });

  // V1 asserted 67,000 here (10% of 670,000) and a finalPrice of 333,000.
  assert.strictEqual(order.discountAmount, 40000, '10% of 400,000');
  assert.strictEqual(order.finalPrice, 360000, '400,000 - 40,000');
});

test('commission follows finalPrice, not the pre-discount subtotal', async () => {
  await setRates({ discountRate: 0, commissionRate: 10 });
  const advertisement = await makeAdvertisement();
  const order = await submit({ advertisementId: advertisement._id.toString() });

  // V1 asserted 67,000 here (10% of the 670,000 catalog subtotal).
  assert.strictEqual(order.finalPrice, 400000);
  assert.strictEqual(order.commissionAmount, 40000, '10% of what the pharmacy pays');
});

test('a normal order is arithmetically unchanged from V1', async () => {
  // No advertisement => no package discount => the discount base IS the
  // subtotal, so the roll-up reduces to exactly what V1 did for the discount.
  const order = await submit();

  assert.strictEqual(order.advertisementDiscountAmount, 0);
  assert.strictEqual(order.totalPrice, 670000);
  assert.strictEqual(order.discountAmount, 26800, '4% of 670,000, same as V1');
  assert.strictEqual(order.finalPrice, 643200);
  // The one difference on a normal order: commission is on finalPrice, so the
  // warehouse is no longer charged for money the platform discounted away.
  assert.strictEqual(order.commissionAmount, 6432, '1% of 643,200, not of 670,000');
});

test('extra units beyond the advertised quantity price normally and discount normally', async () => {
  const advertisement = await makeAdvertisement();
  const order = await orderService.createOrder({
    userId: ids.whUser,
    pharmacyId: ids.pharmacy,
    warehouseId: ids.warehouse,
    notes: null,
    advertisementId: advertisement._id.toString(),
    items: [
      { productId: ids.productA.toString(), quantity: 3 }, // 2 extra at $30
      { productId: ids.productB.toString(), quantity: 1 },
      { productId: ids.productC.toString(), quantity: 1 },
    ],
  });

  // Subtotal 3x30 + 25 + 12 = $127; the package discount is still counted once.
  assert.strictEqual(order.totalPrice, 1270000);
  assert.strictEqual(order.advertisementDiscountAmount, 270000);
  // Discount base = package 400,000 + the 2 extra units at 600,000 = 1,000,000.
  assert.strictEqual(order.discountAmount, 40000, '4% of 1,000,000');
  assert.strictEqual(order.finalPrice, 960000);
  assert.strictEqual(order.commissionAmount, 9600);
});

test('a package total at or above the catalog sum still never becomes a surcharge', async () => {
  const advertisement = await makeAdvertisement({ totalPriceUsd: 100 });
  const order = await submit({ advertisementId: advertisement._id.toString() });

  assert.strictEqual(order.advertisementDiscountAmount, 0);
  // Falls back to a plain order: 4% of the catalog subtotal.
  assert.strictEqual(order.discountAmount, 26800);
  assert.strictEqual(order.finalPrice, 643200);
});

test('the discount follows a catalog price change, and the package price still wins', async () => {
  const advertisement = await makeAdvertisement();
  await Product.updateOne({ _id: ids.productA }, { price: 50 }); // was 30

  const order = await submit({ advertisementId: advertisement._id.toString() });

  assert.strictEqual(order.totalPrice, 870000, '50 + 25 + 12');
  assert.strictEqual(order.advertisementDiscountAmount, 470000, '870,000 - 400,000');
  assert.strictEqual(order.discountAmount, 16000, 'still 4% of the package price');
  assert.strictEqual(order.finalPrice, 384000, 'the pharmacy pays the same either way');
});

// ---------------------------------------------------------------------------
// The edit path uses the same roll-up
// ---------------------------------------------------------------------------

test('a warehouse edit that keeps the package intact reprices by the same rule', async () => {
  const advertisement = await makeAdvertisement();
  const order = await submit({ advertisementId: advertisement._id.toString() });

  // Add a $12 product (product C again would break the package shape, so add
  // one more unit of it - the package still holds at >= advertised quantity).
  await warehouseOrderService.updateOrderItems(
    order._id.toString(), ids.warehouse, ids.whUser,
    { addItems: [{ productId: ids.productC.toString(), quantity: 1 }] }
  );

  const reread = await Order.findById(order._id).lean();
  assert.strictEqual(reread.totalPrice, 790000, '670,000 + one more $12 unit');
  assert.strictEqual(reread.advertisementDiscountAmount, 270000);
  assert.strictEqual(reread.discountAmount, 20800, '4% of (790,000 - 270,000)');
  assert.strictEqual(reread.finalPrice, 499200);
  assert.strictEqual(reread.commissionAmount, 4992, '1% of finalPrice');
  assert.strictEqual(reread.finalAmountUsd, 49.92, 'the frozen USD figure moved with it');
});

test('an edit that breaks the package reprices as a normal order', async () => {
  const advertisement = await makeAdvertisement();
  const order = await submit({ advertisementId: advertisement._id.toString() });
  const items = await OrderItem.find({ orderId: order._id });
  const productCItem = items.find((i) => String(i.productId) === String(ids.productC));

  await warehouseOrderService.updateOrderItems(
    order._id.toString(), ids.warehouse, ids.whUser,
    { removeItems: [productCItem._id.toString()] }
  );

  const reread = await Order.findById(order._id).lean();
  assert.strictEqual(reread.advertisementId, null);
  assert.strictEqual(reread.advertisementDiscountAmount, 0);
  assert.strictEqual(reread.totalPrice, 550000, '30 + 25 at catalog price');
  assert.strictEqual(reread.discountAmount, 22000, '4% of 550,000');
  assert.strictEqual(reread.finalPrice, 528000);
  assert.strictEqual(reread.commissionAmount, 5280);
});

// ---------------------------------------------------------------------------
// The roll-up as a pure function
// ---------------------------------------------------------------------------

test('rollUpOrderMoney is the single definition both paths share', () => {
  const rolled = rollUpOrderMoney({
    subtotalSyp: 670000,
    advertisementDiscountSypAmount: 270000,
    discountRate: 4,
    commissionRate: 1,
  });

  assert.deepStrictEqual(rolled, {
    discountAmount: 16000,
    advertisementDiscountAmount: 270000,
    finalPrice: 384000,
    commissionAmount: 3840,
    warehouseNetSyp: 380160,
  });
});

test('rollUpOrderMoney with no package discount is the plain V1 discount', () => {
  const rolled = rollUpOrderMoney({
    subtotalSyp: 670000,
    discountRate: 4,
    commissionRate: 1,
  });

  assert.strictEqual(rolled.discountAmount, 26800);
  assert.strictEqual(rolled.finalPrice, 643200);
  assert.strictEqual(rolled.commissionAmount, 6432);
});
