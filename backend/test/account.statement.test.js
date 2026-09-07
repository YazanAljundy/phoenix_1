// Money-Flow V2 - the account statement and the invoice.
//
// V1 had neither. Its "debt detail" was two disconnected lists (every
// delivered order, every payment) plus three summary cards computed on a
// different basis from the rows beneath them, so after any exchange-rate move
// the cards and the list visibly disagreed. An invoice did not exist at all -
// there was no document and no number.
//
// What these tests pin down:
//   * one row per financial event, in business-date order with a running total
//   * the closing balance equals the account balance equals a ledger replay
//   * a backdated payment lands on the day the money moved
//   * a mistake and its correction both appear - nothing is airbrushed out
//   * an invoice re-renders identically after the exchange rate moves
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-statement';
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
const Return = require('../src/models/return.model');
const ExchangeRate = require('../src/models/exchangeRate.model');
const LedgerAccount = require('../src/models/ledgerAccount.model');
const LedgerEntry = require('../src/models/ledgerEntry.model');

const orderService = require('../src/services/order.service');
const warehouseOrderService = require('../src/services/warehouseOrder.service');
const paymentService = require('../src/services/payment.service');
const warehouseReturnService = require('../src/services/warehouseReturn.service');
const statementService = require('../src/services/accountStatement.service');
const statementViewModel = require('../src/viewmodels/accountStatement.viewmodel');
const invoiceViewModel = require('../src/viewmodels/invoice.viewmodel');
const orderLedger = require('../src/services/orderLedger.service');
const ledger = require('../src/services/ledger.service');

const RATE = 10000;
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
    userId: ids.phUser,
    pharmacyId: ids.pharmacy,
    warehouseId: ids.warehouse,
    items: [{ productId: ids.product.toString(), quantity }],
    notes: null,
  });
}

async function deliver(order) {
  let current = order;
  for (let i = 0; i < 4; i += 1) {
    current = await warehouseOrderService.advanceOrderStatus(
      current._id.toString(), ids.warehouse, ids.whUser
    );
  }
  return current;
}

function statement(extra = {}) {
  return statementService.getStatement({
    pharmacyId: ids.pharmacy,
    warehouseId: ids.warehouse,
    from: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
    to: new Date(Date.now() + 24 * 60 * 60 * 1000),
    ...extra,
  });
}

test.before(async () => {
  await startMemoryMongo({ dbName: 'phoenix-statement-test' });
  await syncIndexes(LedgerEntry, LedgerAccount, Order, Payment, Return);
  await setRate(RATE);

  const [phUser, whUser] = await User.create([
    { name: 'PH', phone: '0932000901', role: 'pharmacy', status: 'active' },
    { name: 'WH', phone: '0942000901', role: 'warehouse', status: 'active' },
  ]);
  ids.phUser = phUser._id;
  ids.whUser = whUser._id;

  const pharmacy = await Pharmacy.create({
    userId: phUser._id, nameAr: 'ص', nameEn: 'Pharmacy', ownerName: 'O',
    address: 'a', city: 'Latakia', phone: '0932000901', addedBy: 'self',
  });
  ids.pharmacy = pharmacy._id;

  // Rates zeroed so the statement arithmetic under test is the ledger's.
  const warehouse = await Warehouse.create({
    userId: whUser._id, nameAr: 'م', nameEn: 'Warehouse', address: 'r', city: 'Latakia',
    phone: '0942000901', deliveryType: 'self', isActive: true, discountRate: 0, commissionRate: 0,
  });
  ids.warehouse = warehouse._id;

  const product = await Product.create({
    warehouseId: warehouse._id, nameAr: 'دواء', nameEn: 'Drug', manufacturerAr: 'شركة',
    price: 100, unitAr: 'علبة', unitEn: 'box', isAvailable: true, isActive: true,
  });
  ids.product = product._id;
});

test.after(async () => {
  await stopMemoryMongo();
});

test.beforeEach(async () => {
  await setRate(RATE);
  await Promise.all([
    Order.deleteMany({}), OrderItem.deleteMany({}), Payment.deleteMany({}),
    Return.deleteMany({}), LedgerEntry.deleteMany({}), LedgerAccount.deleteMany({}),
  ]);
});

