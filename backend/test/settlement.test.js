// Money-Flow V2 - the warehouse settlement report.
//
// V1 computed `commissionAmount` on every order and then read it nowhere. This
// gives it a reader: what the platform is owed for a period, and what the
// warehouse actually keeps once that comes off - including a pro-rata clawback
// so a warehouse is not charged commission on money it never collected because
// the goods came back.
//
// It is a REPORT over frozen order fields, not a second ledger: nothing here
// posts an entry or moves a balance.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-settlement-paddi';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');

const { startMemoryMongo, stopMemoryMongo, syncIndexes } = require('./helpers/mongo');

const User = require('../src/models/user.model');
const Pharmacy = require('../src/models/pharmacy.model');
const Warehouse = require('../src/models/warehouse.model');
const Order = require('../src/models/order.model');
const OrderItem = require('../src/models/orderItem.model');
const Return = require('../src/models/return.model');
const ExchangeRate = require('../src/models/exchangeRate.model');
const LedgerAccount = require('../src/models/ledgerAccount.model');
const LedgerEntry = require('../src/models/ledgerEntry.model');

const ledger = require('../src/services/ledger.service');
const settlementService = require('../src/services/settlement.service');
const warehouseReturnService = require('../src/services/warehouseReturn.service');
const { runInTransaction } = require('../src/utils/transaction');

const RATE = 10000;
const ids = {};
let orderSeq = 97000;

// A delivered order with its charge posted, priced through the real roll-up
// rule: discount on the package/subtotal base, commission on finalPrice.
async function deliveredOrder({ subtotalSyp, discountRate = 4, commissionRate = 1, deliveredAt = new Date() }) {
  const discountAmount = Math.round((subtotalSyp * discountRate) / 100);
  const finalPrice = subtotalSyp - discountAmount;
  const commissionAmount = Math.round((finalPrice * commissionRate) / 100);

  const order = await Order.create({
    orderNumber: (orderSeq += 1),
    pharmacyId: ids.pharmacy,
    warehouseId: ids.warehouse,
    status: 'delivered',
    totalPrice: subtotalSyp,
    discountAmount,
    advertisementDiscountAmount: 0,
    commissionAmount,
    finalPrice,
    finalAmountUsd: Math.round((finalPrice / RATE) * 100) / 100,
    fx: { rate: RATE, source: 'manual', rateAsOf: new Date() },
    invoiceNumber: orderSeq,
    deliveredAt,
    statusHistory: [{ status: 'delivered', changedBy: ids.whUser, changedAt: deliveredAt }],
  });

  const item = await OrderItem.create({
    orderId: order._id,
    productId: new mongoose.Types.ObjectId(),
    productNameAr: 'دواء',
    productNameEn: 'Drug',
    manufacturerAr: 'شركة',
    quantity: 1,
    unitPrice: subtotalSyp,
    discountPrice: subtotalSyp,
    savingsUsd: 0,
    savingsSyp: 0,
  });

  const account = await ledger.resolveAccount(ids.pharmacy, ids.warehouse);
  await runInTransaction((session) =>
    ledger.postEntry(
      {
        account,
        kind: 'charge',
        amountSyp: finalPrice,
        amountUsd: order.finalAmountUsd,
        fx: order.fx,
        effectiveAt: deliveredAt,
        source: { orderId: order._id },
      },
      session
    )
  );

  return { order, item };
}

async function creditFully(order, item) {
  const returnRequest = await Return.create({
    orderId: order._id,
    pharmacyId: ids.pharmacy,
    warehouseId: ids.warehouse,
    items: [{ orderItemId: item._id, productId: item.productId, quantity: item.quantity, reasonType: 'damaged' }],
  });
  return warehouseReturnService.approveReturn(returnRequest._id.toString(), ids.warehouse, ids.whUser);
}

test.before(async () => {
  await startMemoryMongo({ dbName: 'feniq-settlement-test' });
  await syncIndexes(LedgerEntry, LedgerAccount, Return, Order);
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
    address: 'a', city: 'Latakia', phone: '0932000801', addedBy: 'self',
  });
  ids.pharmacy = pharmacy._id;
});

test.after(async () => {
  await stopMemoryMongo();
});

test.beforeEach(async () => {
  await Promise.all([
    Order.deleteMany({}),
    OrderItem.deleteMany({}),
    Return.deleteMany({}),
    LedgerEntry.deleteMany({}),
    LedgerAccount.deleteMany({}),
  ]);
});

test('an empty period reports zeroes rather than nothing', async () => {
  const report = await settlementService.getSettlementForWarehouse(ids.warehouse, {});
  assert.strictEqual(report.totals.orderCount, 0);
  assert.strictEqual(report.totals.grossSalesSyp, 0);
  assert.strictEqual(report.totals.netCommissionSyp, 0);
  assert.deepStrictEqual(report.rows, []);
});

test('a delivered order contributes its sales, commission and net', async () => {
  // 400,000 subtotal, 4% discount -> 384,000 paid, 1% commission -> 3,840.
  await deliveredOrder({ subtotalSyp: 400000 });

  const report = await settlementService.getSettlementForWarehouse(ids.warehouse, {});
  assert.strictEqual(report.totals.orderCount, 1);
  assert.strictEqual(report.totals.grossSalesSyp, 384000);
  assert.strictEqual(report.totals.grossCommissionSyp, 3840);
  assert.strictEqual(report.totals.warehouseNetSyp, 380160);

  const [row] = report.rows;
  assert.strictEqual(row.salesSyp, 384000);
  assert.strictEqual(row.commissionSyp, 3840);
  assert.strictEqual(row.warehouseNetSyp, 380160);
});

