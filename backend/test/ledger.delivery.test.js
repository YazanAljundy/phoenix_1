// Money-Flow V2 - delivery is the one event in an order's life that moves money.
//
// What these tests pin down:
//   * exactly one `charge` entry per delivered order, ever
//   * the charge carries the ORDER's frozen rate, not the rate on delivery day
//   * a retried or concurrent delivery cannot bill the pharmacy twice
//   * no ledger entry exists for any status before `delivered`
//   * the whole transition is atomic - status, invoice number and charge
//     either all land or none do
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-delivery-tests';
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
const ExchangeRate = require('../src/models/exchangeRate.model');
const LedgerAccount = require('../src/models/ledgerAccount.model');
const LedgerEntry = require('../src/models/ledgerEntry.model');
const FinancialAuditLog = require('../src/models/financialAuditLog.model');

const orderService = require('../src/services/order.service');
const warehouseOrderService = require('../src/services/warehouseOrder.service');
const ledger = require('../src/services/ledger.service');

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

// Walks an order all the way to 'delivered' through the real transitions.
async function deliver(order) {
  let current = order;
  for (let i = 0; i < 4; i += 1) {
    current = await warehouseOrderService.advanceOrderStatus(
      current._id.toString(),
      ids.warehouse,
      ids.whUser
    );
  }
  assert.strictEqual(current.status, 'delivered');
  return current;
}

async function accountFor() {
  return ledger.findAccount(ids.pharmacy, ids.warehouse);
}

test.before(async () => {
  await startMemoryMongo({ dbName: 'feniq-delivery-ledger-test' });
  await syncIndexes(LedgerEntry, LedgerAccount, Order);

  const [phUser, whUser] = await User.create([
    { name: 'Ph', phone: '0931000201', role: 'pharmacy', status: 'active' },
    { name: 'WH', phone: '0941000201', role: 'warehouse', status: 'active' },
  ]);
  ids.pharmacyUser = phUser._id;
  ids.whUser = whUser._id;

  const pharmacy = await Pharmacy.create({
    userId: phUser._id, nameAr: 'ص', nameEn: 'Pharmacy', ownerName: 'O',
    address: 'a', city: 'Latakia', phone: '0931000201', addedBy: 'self',
  });
  ids.pharmacy = pharmacy._id;

  // Rates zeroed so the charge equals the catalog total and the arithmetic
  // under test is the ledger's, not the discount engine's.
  const warehouse = await Warehouse.create({
    userId: whUser._id, nameAr: 'م', nameEn: 'Warehouse', address: 'r', city: 'Latakia',
    phone: '0941000201', deliveryType: 'self', isActive: true, discountRate: 0, commissionRate: 0,
  });
  ids.warehouse = warehouse._id;

  const product = await Product.create({
    warehouseId: warehouse._id, nameAr: 'دواء', nameEn: 'Drug', manufacturerAr: 'شركة',
    price: 100, unitAr: 'علبة', unitEn: 'box', isAvailable: true, isActive: true,
  });
  ids.product = product._id;

  await setRate(10000);
});

test.after(async () => {
  await stopMemoryMongo();
});

test.beforeEach(async () => {
  await Promise.all([
    Order.deleteMany({}),
    OrderItem.deleteMany({}),
    LedgerEntry.deleteMany({}),
    LedgerAccount.deleteMany({}),
    FinancialAuditLog.deleteMany({}),
  ]);
});

// --- nothing happens before delivery ---------------------------------------

test('no ledger entry exists for any status before delivered', async () => {
  const order = await placeOrder();

  for (const expected of ['confirmed', 'preparing', 'out_for_delivery']) {
    const moved = await warehouseOrderService.advanceOrderStatus(
      order._id.toString(),
      ids.warehouse,
      ids.whUser
    );
    assert.strictEqual(moved.status, expected);
    assert.strictEqual(
      await LedgerEntry.countDocuments({ 'source.orderId': order._id }),
      0,
      `no entry at status ${expected}`
    );
  }
});

test('a pending order has no invoice number', async () => {
  const order = await placeOrder();
  assert.strictEqual(order.invoiceNumber, null);
});

// --- the charge -------------------------------------------------------------