// --- shape ------------------------------------------------------------------

test('an account that has never traded is an empty statement, not a 404', async () => {
  const data = await statement();
  assert.strictEqual(data.account, null);
  assert.deepStrictEqual(data.rows, []);
  assert.strictEqual(data.closing.syp, 0);
  assert.strictEqual(data.summary.entryCount, 0);
});

test('a delivered order produces one charge row with a running balance', async () => {
  await deliver(await placeOrder());
  const data = await statement();

  assert.strictEqual(data.rows.length, 1);
  const [row] = data.rows;
  assert.strictEqual(row.kind, 'charge');
  assert.strictEqual(row.debitSyp, 1000000);
  assert.strictEqual(row.creditSyp, 0);
  assert.strictEqual(row.balanceSyp, 1000000);
  assert.ok(row.reference.invoiceNumber > 0, 'the row quotes its invoice number');
  assert.strictEqual(data.closing.syp, 1000000);
});

test('charge then payment reads as a running total', async () => {
  await deliver(await placeOrder());
  await paymentService.createPayment(ids.warehouse, ids.whUser, {
    pharmacyId: ids.pharmacy.toString(), amount: 400000, currency: 'SYP',
  });

  const data = await statement();
  assert.deepStrictEqual(
    data.rows.map((r) => [r.kind, r.debitSyp, r.creditSyp, r.balanceSyp]),
    [
      ['charge', 1000000, 0, 1000000],
      ['payment', 0, 400000, 600000],
    ]
  );
  assert.strictEqual(data.summary.chargesSyp, 1000000);
  assert.strictEqual(data.summary.paymentsSyp, 400000);
});

test('a return credit appears as its own row against the invoice it reduces', async () => {
  const delivered = await deliver(await placeOrder(2));
  const [item] = await OrderItem.find({ orderId: delivered._id });
  const returnRequest = await Return.create({
    orderId: delivered._id, pharmacyId: ids.pharmacy, warehouseId: ids.warehouse,
    items: [{ orderItemId: item._id, productId: item.productId, quantity: 1, reasonType: 'damaged' }],
  });
  await warehouseReturnService.approveReturn(returnRequest._id.toString(), ids.warehouse, ids.whUser);

  const data = await statement();
  const credit = data.rows.find((r) => r.kind === 'return_credit');
  assert.ok(credit);
  assert.strictEqual(credit.creditSyp, 1000000, 'one of two units');
  assert.strictEqual(
    credit.reference.invoiceNumber,
    delivered.invoiceNumber,
    'the credit names the invoice it reduces'
  );
  assert.strictEqual(data.closing.syp, 1000000);
  assert.strictEqual(data.summary.returnCreditsSyp, 1000000);
});

// --- ordering ---------------------------------------------------------------

test('a backdated payment lands on the day the money moved, not the day it was typed', async () => {
  await deliver(await placeOrder());
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

  // Recorded now, but for money received three days ago.
  await paymentService.createPayment(ids.warehouse, ids.whUser, {
    pharmacyId: ids.pharmacy.toString(), amount: 100000, currency: 'SYP', paidAt: threeDaysAgo,
  });
  await paymentService.createPayment(ids.warehouse, ids.whUser, {
    pharmacyId: ids.pharmacy.toString(), amount: 200000, currency: 'SYP',
  });

  const data = await statement();
  const payments = data.rows.filter((r) => r.kind === 'payment');
  assert.strictEqual(payments[0].creditSyp, 100000, 'the backdated one sorts first');
  assert.ok(payments[0].effectiveAt < payments[1].effectiveAt);
});

// --- corrections stay visible ----------------------------------------------

test('a reversed payment and its reversal both appear, and they net out', async () => {
  await deliver(await placeOrder());
  const payment = await paymentService.createPayment(ids.warehouse, ids.whUser, {
    pharmacyId: ids.pharmacy.toString(), amount: 500000, currency: 'SYP',
  });
  await paymentService.reversePayment(payment._id.toString(), ids.warehouse, ids.whUser, {
    reason: 'recorded against the wrong pharmacy',
  });

  const data = await statement();
  const kinds = data.rows.map((r) => r.kind);
  assert.deepStrictEqual(kinds, ['charge', 'payment', 'payment_reversal']);

  const reversal = data.rows[2];
  assert.strictEqual(reversal.debitSyp, 500000, 'the reversal puts the debt back');
  assert.strictEqual(reversal.reason, 'recorded against the wrong pharmacy');
  assert.ok(reversal.reversalOf, 'it names the entry it undid');

  assert.strictEqual(data.closing.syp, 1000000, 'back where it started');
  assert.strictEqual(data.summary.paymentsSyp, 0, 'the pair nets to nothing');
});

