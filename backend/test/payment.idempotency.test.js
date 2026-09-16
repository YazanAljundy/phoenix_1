// Payment idempotency is keyed on the request's contents, not the key alone.
//
// The web panel used to mint a fresh key inside every submit, so a retry after
// a lost response arrived under a NEW key and recorded the payment a second
// time. The panel now keeps one key per payment it is recording (see
// web/src/utils/payments.js); this suite pins the server half of that
// contract:
//
//   - the same key with the same payment is a retry and replays;
//   - the same key with a different payment, a different kind of operation,
//     or from another warehouse is refused with IDEMPOTENCY_KEY_REUSED;
//   - a new key is a new payment, whatever it contains.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-payment-idempotency';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const { startMemoryMongo, stopMemoryMongo, syncIndexes } = require('./helpers/mongo');

const app = require('../src/app');
const env = require('../src/config/env');

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
const ledger = require('../src/services/ledger.service');
const { runInTransaction } = require('../src/utils/transaction');
const { requestFingerprint } = require('../src/utils/idempotency');

const ids = {};
let warehouseToken;
let server;
let baseUrl;
let orderSeq = 95000;

function newKey(label) {
  return `${label}-${new mongoose.Types.ObjectId().toString()}`;
}

function pay(overrides = {}, warehouseId = ids.warehouse) {
  return paymentService.createPayment(warehouseId, ids.whUser, {
    pharmacyId: ids.pharmacy.toString(),
    amount: 30000,
    currency: 'SYP',
    method: 'cash',
    ...overrides,
  });
}

function reverse(paymentId, { reason = 'entered twice', idempotencyKey } = {}) {
  return paymentService.reversePayment(String(paymentId), ids.warehouse, ids.whUser, {
    reason,
    idempotencyKey,
  });
}

// Refused with IDEMPOTENCY_KEY_REUSED. `existing` is the payment the key
// already recorded, whose id the refusal names - or null when the caller must
// not learn anything about it.
function isKeyReused(existing) {
  return (err) => {
    assert.strictEqual(err.code, 'IDEMPOTENCY_KEY_REUSED');
    assert.strictEqual(err.statusCode, 409);
    if (existing) {
      assert.deepStrictEqual(err.details, {
        paymentId: String(existing._id),
        paymentNumber: existing.paymentNumber,
      });
    } else {
      assert.strictEqual(err.details, undefined, 'nothing about another warehouse leaks');
    }
    return true;
  };
}

async function balanceSyp() {
  return (await ledger.findAccount(ids.pharmacy, ids.warehouse)).balanceCache.syp;
}

async function call(method, path, body) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${warehouseToken}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
}

// The delivered order + charge a payment needs before it may be recorded.
async function giveTradingRelationship(pharmacyId, warehouseId, chargeSyp) {
  const order = await Order.create({
    orderNumber: (orderSeq += 1),
    pharmacyId,
    warehouseId,
    status: 'delivered',
    totalPrice: chargeSyp,
    discountAmount: 0,
    commissionAmount: 0,
    finalPrice: chargeSyp,
    finalAmountUsd: chargeSyp / 10000,
    fx: { rate: 10000, source: 'manual', rateAsOf: new Date() },
    statusHistory: [{ status: 'delivered', changedBy: ids.whUser, changedAt: new Date() }],
  });
  const account = await ledger.resolveAccount(pharmacyId, warehouseId);
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
}

