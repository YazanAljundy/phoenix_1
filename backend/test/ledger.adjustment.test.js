// Money-Flow V2 - manual credits and debits.
//
// The escape hatch for what no automated path covers: goodwill after a
// dispute, a correction to a delivered order that must not be re-priced, a
// write-off. Admin-only, and every one carries a mandatory reason - an
// unexplained balance movement is exactly what V1's audit had no answer for.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-adjustments-padd';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');

const { startMemoryMongo, stopMemoryMongo, syncIndexes } = require('./helpers/mongo');

const User = require('../src/models/user.model');
const Pharmacy = require('../src/models/pharmacy.model');
const Warehouse = require('../src/models/warehouse.model');
const ExchangeRate = require('../src/models/exchangeRate.model');
const LedgerAccount = require('../src/models/ledgerAccount.model');
const LedgerEntry = require('../src/models/ledgerEntry.model');
const FinancialAuditLog = require('../src/models/financialAuditLog.model');

const adjustments = require('../src/services/ledgerAdjustment.service');
const ledger = require('../src/services/ledger.service');
const statementService = require('../src/services/accountStatement.service');

const RATE = 10000;
const ids = {};

function withCode(expected) {
  return (err) => {
    assert.strictEqual(err.code, expected, `expected ${expected}, got ${err.code}`);
    return true;
  };
}

function adjust(overrides = {}) {
  return adjustments.postAdjustment({
    pharmacyId: ids.pharmacy.toString(),
    warehouseId: ids.warehouse.toString(),
    direction: 'credit',
    amountSyp: 50000,
    reason: 'goodwill after a delivery dispute',
    actorId: ids.adminUser,
    ...overrides,
  });
}

async function balance() {
  const account = await ledger.findAccount(ids.pharmacy, ids.warehouse);
  return account ? account.balanceCache.syp : 0;
}

test.before(async () => {
  await startMemoryMongo({ dbName: 'feniq-adjustment-test' });
  await syncIndexes(LedgerEntry, LedgerAccount);
  await ExchangeRate.create({ _id: 'singleton', usdToSyp: RATE, source: 'manual' });

  const [adminUser, phUser, whUser] = await User.create([
    { name: 'Admin', phone: '0951000001', role: 'admin', status: 'active' },
    { name: 'PH', phone: '0932001001', role: 'pharmacy', status: 'active' },
    { name: 'WH', phone: '0942001001', role: 'warehouse', status: 'active' },
  ]);
  ids.adminUser = adminUser._id;

  const pharmacy = await Pharmacy.create({
    userId: phUser._id, nameAr: 'ص', nameEn: 'Pharmacy', ownerName: 'O',
    address: 'a', city: 'Latakia', areaType: 'city', phone: '0932001001', addedBy: 'self',
  });
  ids.pharmacy = pharmacy._id;

  const warehouse = await Warehouse.create({
    userId: whUser._id, nameAr: 'م', nameEn: 'Warehouse', address: 'r', city: 'Latakia',
    phone: '0942001001', deliveryType: 'self', isActive: true,
  });
  ids.warehouse = warehouse._id;
});

test.after(async () => {
  await stopMemoryMongo();
});

test.beforeEach(async () => {
  await Promise.all([
    LedgerEntry.deleteMany({}),
    LedgerAccount.deleteMany({}),
    FinancialAuditLog.deleteMany({}),
  ]);
});

// --- posting ----------------------------------------------------------------

test('a manual credit reduces what the pharmacy owes', async () => {
  const { entry } = await adjust({ direction: 'credit', amountSyp: 50000 });

  assert.strictEqual(entry.kind, 'manual_credit');
  assert.strictEqual(entry.direction, 'credit');
  assert.strictEqual(entry.amountSyp, 50000);
  assert.strictEqual(entry.amountUsd, 5);
  assert.strictEqual(await balance(), -50000);
});

test('a manual debit increases it', async () => {
  const { entry } = await adjust({
    direction: 'debit',
    amountSyp: 30000,
    reason: 'under-billed on order #412',
  });

  assert.strictEqual(entry.kind, 'manual_debit');
  assert.strictEqual(entry.direction, 'debit');
  assert.strictEqual(await balance(), 30000);
});

