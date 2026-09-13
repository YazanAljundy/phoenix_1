// Money-Flow V2 - payments are append-only.
//
// This suite replaces the V1 one, which asserted the opposite: that a warehouse
// could edit or hard-delete any payment it owned, at any age, with no trail.
// The scenarios it covered are all still here (ownership, validation,
// overpayment-becomes-credit), but the correction mechanism is now a reversal
// that keeps both the mistake and its undoing in the history.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-payment-tests-pa';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');

const { startMemoryMongo, stopMemoryMongo, syncIndexes } = require('./helpers/mongo');

const User = require('../src/models/user.model');
const Pharmacy = require('../src/models/pharmacy.model');
const Warehouse = require('../src/models/warehouse.model');
const Order = require('../src/models/order.model');
const Payment = require('../src/models/payment.model');
const ExchangeRate = require('../src/models/exchangeRate.model');
const LedgerAccount = require('../src/models/ledgerAccount.model');
const LedgerEntry = require('../src/models/ledgerEntry.model');
const FinancialAuditLog = require('../src/models/financialAuditLog.model');

const paymentService = require('../src/services/payment.service');
const paymentViewModel = require('../src/viewmodels/payment.viewmodel');
const ledger = require('../src/services/ledger.service');
const { runInTransaction } = require('../src/utils/transaction');

function withCode(expected) {
  return (err) => {
    assert.strictEqual(err.code, expected, `expected error code ${expected}, got ${err.code}`);
    return true;
  };
}

const ids = {};
let orderSeq = 90000;

function pay(overrides = {}) {
  return paymentService.createPayment(ids.warehouse, ids.whUser, {
    pharmacyId: ids.pharmacy.toString(),
    amount: 100000,
    currency: 'SYP',
    ...overrides,
  });
}

async function accountFor(pharmacyId = ids.pharmacy) {
  return ledger.findAccount(pharmacyId, ids.warehouse);
}

// A delivered order + its charge, i.e. the trading relationship a payment now
// requires. Posted through the ledger directly so this suite stays focused on
// payments rather than re-testing the delivery path.
async function giveTradingRelationship(pharmacyId, chargeSyp) {
  const order = await Order.create({
    orderNumber: (orderSeq += 1),
    pharmacyId,
    warehouseId: ids.warehouse,
    status: 'delivered',
    totalPrice: chargeSyp,
    discountAmount: 0,
    commissionAmount: 0,
    finalPrice: chargeSyp,
    finalAmountUsd: chargeSyp / 10000,
    fx: { rate: 10000, source: 'manual', rateAsOf: new Date() },
    statusHistory: [{ status: 'delivered', changedBy: ids.whUser, changedAt: new Date() }],
  });

  const account = await ledger.resolveAccount(pharmacyId, ids.warehouse);
  await runInTransaction((session) =>
    ledger.postEntry(
      {
        account,
        kind: 'charge',
        amountSyp: chargeSyp,
        amountUsd: chargeSyp / 10000,
        fx: order.fx,
        source: { orderId: order._id },
      },
      session
    )
  );
  return order;
}

test.before(async () => {
  await startMemoryMongo({ dbName: 'feniq-payment-test' });
  await syncIndexes(Payment, LedgerEntry, LedgerAccount);

  await ExchangeRate.create({ _id: 'singleton', usdToSyp: 10000, source: 'manual' });

  const [whUser, otherWhUser] = await User.create([
    { name: 'WH', phone: '0942000101', role: 'warehouse', status: 'active' },
    { name: 'WH2', phone: '0942000102', role: 'warehouse', status: 'active' },
  ]);
  ids.whUser = whUser._id;

  const [pharmacyUser, strangerUser] = await User.create([
    { name: 'Ph', phone: '0932000101', role: 'pharmacy', status: 'active' },
    { name: 'Ph2', phone: '0932000109', role: 'pharmacy', status: 'active' },
  ]);

  const [pharmacy, stranger] = await Pharmacy.create([
    {
      userId: pharmacyUser._id, nameAr: 'ص', nameEn: 'Pharmacy', ownerName: 'O',
      address: 'a', city: 'Latakia', areaType: 'city', phone: '0932000101', addedBy: 'self',
    },
    {
      userId: strangerUser._id, nameAr: 'ص2', nameEn: 'Stranger', ownerName: 'O',
      address: 'a', city: 'Latakia', areaType: 'city', phone: '0932000109', addedBy: 'self',
    },
  ]);
  ids.pharmacy = pharmacy._id;
  ids.stranger = stranger._id;

  const [warehouse, otherWarehouse] = await Warehouse.create([
    {
      userId: whUser._id, nameAr: 'م', nameEn: 'Warehouse', address: 'r', city: 'Latakia',
      phone: '0942000101', deliveryType: 'self', isActive: true,
    },
    {
      userId: otherWhUser._id, nameAr: 'م2', nameEn: 'Warehouse 2', address: 'r', city: 'Latakia',
      phone: '0942000102', deliveryType: 'self', isActive: true,
    },
  ]);
  ids.warehouse = warehouse._id;
  ids.otherWarehouse = otherWarehouse._id;
});

