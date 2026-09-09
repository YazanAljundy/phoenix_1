// Money-Flow V2 - the ledger core.
//
// These are the invariants everything else in the financial model rests on:
// entries are immutable and append-only, sequences are gap-free per account,
// the balance cache always equals a full replay, and a reversal exactly
// negates its target without re-converting anything at today's rate.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-ledger-tests';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');

const { startMemoryMongo, stopMemoryMongo, syncIndexes } = require('./helpers/mongo');
const { runInTransaction } = require('../src/utils/transaction');

const LedgerAccount = require('../src/models/ledgerAccount.model');
const LedgerEntry = require('../src/models/ledgerEntry.model');
const ledgerService = require('../src/services/ledger.service');

const ids = {};

// Every test posts against its own account, so a failure in one cannot shift
// another's balance.
async function freshAccount() {
  return ledgerService.resolveAccount(new mongoose.Types.ObjectId(), ids.warehouse);
}

function post(account, overrides) {
  return runInTransaction((session) =>
    ledgerService.postEntry(
      {
        account,
        kind: 'charge',
        amountSyp: 1000,
        amountUsd: 0.1,
        fx: { rate: 10000, source: 'order', rateAsOf: new Date() },
        ...overrides,
      },
      session
    )
  );
}

test.before(async () => {
  await startMemoryMongo({ dbName: 'feniq-ledger-core-test' });
  await syncIndexes(LedgerAccount, LedgerEntry);
  ids.warehouse = new mongoose.Types.ObjectId();
});

test.after(async () => {
  await stopMemoryMongo();
});

// --- the environment itself -------------------------------------------------

test('the test database is a replica set, so transactions are available', async () => {
  const info = await mongoose.connection.db.admin().command({ hello: 1 });
  assert.ok(info.setName, 'expected a replica set, got a standalone');
});

// --- accounts ---------------------------------------------------------------

test('resolveAccount is idempotent for a (pharmacy, warehouse) pair', async () => {
  const pharmacyId = new mongoose.Types.ObjectId();
  const first = await ledgerService.resolveAccount(pharmacyId, ids.warehouse);
  const second = await ledgerService.resolveAccount(pharmacyId, ids.warehouse);

  assert.strictEqual(String(first._id), String(second._id));
  assert.strictEqual(await LedgerAccount.countDocuments({ pharmacyId }), 1);
  assert.strictEqual(first.settlementCurrency, 'SYP');
  assert.strictEqual(first.balanceCache.syp, 0);
});

test('findAccount never creates a row', async () => {
  const pharmacyId = new mongoose.Types.ObjectId();
  assert.strictEqual(await ledgerService.findAccount(pharmacyId, ids.warehouse), null);
  assert.strictEqual(await LedgerAccount.countDocuments({ pharmacyId }), 0);
});

// --- posting ----------------------------------------------------------------

test('a charge is a debit: it increases what the pharmacy owes', async () => {
  const account = await freshAccount();
  const { entry, account: updated } = await post(account, { amountSyp: 250000, amountUsd: 25 });

  assert.strictEqual(entry.direction, 'debit');
  assert.strictEqual(entry.amountSyp, 250000);
  assert.strictEqual(entry.sequence, 1);
  assert.ok(entry.entryNumber > 0, 'a global entry number is assigned');
  assert.strictEqual(updated.balanceCache.syp, 250000);
  assert.strictEqual(updated.balanceCache.usd, 25);
  assert.strictEqual(updated.balanceCache.lastEntrySeq, 1);
});

test('a payment is a credit: it reduces what the pharmacy owes', async () => {
  const account = await freshAccount();
  await post(account, { amountSyp: 250000, amountUsd: 25 });
  const { account: updated } = await post(account, {
    kind: 'payment',
    amountSyp: 100000,
    amountUsd: 10,
  });

  assert.strictEqual(updated.balanceCache.syp, 150000);
  assert.strictEqual(updated.balanceCache.usd, 15);
});

test('balance goes negative on overpayment - that is a credit balance, not an error', async () => {
  const account = await freshAccount();
  await post(account, { amountSyp: 100000, amountUsd: 10 });
  const { account: updated } = await post(account, {
    kind: 'payment',
    amountSyp: 130000,
    amountUsd: 13,
  });

  assert.strictEqual(updated.balanceCache.syp, -30000);
});

test('sequences are gap-free and monotonic per account, independent across accounts', async () => {
  const a = await freshAccount();
  const b = await freshAccount();

  for (let i = 0; i < 5; i += 1) await post(a, { amountSyp: 100 });
  await post(b, { amountSyp: 100 });

  const aSeqs = (await LedgerEntry.find({ accountId: a._id }).sort({ sequence: 1 }).lean()).map(
    (e) => e.sequence
  );
  const bSeqs = (await LedgerEntry.find({ accountId: b._id }).lean()).map((e) => e.sequence);

  assert.deepStrictEqual(aSeqs, [1, 2, 3, 4, 5]);
  assert.deepStrictEqual(bSeqs, [1], 'each account has its own sequence line');
});