test.before(async () => {
  await startMemoryMongo({ dbName: 'feniq-payment-idempotency-test' });
  // The unique idempotencyKey index is what the race test leans on, and every
  // payment is a transactional write.
  await syncIndexes(Payment, LedgerEntry, LedgerAccount);
  await ExchangeRate.create({ _id: 'singleton', usdToSyp: 10000, source: 'manual' });

  const [whUser, otherWhUser, pharmacyUser, otherPharmacyUser] = await User.create([
    { name: 'WH', phone: '0942000301', role: 'warehouse', status: 'active' },
    { name: 'WH2', phone: '0942000302', role: 'warehouse', status: 'active' },
    { name: 'Ph', phone: '0932000301', role: 'pharmacy', status: 'active' },
    { name: 'Ph2', phone: '0932000302', role: 'pharmacy', status: 'active' },
  ]);
  ids.whUser = whUser._id;
  warehouseToken = jwt.sign({ sub: String(whUser._id) }, env.jwtSecret, { expiresIn: '1h' });

  const [pharmacy, otherPharmacy] = await Pharmacy.create([
    {
      userId: pharmacyUser._id, nameAr: 'ص', nameEn: 'Pharmacy', ownerName: 'O',
      address: 'a', city: 'Latakia', areaType: 'city', phone: '0932000301', addedBy: 'self',
    },
    {
      userId: otherPharmacyUser._id, nameAr: 'ص2', nameEn: 'Pharmacy 2', ownerName: 'O',
      address: 'a', city: 'Latakia', areaType: 'city', phone: '0932000302', addedBy: 'self',
    },
  ]);
  ids.pharmacy = pharmacy._id;
  ids.otherPharmacy = otherPharmacy._id;

  const [warehouse, otherWarehouse] = await Warehouse.create([
    {
      userId: whUser._id, nameAr: 'م', nameEn: 'Warehouse', address: 'r', city: 'Latakia',
      phone: '0942000301', deliveryType: 'self', isActive: true,
    },
    {
      userId: otherWhUser._id, nameAr: 'م2', nameEn: 'Warehouse 2', address: 'r', city: 'Latakia',
      phone: '0942000302', deliveryType: 'self', isActive: true,
    },
  ]);
  ids.warehouse = warehouse._id;
  ids.otherWarehouse = otherWarehouse._id;

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
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
  // Every test starts with the pharmacy owing this warehouse 100,000 SYP.
  await giveTradingRelationship(ids.pharmacy, ids.warehouse, 100000);
});

// --- the shared helper ------------------------------------------------------

test('requestFingerprint: deterministic, scoped, and shaped like the order fingerprint', () => {
  const payload = { a: 1, b: ['x', null] };
  assert.strictEqual(requestFingerprint('payment-v1', payload), requestFingerprint('payment-v1', payload));
  assert.match(requestFingerprint('payment-v1', payload), /^[0-9a-f]{64}$/);
  assert.notStrictEqual(
    requestFingerprint('payment-v1', payload),
    requestFingerprint('payment-reversal-v1', payload),
    'the scope separates operations'
  );
  // order.service.js hashes `order-v1:<json>`; this is the same construction.
  const crypto = require('crypto');
  const expected = crypto
    .createHash('sha256')
    .update(`order-v1:${JSON.stringify(payload)}`)
    .digest('hex');
  assert.strictEqual(requestFingerprint('order-v1', payload), expected);
});

// --- recording a payment ----------------------------------------------------

test('a retry after a network failure records the payment once (idempotent)', async () => {
  const key = newKey('retry');
  // Attempt 1 was recorded, but its response never reached the panel.
  const first = await pay({ idempotencyKey: key, reference: 'TX-1', note: 'counter' });
  // The operator submits the same payment again, under the same key.
  const retry = await pay({ idempotencyKey: key, reference: 'TX-1', note: 'counter' });

  assert.strictEqual(String(retry._id), String(first._id));
  assert.strictEqual(retry.$locals.idempotentReplay, true);
  assert.strictEqual(first.$locals.idempotentReplay, undefined, 'the first one was really recorded');
  assert.strictEqual(await Payment.countDocuments(), 1);
  assert.strictEqual(await balanceSyp(), 70000, 'credited once');

  const stored = await Payment.findById(first._id).lean();
  assert.match(stored.idempotencyFingerprint, /^[0-9a-f]{64}$/);
});

test('the same payment spelled differently is still the same retry', async () => {
  const key = newKey('spelling');
  const first = await pay({ idempotencyKey: key, reference: 'TX-1', note: 'counter' });

  const retry = await paymentService.createPayment(ids.warehouse, ids.whUser, {
    pharmacyId: ids.pharmacy.toString(),
    // Defaults the server would apply anyway, whitespace it would trim, and
    // sub-cent noise in the amount.
    amount: 30000.001,
    reference: '  TX-1 ',
    note: 'counter   ',
    idempotencyKey: key,
  });

  assert.strictEqual(String(retry._id), String(first._id));
  assert.strictEqual(await Payment.countDocuments(), 1);
});