test.after(async () => {
  await stopMemoryMongo();
});

test.beforeEach(async () => {
  await Promise.all([
    Payment.deleteMany({}),
    Order.deleteMany({}),
    LedgerEntry.deleteMany({}),
    LedgerAccount.deleteMany({}),
    FinancialAuditLog.deleteMany({}),
  ]);
  // The pharmacy owes 100,000 SYP (10 USD) at the start of every test.
  await giveTradingRelationship(ids.pharmacy, 100000);
});

// --- recording --------------------------------------------------------------

test('a recorded payment posts one ledger entry and moves the balance', async () => {
  const payment = await pay({ amount: 40000 });

  assert.strictEqual(payment.kind, 'settlement');
  assert.strictEqual(payment.status, 'posted');
  assert.ok(payment.paymentNumber > 0);
  assert.ok(payment.ledgerEntryId, 'the payment links to its ledger entry');

  const entry = await LedgerEntry.findById(payment.ledgerEntryId).lean();
  assert.strictEqual(entry.kind, 'payment');
  assert.strictEqual(entry.direction, 'credit');
  assert.strictEqual(entry.amountSyp, 40000);

  const account = await accountFor();
  assert.strictEqual(account.balanceCache.syp, 60000, '100,000 owed - 40,000 paid');
});

test('the serialized shape carries the lifecycle, not an edit window', async () => {
  const payment = await pay({ amount: 5, currency: 'USD' });
  const serialized = paymentViewModel.serializePayment(payment);

  assert.ok(!('canEdit' in serialized), 'no canEdit flag - there is no edit');
  assert.ok(!('canEditUntil' in serialized));
  assert.strictEqual(serialized.kind, 'settlement');
  assert.strictEqual(serialized.status, 'posted');
  assert.strictEqual(serialized.amountUsd, 5);
  assert.strictEqual(serialized.amountSyp, 50000);
  assert.strictEqual(serialized.exchangeRate, 10000);
});

test('a payment records its method, reference and real payment date', async () => {
  const paidAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const payment = await pay({
    amount: 25000,
    method: 'bank_transfer',
    reference: 'TRX-99887',
    paidAt,
  });

  assert.strictEqual(payment.method, 'bank_transfer');
  assert.strictEqual(payment.reference, 'TRX-99887');
  assert.strictEqual(payment.paidAt.getTime(), paidAt.getTime());

  // The ledger entry lands on the date the money moved, not the date it was typed.
  const entry = await LedgerEntry.findById(payment.ledgerEntryId).lean();
  assert.strictEqual(entry.effectiveAt.getTime(), paidAt.getTime());
});

test('validation still rejects a non-positive amount and an unknown currency', async () => {
  await assert.rejects(() => pay({ amount: 0 }), withCode('INVALID_PAYMENT_AMOUNT'));
  await assert.rejects(() => pay({ amount: -5 }), withCode('INVALID_PAYMENT_AMOUNT'));
  await assert.rejects(() => pay({ amount: 5, currency: 'EUR' }), withCode('INVALID_PAYMENT_CURRENCY'));
  await assert.rejects(() => pay({ method: 'crypto' }), withCode('INVALID_PAYMENT_METHOD'));
});

test('a payment cannot be dated in the future', async () => {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await assert.rejects(() => pay({ paidAt: tomorrow }), withCode('PAYMENT_DATE_IN_FUTURE'));
});

test('a payment recorded without an explicit currency defaults to SYP', async () => {
  const payment = await pay({ amount: 50000, currency: undefined });
  assert.strictEqual(payment.currency, 'SYP');
  assert.strictEqual(payment.amountSyp, 50000);
});

test('overpayment is still accepted and becomes a credit balance', async () => {
  await pay({ amount: 250000 }); // owes 100,000
  const account = await accountFor();
  assert.strictEqual(account.balanceCache.syp, -150000, 'paid ahead => negative == credit');
});

// --- the trading-relationship gate -----------------------------------------