test('an adjustment creates the account if the pair has never traded', async () => {
  assert.strictEqual(await ledger.findAccount(ids.pharmacy, ids.warehouse), null);
  await adjust();
  assert.ok(await ledger.findAccount(ids.pharmacy, ids.warehouse));
});

// --- the reason is mandatory ------------------------------------------------

test('an adjustment without a reason is refused', async () => {
  await assert.rejects(() => adjust({ reason: '   ' }), withCode('REASON_REQUIRED'));
  await assert.rejects(() => adjust({ reason: null }), withCode('REASON_REQUIRED'));
  assert.strictEqual(await LedgerEntry.countDocuments(), 0, 'nothing was posted');
});

test('the reason is stored on the entry and in the audit log', async () => {
  const { entry } = await adjust({ reason: 'goodwill after a delivery dispute' });

  assert.strictEqual(entry.reason, 'goodwill after a delivery dispute');
  const audit = await FinancialAuditLog.findOne({ action: 'ledger.manual_credit' }).lean();
  assert.strictEqual(audit.reason, 'goodwill after a delivery dispute');
  assert.strictEqual(String(audit.actorId), String(ids.adminUser));
  assert.strictEqual(audit.actorRole, 'admin');
  assert.strictEqual(audit.after.amountSyp, 50000);
});

// --- validation -------------------------------------------------------------

test('validation rejects a bad direction, a bad amount and an unknown account', async () => {
  await assert.rejects(() => adjust({ direction: 'sideways' }), withCode('INVALID_ADJUSTMENT_DIRECTION'));
  await assert.rejects(() => adjust({ amountSyp: 0 }), withCode('INVALID_ADJUSTMENT_AMOUNT'));
  await assert.rejects(() => adjust({ amountSyp: -100 }), withCode('INVALID_ADJUSTMENT_AMOUNT'));
  await assert.rejects(
    () => adjust({ pharmacyId: new mongoose.Types.ObjectId().toString() }),
    withCode('ACCOUNT_NOT_FOUND')
  );
});

test('a fractional amount is rounded to whole lira', async () => {
  const { entry } = await adjust({ amountSyp: 1234.7 });
  assert.strictEqual(entry.amountSyp, 1235, 'the exact-integer balance guarantee holds');
});

// --- idempotency ------------------------------------------------------------

test('the same key posts one adjustment, not two', async () => {
  const key = 'adj-' + new mongoose.Types.ObjectId().toString();
  const first = await adjust({ idempotencyKey: key });
  const second = await adjust({ idempotencyKey: key });

  assert.strictEqual(String(first.entry._id), String(second.entry._id));
  assert.strictEqual(second.replayed, true);
  assert.strictEqual(await LedgerEntry.countDocuments(), 1);
  assert.strictEqual(await balance(), -50000, 'credited once');
});

test('two concurrent posts with the same key credit once', async () => {
  const key = 'adj-race-' + new mongoose.Types.ObjectId().toString();
  const [a, b] = await Promise.all([adjust({ idempotencyKey: key }), adjust({ idempotencyKey: key })]);

  assert.strictEqual(String(a.entry._id), String(b.entry._id));
  assert.strictEqual(await LedgerEntry.countDocuments(), 1);
  assert.strictEqual(await balance(), -50000);
});

// --- reversal ---------------------------------------------------------------

test('reversing an adjustment restores the balance and keeps both entries', async () => {
  const { entry } = await adjust({ direction: 'credit', amountSyp: 50000 });
  assert.strictEqual(await balance(), -50000);

  const { entry: reversal } = await adjustments.reverseAdjustment({
    entryId: entry._id.toString(),
    reason: 'credited the wrong pharmacy',
    actorId: ids.adminUser,
  });

  assert.strictEqual(reversal.kind, 'adjustment_reversal');
  assert.strictEqual(reversal.direction, 'debit', 'the opposite of what it undid');
  assert.strictEqual(reversal.amountSyp, 50000);
  assert.strictEqual(String(reversal.reversalOf), String(entry._id));

  assert.strictEqual(await LedgerEntry.countDocuments(), 2, 'nothing was deleted');
  assert.strictEqual(await balance(), 0);
});

test('a reversal requires a reason', async () => {
  const { entry } = await adjust();
  await assert.rejects(
    () =>
      adjustments.reverseAdjustment({
        entryId: entry._id.toString(),
        reason: '  ',
        actorId: ids.adminUser,
      }),
    withCode('REASON_REQUIRED')
  );
});

