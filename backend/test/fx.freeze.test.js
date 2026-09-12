// Money-Flow V2 - historical exchange rates.
//
// The single rule these tests exist to protect: a monetary event's value is
// fixed the moment it happens and is never recomputed. The global rate is a
// quote for NEW events, nothing more.
//
// V1's defect (audit C2) was the opposite - pharmacyBalance.recomputeBalance
// re-divided every historical order and every SYP payment by TODAY's rate on
// every recompute, so a settled account drifted into a phantom credit or debt
// whenever the lira moved.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-fx-tests';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');

const { startMemoryMongo, stopMemoryMongo, syncIndexes } = require('./helpers/mongo');

const User = require('../src/models/user.model');
const Pharmacy = require('../src/models/pharmacy.model');
const Warehouse = require('../src/models/warehouse.model');
const Product = require('../src/models/product.model');
const Order = require('../src/models/order.model');
const OrderItem = require('../src/models/orderItem.model');
const Payment = require('../src/models/payment.model');
const ExchangeRate = require('../src/models/exchangeRate.model');
const ExchangeRateHistory = require('../src/models/exchangeRateHistory.model');

const LedgerAccount = require('../src/models/ledgerAccount.model');
const LedgerEntry = require('../src/models/ledgerEntry.model');

const orderService = require('../src/services/order.service');
const ledger = require('../src/services/ledger.service');
const { runInTransaction } = require('../src/utils/transaction');
const paymentService = require('../src/services/payment.service');
const exchangeRateService = require('../src/services/exchangeRate.service');

const ids = {};

async function setRate(usdToSyp) {
  await ExchangeRate.findByIdAndUpdate(
    'singleton',
    { usdToSyp, source: 'manual', lastUpdated: new Date(), manualOverride: true },
    { upsert: true, new: true }
  );
}

function placeOrder(quantity = 1) {
  return orderService.createOrder({
    userId: ids.pharmacyUser,
    pharmacyId: ids.pharmacy,
    warehouseId: ids.warehouse,
    items: [{ productId: ids.product.toString(), quantity }],
    notes: null,
  });
}

// Money-Flow V2 requires a real trading relationship before a warehouse may
// record a payment (a pharmacy it has actually delivered to). Seeded once here
// so the payment tests below exercise the FX freeze rather than that gate,
// which payment.test.js covers on its own.
async function seedTradingRelationship() {
  const order = await Order.create({
    orderNumber: 777001,
    pharmacyId: ids.pharmacy,
    warehouseId: ids.warehouse,
    status: 'delivered',
    totalPrice: 10000, discountAmount: 0, commissionAmount: 0, finalPrice: 10000,
    finalAmountUsd: 1,
    fx: { rate: 10000, source: 'manual', rateAsOf: new Date() },
    statusHistory: [{ status: 'delivered', changedBy: ids.whUser, changedAt: new Date() }],
  });
  const account = await ledger.resolveAccount(ids.pharmacy, ids.warehouse);
  await runInTransaction((session) =>
    ledger.postEntry(
      {
        account, kind: 'charge', amountSyp: 10000, amountUsd: 1,
        fx: order.fx, source: { orderId: order._id },
      },
      session
    )
  );
}

test.before(async () => {
  await startMemoryMongo({ dbName: 'feniq-fx-test' });
  await syncIndexes(Order, LedgerEntry, LedgerAccount);

  const [phUser, whUser] = await User.create([
    { name: 'Ph', phone: '0931000101', role: 'pharmacy', status: 'active' },
    { name: 'WH', phone: '0941000101', role: 'warehouse', status: 'active' },
  ]);
  ids.pharmacyUser = phUser._id;
  ids.whUser = whUser._id;

  const pharmacy = await Pharmacy.create({
    userId: phUser._id, nameAr: 'ص', nameEn: 'Pharmacy', ownerName: 'O',
    address: 'a', city: 'Latakia', phone: '0931000101', addedBy: 'self',
  });
  ids.pharmacy = pharmacy._id;

  // Rates zeroed so these tests isolate the FX behaviour from the discount maths.
  const warehouse = await Warehouse.create({
    userId: whUser._id, nameAr: 'م', nameEn: 'Warehouse', address: 'r', city: 'Latakia',
    phone: '0941000101', deliveryType: 'self', isActive: true, discountRate: 0, commissionRate: 0,
  });
  ids.warehouse = warehouse._id;

  const product = await Product.create({
    warehouseId: warehouse._id, nameAr: 'دواء', nameEn: 'Drug', manufacturerAr: 'شركة',
    price: 100, unitAr: 'علبة', unitEn: 'box', isAvailable: true, isActive: true,
  });
  ids.product = product._id;

  await setRate(10000);
  await seedTradingRelationship();
});