// --- consistency ------------------------------------------------------------

test('closing balance == account balance == a full ledger replay', async () => {
  await deliver(await placeOrder());
  await deliver(await placeOrder(3));
  await paymentService.createPayment(ids.warehouse, ids.whUser, {
    pharmacyId: ids.pharmacy.toString(), amount: 150000, currency: 'SYP',
  });

  const data = await statement();
  const account = await ledger.findAccount(ids.pharmacy, ids.warehouse);
  const replay = await ledger.replayAccount(account._id, { persist: false });

  assert.strictEqual(data.closing.syp, account.balanceCache.syp);
  assert.strictEqual(data.closing.syp, replay.syp);
  assert.strictEqual(data.closing.syp, 3850000, '1,000,000 + 3,000,000 - 150,000');
});

test('an exchange-rate move changes no row and no total', async () => {
  await deliver(await placeOrder());
  await paymentService.createPayment(ids.warehouse, ids.whUser, {
    pharmacyId: ids.pharmacy.toString(), amount: 400000, currency: 'SYP',
  });
  const before = await statement();

  await setRate(17500);
  const after = await statement();

  assert.deepStrictEqual(
    after.rows.map((r) => [r.kind, r.debitSyp, r.creditSyp, r.balanceSyp, r.amountUsd]),
    before.rows.map((r) => [r.kind, r.debitSyp, r.creditSyp, r.balanceSyp, r.amountUsd])
  );
  assert.deepStrictEqual(after.closing, before.closing);
});

// --- period windowing -------------------------------------------------------

test('an opening balance carries in everything before the window', async () => {
  await deliver(await placeOrder());
  const account = await ledger.findAccount(ids.pharmacy, ids.warehouse);
  // Push the charge into the past so a narrow window excludes it.
  await LedgerEntry.updateMany(
    { accountId: account._id },
    { $set: { effectiveAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) } }
  );

  const data = await statementService.getStatement({
    pharmacyId: ids.pharmacy,
    warehouseId: ids.warehouse,
    from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    to: new Date(),
  });

  assert.strictEqual(data.rows.length, 0, 'the charge is outside the window');
  assert.strictEqual(data.opening.syp, 1000000, 'but it is carried in as the opening balance');
  assert.strictEqual(data.closing.syp, 1000000);
});

// --- the pharmacy summary ---------------------------------------------------

test('the pharmacy summary reports debt, credit and net separately', async () => {
  // Owes on this warehouse.
  await deliver(await placeOrder());

  // ...and is in credit at a second one.
  const otherWhUser = await User.create({
    name: 'WH2', phone: '0942000902', role: 'warehouse', status: 'active',
  });
  const otherWarehouse = await Warehouse.create({
    userId: otherWhUser._id, nameAr: 'م2', nameEn: 'Warehouse 2', address: 'r', city: 'Latakia',
    phone: '0942000902', deliveryType: 'self', isActive: true, discountRate: 0, commissionRate: 0,
  });
  const otherAccount = await ledger.resolveAccount(ids.pharmacy, otherWarehouse._id);
  const { runInTransaction } = require('../src/utils/transaction');
  await runInTransaction((session) =>
    ledger.postEntry(
      { account: otherAccount, kind: 'manual_credit', amountSyp: 400000, reason: 'goodwill' },
      session
    )
  );

  const summary = await statementService.getPharmacyAccountsSummary(ids.pharmacy);
  assert.strictEqual(summary.totals.totalDebtSyp, 1000000);
  assert.strictEqual(summary.totals.totalCreditSyp, 400000, 'V1 dropped this entirely');
  assert.strictEqual(summary.totals.netPositionSyp, 600000);

  const response = statementViewModel.toPharmacyAccountsResponse(summary);
  assert.strictEqual(response.totalDebtSyp, 1000000);
  assert.strictEqual(response.totalCreditSyp, 400000);
  assert.strictEqual(response.accounts.length, 2);

  await LedgerAccount.deleteOne({ _id: otherAccount._id });
});