test('postEntry refuses to run outside a transaction', async () => {
  const account = await freshAccount();
  await assert.rejects(
    () => ledgerService.postEntry({ account, kind: 'charge', amountSyp: 1 }, null),
    /requires a transaction session/
  );
});

test('SYP amounts are stored as whole lira', async () => {
  const account = await freshAccount();
  const { entry } = await post(account, { amountSyp: 1000.6 });
  assert.strictEqual(entry.amountSyp, 1001);
});

// --- reasons ----------------------------------------------------------------

test('manual credit and debit require a reason', async () => {
  const account = await freshAccount();

  await assert.rejects(
    () => post(account, { kind: 'manual_credit', amountSyp: 500 }),
    (err) => err.code === 'REASON_REQUIRED'
  );
  await assert.rejects(
    () => post(account, { kind: 'manual_debit', amountSyp: 500, reason: '   ' }),
    (err) => err.code === 'REASON_REQUIRED'
  );

  const { entry } = await post(account, {
    kind: 'manual_credit',
    amountSyp: 500,
    reason: 'goodwill after a delivery dispute',
  });
  assert.strictEqual(entry.reason, 'goodwill after a delivery dispute');
  assert.strictEqual(entry.direction, 'credit');
});

// --- reversal ---------------------------------------------------------------

test('a reversal exactly negates its target and restores the balance', async () => {
  const account = await freshAccount();
  const { entry: payment } = await post(account, {
    kind: 'payment',
    amountSyp: 500000,
    amountUsd: 50,
    fx: { rate: 10000, source: 'manual', rateAsOf: new Date() },
  });

  const before = await LedgerAccount.findById(account._id).lean();
  assert.strictEqual(before.balanceCache.syp, -500000);

  const { entry: reversal, account: after } = await runInTransaction((session) =>
    ledgerService.postReversal(
      { targetEntry: payment, createdBy: null, reason: 'recorded against the wrong pharmacy' },
      session
    )
  );

  assert.strictEqual(reversal.kind, 'payment_reversal');
  assert.strictEqual(reversal.direction, 'debit');
  assert.strictEqual(reversal.amountSyp, 500000);
  assert.strictEqual(reversal.amountUsd, 50);
  assert.strictEqual(String(reversal.reversalOf), String(payment._id));
  assert.strictEqual(after.balanceCache.syp, 0, 'balance is back where it started');
});

test('a reversal copies the ORIGINAL fx rate, not the rate at reversal time', async () => {
  const account = await freshAccount();
  const originalRate = 10000;
  const { entry: payment } = await post(account, {
    kind: 'payment',
    amountSyp: 500000,
    amountUsd: 50,
    fx: { rate: originalRate, source: 'manual', rateAsOf: new Date('2026-01-01') },
  });

  const { entry: reversal } = await runInTransaction((session) =>
    ledgerService.postReversal({ targetEntry: payment, reason: 'duplicate entry' }, session)
  );

  assert.strictEqual(reversal.fx.rate, originalRate);
  assert.strictEqual(
    reversal.amountUsd,
    payment.amountUsd,
    'reverse-then-repost must be FX-neutral'
  );
});

test('an entry can be reversed at most once', async () => {
  const account = await freshAccount();
  const { entry: charge } = await post(account, { amountSyp: 1000 });

  await runInTransaction((session) =>
    ledgerService.postReversal({ targetEntry: charge, reason: 'never delivered' }, session)
  );

  await assert.rejects(
    () =>
      runInTransaction((session) =>
        ledgerService.postReversal({ targetEntry: charge, reason: 'again' }, session)
      ),
    (err) => err.code === 'ALREADY_REVERSED'
  );
});

test('a reversal cannot itself be reversed', async () => {
  const account = await freshAccount();
  const { entry: charge } = await post(account, { amountSyp: 1000 });
  const { entry: reversal } = await runInTransaction((session) =>
    ledgerService.postReversal({ targetEntry: charge, reason: 'never delivered' }, session)
  );

  await assert.rejects(
    () =>
      runInTransaction((session) =>
        ledgerService.postReversal({ targetEntry: reversal, reason: 'undo the undo' }, session)
      ),
    (err) => err.code === 'CANNOT_REVERSE_A_REVERSAL'
  );
});

test('a reversal requires a reason', async () => {
  const account = await freshAccount();
  const { entry: charge } = await post(account, { amountSyp: 1000 });

  await assert.rejects(
    () =>
      runInTransaction((session) =>
        ledgerService.postReversal({ targetEntry: charge, reason: '' }, session)
      ),
    (err) => err.code === 'REASON_REQUIRED'
  );
});