test.after(async () => {
  await stopMemoryMongo();
});

test.beforeEach(async () => {
  // The seeded delivered order (and its ledger charge) is kept - it is what
  // gives the warehouse permission to record a payment at all.
  await Promise.all([
    Order.deleteMany({ orderNumber: { $ne: 777001 } }),
    OrderItem.deleteMany({}),
    Payment.deleteMany({}),
  ]);
});

// --- orders -----------------------------------------------------------------

test('an order freezes the rate it was priced through', async () => {
  await setRate(10000);
  const order = await placeOrder();

  assert.strictEqual(order.currency, 'SYP');
  assert.strictEqual(order.fx.rate, 10000);
  assert.strictEqual(order.finalPrice, 1000000); // $100 x 10,000
  assert.strictEqual(order.finalAmountUsd, 100);
});

test('changing the global rate does not touch an existing order', async () => {
  await setRate(10000);
  const order = await placeOrder();

  await setRate(15000);
  const reread = await Order.findById(order._id).lean();

  assert.strictEqual(reread.fx.rate, 10000, 'the order keeps the rate it was priced at');
  assert.strictEqual(reread.finalPrice, 1000000, 'SYP total is untouched');
  assert.strictEqual(reread.finalAmountUsd, 100, 'the USD figure is frozen, not re-derived');
});

test('a later order is priced at the new rate, side by side with the old one', async () => {
  await setRate(10000);
  const first = await placeOrder();
  await setRate(15000);
  const second = await placeOrder();

  assert.strictEqual(first.finalPrice, 1000000);
  assert.strictEqual(second.finalPrice, 1500000);
  assert.strictEqual(first.finalAmountUsd, 100);
  assert.strictEqual(second.finalAmountUsd, 100, 'both are $100 of product, at different rates');
});

test('order line items freeze their saving in SYP as well as USD', async () => {
  await setRate(10000);
  const order = await placeOrder(2);
  const [item] = await OrderItem.find({ orderId: order._id }).lean();

  // No offer or manufacturer discount on this product, so both are zero - the
  // point is that the field exists and is frozen rather than derived on read.
  assert.strictEqual(item.savingsSyp, 0);
  assert.strictEqual(item.savingsUsd, 0);
  assert.strictEqual(item.unitPrice, 1000000);
});

// --- payments ---------------------------------------------------------------

test('a SYP payment freezes an exact SYP amount and a converted USD amount', async () => {
  await setRate(10000);
  const payment = await paymentService.createPayment(ids.warehouse, ids.whUser, {
    pharmacyId: ids.pharmacy.toString(),
    amount: 500000,
    currency: 'SYP',
  });

  assert.strictEqual(payment.amountSyp, 500000, 'SYP tender is exact');
  assert.strictEqual(payment.amountUsd, 50);
  assert.strictEqual(payment.fx.rate, 10000);
});

test('a USD payment freezes an exact USD amount and a converted SYP amount', async () => {
  await setRate(10000);
  const payment = await paymentService.createPayment(ids.warehouse, ids.whUser, {
    pharmacyId: ids.pharmacy.toString(),
    amount: 50,
    currency: 'USD',
  });

  assert.strictEqual(payment.amountUsd, 50, 'USD tender is exact');
  assert.strictEqual(payment.amountSyp, 500000);
  assert.strictEqual(payment.fx.rate, 10000);
});

test('changing the global rate does not touch an existing payment', async () => {
  await setRate(10000);
  const payment = await paymentService.createPayment(ids.warehouse, ids.whUser, {
    pharmacyId: ids.pharmacy.toString(),
    amount: 50,
    currency: 'USD',
  });

  await setRate(12000);
  const reread = await Payment.findById(payment._id).lean();

  assert.strictEqual(reread.amountUsd, 50);
  assert.strictEqual(reread.amountSyp, 500000, 'the settled SYP value is frozen');
  assert.strictEqual(reread.fx.rate, 10000);
});

// --- the phantom-credit scenario, end to end --------------------------------

