// The defect: replayAccount's cursor scan over an account's entries is a
// plain read, not a snapshot - it can take a while on a busy account, and
// nothing stopped a real postEntry from landing on that SAME account while
// the scan was still running. The persist step that followed was
// unconditional: it always overwrote balanceCache with whatever the scan had
// summed, discarding any entry that posted mid-scan even though that entry's
// own LedgerEntry row (and the account's seqCounter, which postEntry moves
// in the same atomic $inc) were both already correct. Reachable from the
// nightly verifier sweep and, more directly, from the admin's own
// rebuildAccountBalance action - which an operator can run at any time,
// often BECAUSE an account is actively in question.
//
// The fix: replayAccount now reads the account's seqCounter before it scans,
// and only persists if seqCounter is still that value when the write lands -
// otherwise it rescans from scratch (seqCounter moving means the sum it just
// computed is already missing something), bounded to a few attempts.
//
// These tests drive that retry loop directly by mocking LedgerAccount's
// updateOne to simulate a lost race deterministically - a real cursor's
// timing against a real concurrent write is not something a test can pin
// down reliably, but the guard's own control flow (retry on a miss, give up
// loudly after too many) is exactly what changed, and is what these pin down.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-ledger-replay-race';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');

const { startMemoryMongo, stopMemoryMongo, syncIndexes } = require('./helpers/mongo');
const { runInTransaction } = require('../src/utils/transaction');

const LedgerAccount = require('../src/models/ledgerAccount.model');
const LedgerEntry = require('../src/models/ledgerEntry.model');
const ledgerService = require('../src/services/ledger.service');

const { mock } = test;

const ids = {};

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
  await startMemoryMongo({ dbName: 'feniq-ledger-replay-race-test' });
  await syncIndexes(LedgerAccount, LedgerEntry);
  ids.warehouse = new mongoose.Types.ObjectId();
});

test.after(async () => {
  await stopMemoryMongo();
});

test.afterEach(() => {
  mock.restoreAll();
});

test('a guard miss on the first attempt is rescanned, not applied - the final cache is still correct', async () => {
  const account = await freshAccount();
  await post(account, { amountSyp: 250000, amountUsd: 25 });
  await post(account, { kind: 'payment', amountSyp: 100000, amountUsd: 10 });

  const realUpdateOne = LedgerAccount.updateOne.bind(LedgerAccount);
  let calls = 0;
  mock.method(LedgerAccount, 'updateOne', (...args) => {
    calls += 1;
    if (calls === 1) {
      // Simulate: seqCounter had already moved by the time this attempt's
      // write reached the database - as if a postEntry landed mid-scan.
      return Promise.resolve({ matchedCount: 0, modifiedCount: 0 });
    }
    return realUpdateOne(...args);
  });

  const replay = await ledgerService.replayAccount(account._id, { persist: true });

  assert.strictEqual(calls, 2, 'the guard miss forced exactly one rescan');
  assert.strictEqual(replay.syp, 150000); // 250000 - 100000
  const stored = await LedgerAccount.findById(account._id).lean();
  assert.strictEqual(stored.balanceCache.syp, 150000, 'the persisted cache reflects the rescan, not the missed attempt');
  assert.strictEqual(stored.balanceCache.lastEntrySeq, 2);
});

test('a real concurrent post between the guard read and the write is not lost - the retry picks it up', async () => {
  const account = await freshAccount();
  await post(account, { amountSyp: 100000, amountUsd: 10 });

  const realUpdateOne = LedgerAccount.updateOne.bind(LedgerAccount);
  let calls = 0;
  mock.method(LedgerAccount, 'updateOne', async (...args) => {
    calls += 1;
    if (calls === 1) {
      // This is the moment a concurrent postEntry would have landed: commit
      // a real second charge on the SAME account before this (lost) attempt
      // even tries to write, exactly like postEntry racing the scan above.
      await post(account, { amountSyp: 40000, amountUsd: 4 });
      return { matchedCount: 0, modifiedCount: 0 };
    }
    return realUpdateOne(...args);
  });

  const replay = await ledgerService.replayAccount(account._id, { persist: true });

  assert.strictEqual(calls, 2);
  assert.strictEqual(replay.syp, 140000, 'the entry that landed mid-race is included, not silently dropped');
  assert.strictEqual(replay.entryCount, 2);
  const stored = await LedgerAccount.findById(account._id).lean();
  assert.strictEqual(stored.balanceCache.syp, 140000);
  assert.strictEqual(stored.balanceCache.lastEntrySeq, 2);
});

test('persistent contention gives up loudly after a bounded number of attempts, rather than looping forever or persisting a stale sum', async () => {
  const account = await freshAccount();
  await post(account, { amountSyp: 100000, amountUsd: 10 });

  let calls = 0;
  mock.method(LedgerAccount, 'updateOne', () => {
    calls += 1;
    return Promise.resolve({ matchedCount: 0, modifiedCount: 0 });
  });

  await assert.rejects(
    ledgerService.replayAccount(account._id, { persist: true }),
    /gave up after \d+ attempts/
  );
  assert.strictEqual(calls, 5, 'exactly the documented attempt budget, not an unbounded retry');

  const stored = await LedgerAccount.findById(account._id).lean();
  assert.strictEqual(stored.balanceCache.syp, 100000, 'the original cache was left untouched, not overwritten with a half-applied guess');
});

test('a read-only replay (verifyAccount\'s use) never touches the guard or writes anything', async () => {
  const account = await freshAccount();
  await post(account, { amountSyp: 60000, amountUsd: 6 });

  let updateCalls = 0;
  mock.method(LedgerAccount, 'updateOne', () => {
    updateCalls += 1;
    return Promise.reject(new Error('persist:false must never write'));
  });

  const replay = await ledgerService.replayAccount(account._id, { persist: false });

  assert.strictEqual(updateCalls, 0);
  assert.strictEqual(replay.syp, 60000);
});

test('replaying a nonexistent account is still a quiet no-op, not a retry storm', async () => {
  const ghostId = new mongoose.Types.ObjectId();

  let updateCalls = 0;
  mock.method(LedgerAccount, 'updateOne', () => {
    updateCalls += 1;
    return Promise.resolve({ matchedCount: 0, modifiedCount: 0 });
  });

  const replay = await ledgerService.replayAccount(ghostId, { persist: true });

  assert.strictEqual(updateCalls, 0, 'nothing to guard for an account that does not exist, so nothing is written');
  assert.deepStrictEqual(replay, { syp: 0, usd: 0, lastEntrySeq: 0, entryCount: 0 });
});