test('delivery posts exactly one charge, for the order final price', async () => {
  const order = await placeOrder();
  const delivered = await deliver(order);

  const entries = await LedgerEntry.find({ 'source.orderId': order._id }).lean();
  assert.strictEqual(entries.length, 1);

  const [charge] = entries;
  assert.strictEqual(charge.kind, 'charge');
  assert.strictEqual(charge.direction, 'debit');
  assert.strictEqual(charge.amountSyp, delivered.finalPrice);
  assert.strictEqual(charge.amountSyp, 1000000);
  assert.strictEqual(charge.amountUsd, 100);
  assert.strictEqual(charge.sequence, 1);
});

test('the charge moves the account balance', async () => {
  const order = await placeOrder();
  await deliver(order);

  const account = await accountFor();
  assert.strictEqual(account.balanceCache.syp, 1000000);
  assert.strictEqual(account.balanceCache.usd, 100);
  assert.strictEqual(account.balanceCache.lastEntrySeq, 1);
});

test('delivery assigns an invoice number and stamps deliveredAt', async () => {
  const order = await placeOrder();
  const delivered = await deliver(order);

  assert.ok(delivered.invoiceNumber > 0, 'an invoice number is assigned');
  assert.ok(delivered.deliveredAt instanceof Date);
  assert.ok(delivered.chargeEntryId, 'the order links back to its charge');
});

test('invoice numbers are unique across orders', async () => {
  const first = await deliver(await placeOrder());
  const second = await deliver(await placeOrder());

  assert.notStrictEqual(first.invoiceNumber, second.invoiceNumber);
  assert.strictEqual(second.invoiceNumber, first.invoiceNumber + 1);
});

test('the charge carries the ORDER exchange rate, not the rate on delivery day', async () => {
  await setRate(10000);
  const order = await placeOrder();
  assert.strictEqual(order.fx.rate, 10000);

  // The lira moves between the order being placed and being delivered.
  await setRate(15000);
  await deliver(order);

  const charge = await LedgerEntry.findOne({ 'source.orderId': order._id, kind: 'charge' }).lean();
  assert.strictEqual(charge.fx.rate, 10000, 'the rate the order was priced at');
  assert.strictEqual(charge.amountSyp, 1000000);
  assert.strictEqual(charge.amountUsd, 100, 'not 66.67 - the USD figure is frozen too');

  await setRate(10000);
});

test('the charge freezes the pricing breakdown in its metadata', async () => {
  const order = await placeOrder(2);
  const delivered = await deliver(order);

  const charge = await LedgerEntry.findOne({ 'source.orderId': order._id, kind: 'charge' }).lean();
  assert.strictEqual(charge.metadata.orderNumber, delivered.orderNumber);
  assert.strictEqual(charge.metadata.invoiceNumber, delivered.invoiceNumber);
  assert.strictEqual(charge.metadata.subtotalSyp, delivered.totalPrice);
  assert.strictEqual(charge.metadata.finalAmountSyp, delivered.finalPrice);
});

test('delivery writes a financial audit record', async () => {
  const order = await placeOrder();
  const delivered = await deliver(order);

  const [audit] = await FinancialAuditLog.find({ entityId: order._id }).lean();
  assert.ok(audit, 'an audit record exists');
  assert.strictEqual(audit.action, 'order.delivered');
  assert.strictEqual(String(audit.actorId), String(ids.whUser));
  assert.strictEqual(audit.after.invoiceNumber, delivered.invoiceNumber);
  assert.strictEqual(audit.ledgerEntryIds.length, 1);
});

// --- no double charging -----------------------------------------------------

test('an order already delivered cannot be advanced again', async () => {
  const order = await placeOrder();
  await deliver(order);

  await assert.rejects(
    () => warehouseOrderService.advanceOrderStatus(order._id.toString(), ids.warehouse, ids.whUser),
    (err) => err.code === 'ORDER_NOT_ADVANCEABLE'
  );
  assert.strictEqual(await LedgerEntry.countDocuments({ 'source.orderId': order._id }), 1);
});

test('two concurrent deliveries produce one charge and one conflict', async () => {
  const order = await placeOrder();
  // Walk it to the last step before delivery, then race the final transition.
  let current = order;
  for (let i = 0; i < 3; i += 1) {
    current = await warehouseOrderService.advanceOrderStatus(
      current._id.toString(),
      ids.warehouse,
      ids.whUser
    );
  }
  assert.strictEqual(current.status, 'out_for_delivery');

  const advance = () =>
    warehouseOrderService
      .advanceOrderStatus(order._id.toString(), ids.warehouse, ids.whUser)
      .then(() => 'ok')
      .catch((err) => err.code || err.message);

  const results = await Promise.all([advance(), advance()]);

  assert.strictEqual(results.filter((r) => r === 'ok').length, 1, 'exactly one caller succeeds');
  assert.strictEqual(
    await LedgerEntry.countDocuments({ 'source.orderId': order._id, kind: 'charge' }),
    1,
    'the pharmacy is charged once, never twice'
  );

  const account = await accountFor();
  assert.strictEqual(account.balanceCache.syp, 1000000);
});