test('a USD payment settling a SYP order stays settled after the rate moves', async () => {
  // This is the exact V1 defect: order $100 at 10,000, paid $100 USD, then the
  // rate rises to 12,000. V1 recomputed the order as $83.33 against a payment
  // still worth $100 and reported a ~$16.67 credit the pharmacy never earned.
  await setRate(10000);
  const order = await placeOrder();
  assert.strictEqual(order.finalPrice, 1000000);

  const payment = await paymentService.createPayment(ids.warehouse, ids.whUser, {
    pharmacyId: ids.pharmacy.toString(),
    amount: 100,
    currency: 'USD',
  });

  // Settled: the charge and the payment are the same frozen SYP figure.
  assert.strictEqual(payment.amountSyp, order.finalPrice);

  await setRate(12000);

  const orderAfter = await Order.findById(order._id).lean();
  const paymentAfter = await Payment.findById(payment._id).lean();

  assert.strictEqual(
    orderAfter.finalPrice - paymentAfter.amountSyp,
    0,
    'still exactly settled in SYP after the rate move'
  );
  assert.strictEqual(
    orderAfter.finalAmountUsd - paymentAfter.amountUsd,
    0,
    'and exactly settled in USD too - no phantom credit'
  );
});

// --- rate history -----------------------------------------------------------

test('a manual rate change appends to the history with the previous value', async () => {
  await ExchangeRateHistory.deleteMany({});
  await setRate(10000);

  await exchangeRateService.setManualRate(11500, ids.whUser);
  const {
    rows: [latest],
  } = await exchangeRateService.listRateHistory({ limit: 1 });

  assert.strictEqual(latest.usdToSyp, 11500);
  assert.strictEqual(latest.previousUsdToSyp, 10000);
  assert.strictEqual(latest.source, 'manual');
  assert.strictEqual(String(latest.changedBy), String(ids.whUser));
});

test('re-setting the same rate appends nothing - only real movements are recorded', async () => {
  await ExchangeRateHistory.deleteMany({});
  await exchangeRateService.setManualRate(12345);
  await exchangeRateService.setManualRate(12345);

  assert.strictEqual(await ExchangeRateHistory.countDocuments(), 1);
});

test('captureFxSnapshot reports the current rate with its provenance', async () => {
  await setRate(13000);
  const snapshot = await exchangeRateService.captureFxSnapshot();

  assert.strictEqual(snapshot.rate, 13000);
  assert.strictEqual(snapshot.source, 'manual');
  assert.ok(snapshot.rateAsOf instanceof Date);
  assert.strictEqual(snapshot.estimated, false);
});

// --- order idempotency ------------------------------------------------------

test('re-submitting an order with the same idempotency key returns the first order', async () => {
  await setRate(10000);
  const key = 'test-key-' + new mongoose.Types.ObjectId().toString();

  const first = await orderService.createOrder({
    userId: ids.pharmacyUser, pharmacyId: ids.pharmacy, warehouseId: ids.warehouse,
    items: [{ productId: ids.product.toString(), quantity: 1 }], notes: null, idempotencyKey: key,
  });
  const second = await orderService.createOrder({
    userId: ids.pharmacyUser, pharmacyId: ids.pharmacy, warehouseId: ids.warehouse,
    items: [{ productId: ids.product.toString(), quantity: 1 }], notes: null, idempotencyKey: key,
  });

  assert.strictEqual(String(first._id), String(second._id));
  assert.strictEqual(second.$locals.idempotentReplay, true);
  assert.strictEqual(await Order.countDocuments({ pharmacyId: ids.pharmacy }), 2);
});

test('two concurrent submissions with the same key still create only one order', async () => {
  await setRate(10000);
  const key = 'race-key-' + new mongoose.Types.ObjectId().toString();
  const submit = () =>
    orderService.createOrder({
      userId: ids.pharmacyUser, pharmacyId: ids.pharmacy, warehouseId: ids.warehouse,
      items: [{ productId: ids.product.toString(), quantity: 1 }], notes: null, idempotencyKey: key,
    });

  const [a, b] = await Promise.all([submit(), submit()]);

  assert.strictEqual(String(a._id), String(b._id), 'both callers see the same order');
  assert.strictEqual(await Order.countDocuments({ pharmacyId: ids.pharmacy }), 2);
});

test('orders without an idempotency key are unaffected', async () => {
  await setRate(10000);
  await placeOrder();
  await placeOrder();
  // +1 for the seeded delivered order that establishes the trading relationship.
  assert.strictEqual(await Order.countDocuments({ pharmacyId: ids.pharmacy }), 3);
});