// --- the warehouse list -----------------------------------------------------

test('the warehouse account list is sourced from the ledger, newest balance first', async () => {
  await deliver(await placeOrder());
  const { rows } = await statementService.listAccountsForWarehouse(ids.warehouse, {});
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].balanceSyp, 1000000);
  assert.strictEqual(String(rows[0].pharmacyId), String(ids.pharmacy));
});

// --- the invoice ------------------------------------------------------------

test('an invoice renders the frozen order, and its line maths multiplies out', async () => {
  const delivered = await deliver(await placeOrder(2));
  const data = await orderLedger.buildInvoice(delivered);
  const { invoice } = invoiceViewModel.toInvoiceResponse(data, 'pharmacy');

  assert.strictEqual(invoice.invoiceNumber, delivered.invoiceNumber);
  assert.strictEqual(invoice.currency, 'SYP');
  assert.strictEqual(invoice.exchangeRate, RATE);

  const [line] = invoice.items;
  // V1 printed the ORIGINAL unit price beside a DISCOUNTED line total, so the
  // two never multiplied out. The headline unit price is the discounted one.
  assert.strictEqual(line.unitPriceSyp * line.quantity, line.lineTotalSyp);
  assert.strictEqual(invoice.finalAmountSyp, delivered.finalPrice);
  assert.strictEqual(invoice.netInvoiceSyp, delivered.finalPrice);
});

test('the pharmacy copy hides commission; the warehouse copy shows it and the net', async () => {
  await Warehouse.updateOne({ _id: ids.warehouse }, { commissionRate: 1 });
  const delivered = await deliver(await placeOrder());
  const data = await orderLedger.buildInvoice(delivered);

  const pharmacyCopy = invoiceViewModel.toInvoiceResponse(data, 'pharmacy').invoice;
  assert.strictEqual(pharmacyCopy.commissionSyp, undefined);
  assert.strictEqual(pharmacyCopy.warehouseNetSyp, undefined);

  const warehouseCopy = invoiceViewModel.toInvoiceResponse(data, 'warehouse').invoice;
  assert.strictEqual(warehouseCopy.commissionSyp, delivered.commissionAmount);
  assert.strictEqual(
    warehouseCopy.warehouseNetSyp,
    delivered.finalPrice - delivered.commissionAmount
  );

  await Warehouse.updateOne({ _id: ids.warehouse }, { commissionRate: 0 });
});

test('an invoice shows what has been credited back against it', async () => {
  const delivered = await deliver(await placeOrder(2));
  const [item] = await OrderItem.find({ orderId: delivered._id });
  const returnRequest = await Return.create({
    orderId: delivered._id, pharmacyId: ids.pharmacy, warehouseId: ids.warehouse,
    items: [{ orderItemId: item._id, productId: item.productId, quantity: 1, reasonType: 'damaged' }],
  });
  await warehouseReturnService.approveReturn(returnRequest._id.toString(), ids.warehouse, ids.whUser);

  const { invoice } = invoiceViewModel.toInvoiceResponse(
    await orderLedger.buildInvoice(await Order.findById(delivered._id)),
    'pharmacy'
  );
  assert.strictEqual(invoice.credits.length, 1);
  assert.strictEqual(invoice.totalCreditSyp, 1000000);
  assert.strictEqual(invoice.netInvoiceSyp, 1000000, '2,000,000 charged less 1,000,000 returned');
});

test('an invoice re-renders identically after the exchange rate moves', async () => {
  const delivered = await deliver(await placeOrder());
  const before = invoiceViewModel.toInvoiceResponse(
    await orderLedger.buildInvoice(delivered), 'pharmacy'
  ).invoice;

  await setRate(19000);

  const after = invoiceViewModel.toInvoiceResponse(
    await orderLedger.buildInvoice(await Order.findById(delivered._id)), 'pharmacy'
  ).invoice;

  assert.deepStrictEqual(after, before, 'an invoice is a historical document');
});