// --- immutability & atomicity ----------------------------------------------

test('a failed transaction leaves no entry and no balance movement', async () => {
  const account = await freshAccount();
  await post(account, { amountSyp: 100000, amountUsd: 10 });

  const before = await LedgerAccount.findById(account._id).lean();
  const countBefore = await LedgerEntry.countDocuments({ accountId: account._id });

  await assert.rejects(() =>
    runInTransaction(async (session) => {
      await ledgerService.postEntry(
        { account, kind: 'payment', amountSyp: 999999, amountUsd: 99 },
        session
      );
      throw new Error('boom - something after the post failed');
    })
  );

  const after = await LedgerAccount.findById(account._id).lean();
  assert.strictEqual(
    await LedgerEntry.countDocuments({ accountId: account._id }),
    countBefore,
    'the entry was rolled back'
  );
  assert.strictEqual(after.balanceCache.syp, before.balanceCache.syp, 'the balance was rolled back');
  assert.strictEqual(after.seqCounter, before.seqCounter, 'the sequence was not consumed');
});

// --- replay & verify --------------------------------------------------------

test('replayAccount reproduces the cache exactly', async () => {
  const account = await freshAccount();
  await post(account, { amountSyp: 250000, amountUsd: 25 });
  await post(account, { kind: 'payment', amountSyp: 100000, amountUsd: 10 });
  await post(account, { kind: 'return_credit', amountSyp: 30000, amountUsd: 3 });

  const replay = await ledgerService.replayAccount(account._id, { persist: false });
  const cached = await LedgerAccount.findById(account._id).lean();

  assert.strictEqual(replay.syp, 120000); // 250000 - 100000 - 30000
  assert.strictEqual(replay.syp, cached.balanceCache.syp);
  assert.strictEqual(replay.usd, cached.balanceCache.usd);
  assert.strictEqual(replay.entryCount, 3);
});

test('verifyAccount detects a corrupted cache and a rebuild repairs it', async () => {
  const account = await freshAccount();
  await post(account, { amountSyp: 200000, amountUsd: 20 });

  // Simulate drift the only way it could ever happen - a write that did not go
  // through postEntry.
  await LedgerAccount.updateOne({ _id: account._id }, { $set: { 'balanceCache.syp': 999 } });

  const bad = await ledgerService.verifyAccount(account._id);
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.cached.syp, 999);
  assert.strictEqual(bad.replay.syp, 200000);

  await ledgerService.replayAccount(account._id, { persist: true });
  const good = await ledgerService.verifyAccount(account._id);
  assert.strictEqual(good.ok, true);
});

test('verifyAllAccounts reports and repairs every drifted account', async () => {
  const account = await freshAccount();
  await post(account, { amountSyp: 50000, amountUsd: 5 });
  await LedgerAccount.updateOne({ _id: account._id }, { $set: { 'balanceCache.syp': 1 } });

  const mismatches = await ledgerService.verifyAllAccounts({ rebuild: true });
  assert.ok(
    mismatches.some((m) => String(m.accountId) === String(account._id)),
    'the drifted account is reported'
  );
  assert.strictEqual((await ledgerService.verifyAccount(account._id)).ok, true);
});

// --- statement reads --------------------------------------------------------

test('entries list in business-date order, with sequence breaking ties', async () => {
  const account = await freshAccount();
  const day = (d) => new Date(`2026-03-0${d}T10:00:00Z`);

  await post(account, { amountSyp: 100, effectiveAt: day(3) });
  await post(account, { kind: 'payment', amountSyp: 200, effectiveAt: day(1) });
  // Same business date as the first - the sequence decides which comes first.
  await post(account, { kind: 'payment', amountSyp: 300, effectiveAt: day(3) });

  const rows = await ledgerService.listEntriesForAccount(account._id);
  assert.deepStrictEqual(
    rows.map((r) => r.amountSyp),
    [200, 100, 300],
    'a backdated payment lands on its real date, not its typing date'
  );
});

test('openingBalanceFor sums everything before the period', async () => {
  const account = await freshAccount();
  const day = (d) => new Date(`2026-04-0${d}T10:00:00Z`);

  await post(account, { amountSyp: 100000, amountUsd: 10, effectiveAt: day(1) });
  await post(account, { kind: 'payment', amountSyp: 40000, amountUsd: 4, effectiveAt: day(2) });
  await post(account, { amountSyp: 5000, amountUsd: 0.5, effectiveAt: day(9) });

  const opening = await ledgerService.openingBalanceFor(account._id, day(5));
  assert.strictEqual(opening.syp, 60000, 'only the two entries before the 5th count');
  assert.strictEqual(opening.usd, 6);
});