test('a payment against a pharmacy with no delivered orders is refused', async () => {
  await assert.rejects(
    () => pay({ pharmacyId: ids.stranger.toString() }),
    withCode('NO_TRADING_RELATIONSHIP')
  );
});

test('the unlinked override is allowed but demands a reason and is audited', async () => {
  await assert.rejects(
    () => pay({ pharmacyId: ids.stranger.toString(), allowUnlinked: true }),
    withCode('UNLINKED_PAYMENT_REASON_REQUIRED')
  );

  const payment = await pay({
    pharmacyId: ids.stranger.toString(),
    allowUnlinked: true,
    unlinkedReason: 'advance deposit before the first order',
  });
  assert.ok(payment._id);

  const [audit] = await FinancialAuditLog.find({ entityId: payment._id }).lean();
  assert.strictEqual(audit.action, 'payment.recorded');
  assert.strictEqual(audit.reason, 'advance deposit before the first order');
  assert.strictEqual(audit.after.unlinked, true);
});

// --- immutability -----------------------------------------------------------

test('the service exposes no edit and no delete', () => {
  assert.strictEqual(paymentService.updatePayment, undefined, 'updatePayment is gone');
  assert.strictEqual(paymentService.deletePayment, undefined, 'deletePayment is gone');
  assert.strictEqual(typeof paymentService.reversePayment, 'function');
});

// --- reversal ---------------------------------------------------------------

test('reversing a payment restores the balance and keeps both rows', async () => {
  const payment = await pay({ amount: 40000 });
  assert.strictEqual((await accountFor()).balanceCache.syp, 60000);

  const reversal = await paymentService.reversePayment(
    payment._id.toString(),
    ids.warehouse,
    ids.whUser,
    { reason: 'recorded against the wrong pharmacy' }
  );

  assert.strictEqual(reversal.kind, 'reversal');
  assert.strictEqual(String(reversal.reversesPaymentId), String(payment._id));
  assert.strictEqual(reversal.amountSyp, 40000, 'same magnitude, never negative');

  const original = await Payment.findById(payment._id).lean();
  assert.strictEqual(original.status, 'reversed');
  assert.strictEqual(String(original.reversedByPaymentId), String(reversal._id));
  assert.strictEqual(original.reversalReason, 'recorded against the wrong pharmacy');

  assert.strictEqual(await Payment.countDocuments(), 2, 'nothing was deleted');
  assert.strictEqual((await accountFor()).balanceCache.syp, 100000, 'debt back to the full amount');
});

test('a reversal requires a reason', async () => {
  const payment = await pay({ amount: 10000 });
  await assert.rejects(
    () =>
      paymentService.reversePayment(payment._id.toString(), ids.warehouse, ids.whUser, {
        reason: '  ',
      }),
    withCode('REASON_REQUIRED')
  );
  assert.strictEqual((await Payment.findById(payment._id)).status, 'posted');
});

test('a payment can be reversed only once', async () => {
  const payment = await pay({ amount: 10000 });
  await paymentService.reversePayment(payment._id.toString(), ids.warehouse, ids.whUser, {
    reason: 'duplicate entry',
  });

  await assert.rejects(
    () =>
      paymentService.reversePayment(payment._id.toString(), ids.warehouse, ids.whUser, {
        reason: 'again',
      }),
    withCode('PAYMENT_ALREADY_REVERSED')
  );
});

test('a reversal cannot itself be reversed', async () => {
  const payment = await pay({ amount: 10000 });
  const reversal = await paymentService.reversePayment(
    payment._id.toString(),
    ids.warehouse,
    ids.whUser,
    { reason: 'wrong amount' }
  );

  await assert.rejects(
    () =>
      paymentService.reversePayment(reversal._id.toString(), ids.warehouse, ids.whUser, {
        reason: 'undo the undo',
      }),
    withCode('CANNOT_REVERSE_A_REVERSAL')
  );
});

test('reversing copies the ORIGINAL rate, so reverse-and-re-record is FX-neutral', async () => {
  const payment = await pay({ amount: 5, currency: 'USD' }); // 50,000 SYP at 10,000
  assert.strictEqual(payment.amountSyp, 50000);

  // The lira moves before anyone notices the mistake.
  await ExchangeRate.findByIdAndUpdate('singleton', { usdToSyp: 15000 });

  const reversal = await paymentService.reversePayment(
    payment._id.toString(),
    ids.warehouse,
    ids.whUser,
    { reason: 'wrong pharmacy' }
  );

  assert.strictEqual(reversal.fx.rate, 10000, 'the reversal uses the original rate');
  assert.strictEqual(reversal.amountSyp, 50000);
  assert.strictEqual(
    (await accountFor()).balanceCache.syp,
    100000,
    'the balance is exactly back where it started'
  );

  await ExchangeRate.findByIdAndUpdate('singleton', { usdToSyp: 10000 });
});

