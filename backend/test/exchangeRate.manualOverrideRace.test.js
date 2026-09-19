// The defect: fetchAndStoreFromApi's LiraScope call is a network round trip
// (several seconds, sometimes the full provider timeout) that runs BEFORE its
// write. An admin's setManualRate landing while that fetch is still in flight
// used to be silently undone the moment the fetch resolved - the write always
// stored `manualOverride: false` unconditionally, discarding the pin nothing
// else would ever restore. Reachable from both the daily/boot refreshFromApi
// tick and resetToApi's own immediate fetch.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-fx-override-race';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const { setTimeout: sleep } = require('node:timers/promises');
const mongoose = require('mongoose');
const { startMemoryMongo, stopMemoryMongo, clearCollections } = require('./helpers/mongo');

const ExchangeRate = require('../src/models/exchangeRate.model');
const ExchangeRateHistory = require('../src/models/exchangeRateHistory.model');
const exchangeRateService = require('../src/services/exchangeRate.service');

const { mock } = test;

const MARKET_MID = 136.375;
const STORED_RATE = 130;
const STORED_AT = new Date('2026-01-01T09:00:00Z');

function liraScopeBody(mid = MARKET_MID) {
  return {
    timestampUtc: new Date().toISOString(),
    marketRates: [
      { currency: 'USD', buy: mid - 0.5, sell: mid + 0.5, mid, timestampUtc: new Date().toISOString() },
    ],
  };
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

// Holds the LiraScope response open until the test explicitly releases it, so
// a setManualRate can be run "during" the fetch deterministically instead of
// racing real timers. `pendingRelease` also doubles as this test's dangling
// state: afterEach unblocks it if a failed assertion skipped the release, so
// one failing test can't leave a live promise leaking into the next.
let pendingRelease = null;
function fetchStaysOpen() {
  return new Promise((resolve) => {
    pendingRelease = () => resolve(jsonResponse(liraScopeBody()));
  });
}

async function waitFor(predicate, what) {
  for (let i = 0; i < 200; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    if (await predicate()) return;
    // eslint-disable-next-line no-await-in-loop
    await sleep(10);
  }
  assert.fail(`timed out waiting for ${what}`);
}

let logs;

test.before(async () => {
  await startMemoryMongo({ dbName: 'feniq-fx-override-race-test' });
});

test.after(async () => {
  await stopMemoryMongo();
});

test.beforeEach(async () => {
  await clearCollections(ExchangeRate, ExchangeRateHistory);
  pendingRelease = null;
  logs = [];
  mock.method(console, 'log', (...args) => logs.push(args.join(' ')));
  mock.method(console, 'error', (...args) => logs.push(args.join(' ')));
});

test.afterEach(async () => {
  // Safety net: if an assertion threw before the held-open fetch was
  // released, unblock it now so it can't finish mid-teardown against a
  // connection the next test's beforeEach is about to touch.
  if (pendingRelease) {
    const release = pendingRelease;
    pendingRelease = null;
    release();
    await sleep(20);
  }
  mock.restoreAll();
});

async function seedStoredRate({ source = 'api', manualOverride = false } = {}) {
  await ExchangeRate.create({
    _id: 'singleton',
    usdToSyp: STORED_RATE,
    source,
    lastUpdated: STORED_AT,
    manualOverride,
  });
}

async function storedRate() {
  return ExchangeRate.findById('singleton').lean();
}

test('refreshFromApi: a manual override set mid-fetch survives - the API write is skipped, not applied', async () => {
  await seedStoredRate({ source: 'api', manualOverride: false });
  mock.method(globalThis, 'fetch', () => fetchStaysOpen());

  const refreshPromise = exchangeRateService.refreshFromApi();
  await waitFor(() => pendingRelease !== null, 'the LiraScope fetch to start');

  // The admin's write completes in full WHILE the API fetch above is still
  // in flight.
  const pinned = await exchangeRateService.setManualRate(999, new mongoose.Types.ObjectId());
  assert.strictEqual(pinned.manualOverride, true);
  assert.strictEqual(pinned.usdToSyp, 999);

  // The held LiraScope response now finally arrives.
  const release = pendingRelease;
  pendingRelease = null;
  release();
  await refreshPromise;

  const rate = await storedRate();
  assert.strictEqual(rate.usdToSyp, 999, 'the manual pin was not overwritten by the API result');
  assert.strictEqual(rate.source, 'manual');
  assert.strictEqual(rate.manualOverride, true);

  // Only the manual change is in the history - the API write never happened.
  const history = await ExchangeRateHistory.find().sort({ _id: 1 }).lean();
  assert.strictEqual(history.length, 1);
  assert.strictEqual(history[0].source, 'manual');
  assert.strictEqual(history[0].usdToSyp, 999);

  assert.ok(
    logs.some((l) => l.includes('API write skipped') && l.includes('in flight')),
    'the skip is logged'
  );
});

test('resetToApi: a fresh manual override set mid-fetch survives too, even though resetToApi itself just cleared the old one', async () => {
  await seedStoredRate({ source: 'manual', manualOverride: true });
  mock.method(globalThis, 'fetch', () => fetchStaysOpen());

  const resetPromise = exchangeRateService.resetToApi();
  await waitFor(() => pendingRelease !== null, 'resetToApi\'s own LiraScope fetch to start');

  // A different admin pins a brand new manual rate before resetToApi's own
  // fetch has had a chance to land.
  await exchangeRateService.setManualRate(777, new mongoose.Types.ObjectId());

  const release = pendingRelease;
  pendingRelease = null;
  release();
  await resetPromise;

  const rate = await storedRate();
  assert.strictEqual(rate.usdToSyp, 777, 'the newer pin was not overwritten by the in-flight reset');
  assert.strictEqual(rate.manualOverride, true);
});

test('a fetch that resolves with nothing racing it still writes normally (no regression to the ordinary path)', async () => {
  await seedStoredRate({ source: 'api', manualOverride: false });
  mock.method(globalThis, 'fetch', async () => jsonResponse(liraScopeBody(140)));

  await exchangeRateService.refreshFromApi();

  const rate = await storedRate();
  assert.strictEqual(rate.usdToSyp, 140);
  assert.strictEqual(rate.source, 'api');
  assert.strictEqual(await ExchangeRateHistory.countDocuments(), 1);
});

test('a first-ever boot (no stored row at all) still creates it normally - nothing to race yet', async () => {
  mock.method(globalThis, 'fetch', async () => jsonResponse(liraScopeBody(140)));

  await exchangeRateService.refreshFromApi();

  const rate = await storedRate();
  assert.strictEqual(rate.usdToSyp, 140);
  assert.strictEqual(rate.manualOverride, false);
});