test('an adjustment can be reversed only once', async () => {
  const { entry } = await adjust();
  await adjustments.reverseAdjustment({
    entryId: entry._id.toString(), reason: 'wrong pharmacy', actorId: ids.adminUser,
  });

  await assert.rejects(
    () =>
      adjustments.reverseAdjustment({
        entryId: entry._id.toString(), reason: 'again', actorId: ids.adminUser,
      }),
    withCode('ALREADY_REVERSED')
  );
  assert.strictEqual(await LedgerEntry.countDocuments({ kind: 'adjustment_reversal' }), 1);
});

test('only a manual adjustment can be reversed through this path', async () => {
  // A charge is undone by reversing the delivery, a payment by reversing the
  // payment - each through the path that owns it, so the linked document's
  // status stays truthful.
  const account = await ledger.resolveAccount(ids.pharmacy, ids.warehouse);
  const { runInTransaction } = require('../src/utils/transaction');
  const charge = await runInTransaction((session) =>
    ledger.postEntry(
      {
        account, kind: 'charge', amountSyp: 100000,
        source: { orderId: new mongoose.Types.ObjectId() },
      },
      session
    )
  );

  await assert.rejects(
    () =>
      adjustments.reverseAdjustment({
        entryId: charge.entry._id.toString(), reason: 'nope', actorId: ids.adminUser,
      }),
    withCode('NOT_A_MANUAL_ADJUSTMENT')
  );
});

test('a reversal writes its own audit record', async () => {
  const { entry } = await adjust();
  await adjustments.reverseAdjustment({
    entryId: entry._id.toString(), reason: 'credited the wrong pharmacy', actorId: ids.adminUser,
  });

  const audit = await FinancialAuditLog.findOne({ action: 'ledger.adjustment_reversed' }).lean();
  assert.strictEqual(audit.reason, 'credited the wrong pharmacy');
  assert.strictEqual(String(audit.entityId), String(entry._id));
});

// --- how it reads on the statement -----------------------------------------

test('adjustments appear on the statement with their reason', async () => {
  const { entry } = await adjust({ direction: 'credit', amountSyp: 50000 });
  await adjustments.reverseAdjustment({
    entryId: entry._id.toString(), reason: 'credited the wrong pharmacy', actorId: ids.adminUser,
  });

  const data = await statementService.getStatement({
    pharmacyId: ids.pharmacy,
    warehouseId: ids.warehouse,
    from: new Date(Date.now() - 24 * 60 * 60 * 1000),
    to: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });

  assert.deepStrictEqual(data.rows.map((r) => r.kind), ['manual_credit', 'adjustment_reversal']);
  assert.strictEqual(data.rows[0].reason, 'goodwill after a delivery dispute');
  assert.strictEqual(data.rows[1].reason, 'credited the wrong pharmacy');
  assert.strictEqual(data.closing.syp, 0);
});

// --- rebuilding the cache ---------------------------------------------------

test('rebuilding a healthy account reports it was already consistent', async () => {
  await adjust();
  const account = await ledger.findAccount(ids.pharmacy, ids.warehouse);

  const result = await adjustments.rebuildAccountBalance({
    accountId: account._id.toString(), actorId: ids.adminUser, reason: 'routine check',
  });

  assert.strictEqual(result.wasConsistent, true);
  assert.strictEqual(result.balance.syp, -50000);
});

test('rebuilding repairs a cache that has drifted, and audits it', async () => {
  await adjust();
  const account = await ledger.findAccount(ids.pharmacy, ids.warehouse);

  // Corrupt the cache the way only a bug could.
  await LedgerAccount.updateOne({ _id: account._id }, { $set: { 'balanceCache.syp': 999999 } });

  const result = await adjustments.rebuildAccountBalance({
    accountId: account._id.toString(), actorId: ids.adminUser, reason: 'verifier reported a mismatch',
  });

  assert.strictEqual(result.wasConsistent, false, 'the drift was detected');
  assert.strictEqual(result.balance.syp, -50000);
  assert.strictEqual(await balance(), -50000, 'and repaired');

  const audit = await FinancialAuditLog.findOne({ action: 'balance.rebuilt' }).lean();
  assert.strictEqual(audit.reason, 'verifier reported a mismatch');
});