test('the correction flow is reverse-then-re-record, and both are visible', async () => {
  const wrong = await pay({ amount: 500000, note: 'typo' });
  await paymentService.reversePayment(wrong._id.toString(), ids.warehouse, ids.whUser, {
    reason: 'typo: should have been 50,000',
  });
  const corrected = await pay({ amount: 50000, note: 'corrected' });

  const account = await accountFor();
  assert.strictEqual(account.balanceCache.syp, 50000, '100,000 owed - 50,000 actually paid');

  const rows = await paymentService.listPaymentsForAccount(account._id);
  assert.strictEqual(rows.length, 3, 'the mistake, the reversal and the correction all survive');
  assert.strictEqual(String(corrected._id), String(rows[0]._id));
});

test('reversal writes an audit record with the reason', async () => {
  const payment = await pay({ amount: 10000 });
  await paymentService.reversePayment(payment._id.toString(), ids.warehouse, ids.whUser, {
    reason: 'cheque bounced',
  });

  const audit = await FinancialAuditLog.findOne({ action: 'payment.reversed' }).lean();
  assert.strictEqual(String(audit.entityId), String(payment._id));
  assert.strictEqual(audit.reason, 'cheque bounced');
  assert.strictEqual(audit.before.status, 'posted');
  assert.strictEqual(audit.after.status, 'reversed');
});

// --- ownership (unchanged from V1) -----------------------------------------

test('a warehouse cannot reverse another warehouse payment (IDOR unchanged)', async () => {
  const payment = await pay({ amount: 5000 });
  await assert.rejects(
    () =>
      paymentService.reversePayment(payment._id.toString(), ids.otherWarehouse, ids.whUser, {
        reason: 'not mine to touch',
      }),
    withCode('PAYMENT_NOT_FOUND')
  );
  assert.strictEqual((await Payment.findById(payment._id)).status, 'posted');
});

// --- idempotency ------------------------------------------------------------

test('the same idempotency key records one payment, not two', async () => {
  const key = 'pay-key-' + new mongoose.Types.ObjectId().toString();
  const first = await pay({ amount: 30000, idempotencyKey: key });
  const second = await pay({ amount: 30000, idempotencyKey: key });

  assert.strictEqual(String(first._id), String(second._id));
  assert.strictEqual(second.$locals.idempotentReplay, true);
  assert.strictEqual(await Payment.countDocuments(), 1);
  assert.strictEqual((await accountFor()).balanceCache.syp, 70000, 'credited once');
});

test('two concurrent submissions with the same key credit the pharmacy once', async () => {
  const key = 'pay-race-' + new mongoose.Types.ObjectId().toString();
  const submit = () => pay({ amount: 30000, idempotencyKey: key });

  const [a, b] = await Promise.all([submit(), submit()]);

  assert.strictEqual(String(a._id), String(b._id));
  assert.strictEqual(await Payment.countDocuments(), 1);
  assert.strictEqual((await accountFor()).balanceCache.syp, 70000);
});

test('two concurrent reversals of the same payment produce one reversal', async () => {
  const payment = await pay({ amount: 30000 });
  const attempt = () =>
    paymentService
      .reversePayment(payment._id.toString(), ids.warehouse, ids.whUser, { reason: 'duplicate' })
      .then(() => 'ok')
      .catch((err) => err.code);

  const results = await Promise.all([attempt(), attempt()]);

  assert.strictEqual(results.filter((r) => r === 'ok').length, 1);
  assert.strictEqual(await Payment.countDocuments({ kind: 'reversal' }), 1);
  assert.strictEqual((await accountFor()).balanceCache.syp, 100000);
});

// --- integrity --------------------------------------------------------------

test('the balance cache still equals a replay after a run of payments and reversals', async () => {
  const a = await pay({ amount: 10000 });
  await pay({ amount: 20000 });
  await paymentService.reversePayment(a._id.toString(), ids.warehouse, ids.whUser, {
    reason: 'never received',
  });
  await pay({ amount: 5, currency: 'USD' });

  const account = await accountFor();
  const check = await ledger.verifyAccount(account._id);
  assert.strictEqual(check.ok, true);
  // 100,000 - 10,000 - 20,000 + 10,000 - 50,000
  assert.strictEqual(check.replay.syp, 30000);
});