test('the unique index makes a second charge for the same order impossible', async () => {
  const order = await placeOrder();
  await deliver(order);

  const account = await accountFor();
  const { runInTransaction } = require('../src/utils/transaction');

  await assert.rejects(
    () =>
      runInTransaction((session) =>
        ledger.postEntry(
          {
            account,
            kind: 'charge',
            amountSyp: 1,
            source: { orderId: order._id },
          },
          session
        )
      ),
    (err) => err.code === 11000,
    'the database refuses a second charge even if a caller tries directly'
  );

  const reread = await accountFor();
  assert.strictEqual(reread.balanceCache.syp, 1000000, 'the rejected attempt moved nothing');
});

// --- atomicity --------------------------------------------------------------

test('a delivery whose charge fails leaves the order undelivered', async () => {
  const order = await placeOrder();
  let current = order;
  for (let i = 0; i < 3; i += 1) {
    current = await warehouseOrderService.advanceOrderStatus(
      current._id.toString(),
      ids.warehouse,
      ids.whUser
    );
  }

  // Force the charge to fail the way a real infrastructure blip would, after
  // the status has already been swapped inside the transaction.
  const orderLedger = require('../src/services/orderLedger.service');
  const original = orderLedger.postChargeForDelivery;
  orderLedger.postChargeForDelivery = async () => {
    throw new Error('simulated ledger failure');
  };

  try {
    await assert.rejects(
      () => warehouseOrderService.advanceOrderStatus(order._id.toString(), ids.warehouse, ids.whUser),
      /simulated ledger failure/
    );
  } finally {
    orderLedger.postChargeForDelivery = original;
  }

  const reread = await Order.findById(order._id).lean();
  assert.strictEqual(reread.status, 'out_for_delivery', 'the status change rolled back');
  assert.strictEqual(reread.invoiceNumber, null, 'no invoice number was consumed');
  assert.strictEqual(await LedgerEntry.countDocuments({ 'source.orderId': order._id }), 0);

  // ...and a retry after the fault clears succeeds normally.
  const delivered = await warehouseOrderService.advanceOrderStatus(
    order._id.toString(),
    ids.warehouse,
    ids.whUser
  );
  assert.strictEqual(delivered.status, 'delivered');
  assert.strictEqual(await LedgerEntry.countDocuments({ 'source.orderId': order._id }), 1);
});

// --- charge reversal --------------------------------------------------------

test('a charge can be reversed, restoring the balance and keeping both entries', async () => {
  const order = await placeOrder();
  const delivered = await deliver(order);
  const { runInTransaction } = require('../src/utils/transaction');
  const orderLedger = require('../src/services/orderLedger.service');

  await runInTransaction((session) =>
    orderLedger.reverseChargeForOrder(
      { order: delivered, userId: ids.whUser, reason: 'courier returned the shipment undelivered' },
      session
    )
  );

  const account = await accountFor();
  assert.strictEqual(account.balanceCache.syp, 0, 'the debt is undone');

  const entries = await LedgerEntry.find({ accountId: account._id }).sort({ sequence: 1 }).lean();
  assert.strictEqual(entries.length, 2, 'both the charge and its reversal remain in history');
  assert.strictEqual(entries[1].kind, 'charge_reversal');
  assert.strictEqual(entries[1].amountSyp, entries[0].amountSyp);
  assert.strictEqual(String(entries[1].reversalOf), String(entries[0]._id));

  const reread = await Order.findById(order._id).lean();
  assert.strictEqual(reread.invoiceNumber, delivered.invoiceNumber, 'the number is kept, not freed');
});

// --- balance integrity ------------------------------------------------------

test('the balance cache still equals a replay after a run of deliveries', async () => {
  for (let i = 0; i < 4; i += 1) {
    await deliver(await placeOrder());
  }

  const account = await accountFor();
  const check = await ledger.verifyAccount(account._id);
  assert.strictEqual(check.ok, true);
  assert.strictEqual(check.replay.syp, 4000000);
});