test('several orders sum', async () => {
  await deliveredOrder({ subtotalSyp: 400000 });
  await deliveredOrder({ subtotalSyp: 100000 });

  const report = await settlementService.getSettlementForWarehouse(ids.warehouse, {});
  assert.strictEqual(report.totals.orderCount, 2);
  assert.strictEqual(report.totals.grossSalesSyp, 384000 + 96000);
  assert.strictEqual(report.totals.grossCommissionSyp, 3840 + 960);
  assert.strictEqual(report.totals.warehouseNetSyp, 380160 + 95040);
});

test('a fully credited return claws back its whole commission', async () => {
  const { order, item } = await deliveredOrder({ subtotalSyp: 400000 });
  await creditFully(order, item);

  const report = await settlementService.getSettlementForWarehouse(ids.warehouse, {});
  assert.strictEqual(report.totals.grossSalesSyp, 384000);
  assert.strictEqual(report.totals.creditedSalesSyp, 384000);
  assert.strictEqual(report.totals.netSalesSyp, 0);
  assert.strictEqual(report.totals.grossCommissionSyp, 3840);
  assert.strictEqual(
    report.totals.commissionClawbackSyp,
    3840,
    'no commission is owed on money that came straight back'
  );
  assert.strictEqual(report.totals.netCommissionSyp, 0);
  assert.strictEqual(report.totals.warehouseNetSyp, 0);
});

test('a partial credit claws back commission pro rata', async () => {
  const { order } = await deliveredOrder({ subtotalSyp: 400000 }); // 384,000 paid, 3,840 commission

  // Half the order credited back, posted directly so the proportion is exact.
  const account = await ledger.resolveAccount(ids.pharmacy, ids.warehouse);
  const returnRequest = await Return.create({
    orderId: order._id, pharmacyId: ids.pharmacy, warehouseId: ids.warehouse,
    items: [{ orderItemId: new mongoose.Types.ObjectId(), productId: new mongoose.Types.ObjectId(), quantity: 1, reasonType: 'damaged' }],
    status: 'approved',
  });
  await runInTransaction((session) =>
    ledger.postEntry(
      {
        account, kind: 'return_credit', amountSyp: 192000, amountUsd: 19.2,
        fx: { rate: RATE, source: 'order', rateAsOf: null },
        source: { returnId: returnRequest._id },
        metadata: { orderId: order._id },
      },
      session
    )
  );

  const report = await settlementService.getSettlementForWarehouse(ids.warehouse, {});
  assert.strictEqual(report.totals.creditedSalesSyp, 192000);
  assert.strictEqual(report.totals.netSalesSyp, 192000);
  assert.strictEqual(report.totals.commissionClawbackSyp, 1920, 'half the commission');
  assert.strictEqual(report.totals.netCommissionSyp, 1920);
  assert.strictEqual(report.totals.warehouseNetSyp, 190080);
});

test('the clawback can never exceed the commission that was charged', () => {
  const order = { finalPrice: 100000, commissionAmount: 1000 };
  // A credit larger than the order (which the valuation clamps against anyway)
  // must not produce a clawback bigger than what was charged.
  assert.strictEqual(settlementService.commissionClawbackFor(order, 500000), 1000);
  assert.strictEqual(settlementService.commissionClawbackFor(order, 0), 0);
  assert.strictEqual(settlementService.commissionClawbackFor({ finalPrice: 0, commissionAmount: 0 }, 10), 0);
});

test('the period is cut by delivery date, not order date', async () => {
  const lastMonth = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
  await deliveredOrder({ subtotalSyp: 100000, deliveredAt: lastMonth });
  await deliveredOrder({ subtotalSyp: 400000 });

  // Default period is the current calendar month.
  const thisMonth = await settlementService.getSettlementForWarehouse(ids.warehouse, {});
  assert.strictEqual(thisMonth.totals.orderCount, 1);
  assert.strictEqual(thisMonth.totals.grossSalesSyp, 384000);

  // Widen it and both appear.
  const wide = await settlementService.getSettlementForWarehouse(ids.warehouse, {
    from: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
    to: new Date(),
  });
  assert.strictEqual(wide.totals.orderCount, 2);
});

test('a pending order is not in the settlement at all', async () => {
  await Order.create({
    orderNumber: (orderSeq += 1),
    pharmacyId: ids.pharmacy, warehouseId: ids.warehouse, status: 'pending',
    totalPrice: 999999, discountAmount: 0, commissionAmount: 9999, finalPrice: 999999,
    statusHistory: [],
  });

  const report = await settlementService.getSettlementForWarehouse(ids.warehouse, {});
  assert.strictEqual(report.totals.orderCount, 0, 'nothing is owed until it is delivered');
});

test('an invalid date range falls back to the current month rather than throwing', async () => {
  await deliveredOrder({ subtotalSyp: 400000 });
  const report = await settlementService.getSettlementForWarehouse(ids.warehouse, {
    from: 'not-a-date',
  });
  assert.strictEqual(report.totals.orderCount, 1);
});