test('the same key with any different payment detail is refused, and nothing is recorded', async () => {
  const key = newKey('reused');
  const first = await pay({ idempotencyKey: key, reference: 'TX-1', note: 'counter' });

  const changes = {
    'a different amount': { amount: 40000 },
    'another currency': { currency: 'USD', amount: 3 },
    'another method': { method: 'bank_transfer' },
    'another reference': { reference: 'TX-2' },
    'another note': { note: 'front desk' },
    'another pharmacy': { pharmacyId: ids.otherPharmacy.toString() },
    'a payment date': { paidAt: new Date(Date.now() - 86400000).toISOString() },
    'the unlinked override': { allowUnlinked: true, unlinkedReason: 'agreed by phone' },
  };
  for (const [label, change] of Object.entries(changes)) {
    await assert.rejects(
      pay({ idempotencyKey: key, reference: 'TX-1', note: 'counter', ...change }),
      isKeyReused(first),
      label
    );
  }

  assert.strictEqual(await Payment.countDocuments(), 1, 'no second payment');
  assert.strictEqual(await balanceSyp(), 70000, 'the balance moved once');
});

test('changed details under a new key are a separate payment, and are accepted', async () => {
  const first = await pay({ idempotencyKey: newKey('first'), amount: 30000 });
  const second = await pay({ idempotencyKey: newKey('second'), amount: 20000 });

  assert.notStrictEqual(String(second._id), String(first._id));
  assert.strictEqual(second.$locals.idempotentReplay, undefined);
  assert.strictEqual(await Payment.countDocuments(), 2);
  assert.strictEqual(await balanceSyp(), 50000);
});

test('another warehouse cannot replay, or learn about, a payment through its key', async () => {
  await giveTradingRelationship(ids.pharmacy, ids.otherWarehouse, 100000);
  const key = newKey('foreign');
  await pay({ idempotencyKey: key });

  // Identical details, other warehouse: before this change it was handed the
  // first warehouse's payment.
  await assert.rejects(pay({ idempotencyKey: key }, ids.otherWarehouse), isKeyReused(null));
  assert.strictEqual(await Payment.countDocuments(), 1);
  assert.strictEqual(await Payment.countDocuments({ warehouseId: ids.otherWarehouse }), 0);
});

test('two concurrent submissions under one key with different amounts record one payment', async () => {
  const key = newKey('race');
  const results = await Promise.allSettled([
    pay({ idempotencyKey: key, amount: 30000 }),
    pay({ idempotencyKey: key, amount: 45000 }),
  ]);

  const recorded = results.filter((r) => r.status === 'fulfilled');
  const refused = results.filter((r) => r.status === 'rejected');
  assert.strictEqual(recorded.length, 1, 'exactly one request wins');
  assert.strictEqual(refused.length, 1, 'the other is refused, not handed the winner');
  assert.ok(isKeyReused(recorded[0].value)(refused[0].reason));
  assert.strictEqual(await Payment.countDocuments(), 1);
});

test('a payment recorded before fingerprints existed still replays on its key - for its own warehouse only', async () => {
  await giveTradingRelationship(ids.pharmacy, ids.otherWarehouse, 100000);
  const key = newKey('legacy');
  const first = await pay({ idempotencyKey: key, amount: 30000 });
  // What every keyed payment written before this change looks like.
  await Payment.updateOne({ _id: first._id }, { $set: { idempotencyFingerprint: null } });

  const retry = await pay({ idempotencyKey: key, amount: 99999 });
  assert.strictEqual(String(retry._id), String(first._id));
  assert.strictEqual(retry.$locals.idempotentReplay, true);

  await assert.rejects(pay({ idempotencyKey: key, amount: 30000 }, ids.otherWarehouse), isKeyReused(null));
  assert.strictEqual(await Payment.countDocuments(), 1);
});

test('a payment recorded without a key stores no fingerprint', async () => {
  const payment = await pay();
  const stored = await Payment.findById(payment._id).lean();
  assert.strictEqual(stored.idempotencyKey, null);
  assert.strictEqual(stored.idempotencyFingerprint, null);
});

// --- reversing a payment ----------------------------------------------------

test('a reversal retried with the same key and reason replays the reversal', async () => {
  const payment = await pay();
  const key = newKey('reverse');

  const reversal = await reverse(payment._id, { idempotencyKey: key, reason: 'entered twice' });
  // Without the key this retry would be a PAYMENT_ALREADY_REVERSED error.
  const retry = await reverse(payment._id, { idempotencyKey: key, reason: '  entered twice ' });

  assert.strictEqual(String(retry._id), String(reversal._id));
  assert.strictEqual(retry.$locals.idempotentReplay, true);
  assert.strictEqual(await Payment.countDocuments({ kind: 'reversal' }), 1);
  assert.strictEqual(await balanceSyp(), 100000);
});

test('a reversal key reused with another reason or payment, or across operations, is refused', async () => {
  const settlementKey = newKey('settle');
  const payment = await pay({ idempotencyKey: settlementKey });
  const other = await pay({ amount: 10000 });

  // A settlement's key sent to reverse.
  await assert.rejects(reverse(payment._id, { idempotencyKey: settlementKey }), isKeyReused(payment));

  const reversalKey = newKey('reverse');
  const reversal = await reverse(payment._id, { idempotencyKey: reversalKey, reason: 'entered twice' });

  await assert.rejects(
    reverse(payment._id, { idempotencyKey: reversalKey, reason: 'wrong pharmacy' }),
    isKeyReused(reversal)
  );
  await assert.rejects(
    reverse(other._id, { idempotencyKey: reversalKey, reason: 'entered twice' }),
    isKeyReused(reversal)
  );
  // And a reversal's key sent to record a payment.
  await assert.rejects(pay({ idempotencyKey: reversalKey }), isKeyReused(reversal));

  assert.strictEqual(await Payment.countDocuments({ kind: 'reversal' }), 1);
  assert.strictEqual((await Payment.findById(other._id)).status, 'posted', 'the other payment is untouched');
});

// --- over the wire ------------------------------------------------------------

test('POST /warehouse/payments: replay is 200, a reused key is 409 IDEMPOTENCY_KEY_REUSED', async () => {
  const body = {
    pharmacyId: ids.pharmacy.toString(),
    amount: 30000,
    currency: 'SYP',
    method: 'cash',
    idempotencyKey: newKey('http'),
  };

  const first = await call('POST', '/warehouse/payments', body);
  assert.strictEqual(first.status, 201);

  const replay = await call('POST', '/warehouse/payments', body);
  assert.strictEqual(replay.status, 200);
  assert.strictEqual(replay.headers.get('idempotent-replay'), 'true');
  assert.strictEqual(replay.body.payment.id, first.body.payment.id);

  const reused = await call('POST', '/warehouse/payments', { ...body, amount: 31000 });
  assert.strictEqual(reused.status, 409);
  assert.strictEqual(reused.headers.get('idempotent-replay'), null);
  assert.strictEqual(reused.body.success, false);
  assert.strictEqual(reused.body.code, 'IDEMPOTENCY_KEY_REUSED');
  assert.deepStrictEqual(reused.body.details, {
    paymentId: first.body.payment.id,
    paymentNumber: first.body.payment.paymentNumber,
  });
  assert.ok(!('payment' in reused.body), 'the old payment is not handed back');

  const reverseKey = newKey('http-reverse');
  const reversed = await call('POST', `/warehouse/payments/${first.body.payment.id}/reverse`, {
    reason: 'entered twice',
    idempotencyKey: reverseKey,
  });
  assert.strictEqual(reversed.status, 201);
  const reverseReused = await call('POST', `/warehouse/payments/${first.body.payment.id}/reverse`, {
    reason: 'something else',
    idempotencyKey: reverseKey,
  });
  assert.strictEqual(reverseReused.status, 409);
  assert.strictEqual(reverseReused.body.code, 'IDEMPOTENCY_KEY_REUSED');

  assert.strictEqual(await Payment.countDocuments(), 2, 'one payment, one reversal');
});
