// LiraScope is the provider behind the automatic USD/SYP rate. These tests pin
// down the provider swap: what gets parsed, what counts as unusable (and so
// falls back to the stored rate), and that the Mongo singleton stays the only
// thing requests read - LiraScope is reached only on an empty boot, the daily
// 09:00 tick, or an admin's "reset to API".
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-fx-provider-tests';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const { setTimeout: sleep } = require('node:timers/promises');
const { startMemoryMongo, stopMemoryMongo, clearCollections } = require('./helpers/mongo');

const ExchangeRate = require('../src/models/exchangeRate.model');
const ExchangeRateHistory = require('../src/models/exchangeRateHistory.model');
const exchangeRateService = require('../src/services/exchangeRate.service');
const exchangeRateController = require('../src/controllers/exchangeRate.controller');

const { mock } = test;

const LIRASCOPE_URL = 'https://lirascope.syria-cloud.sy/api/v1/rates/latest?currencies=USD';
const DAY_MS = 24 * 60 * 60 * 1000;
const MARKET_MID = 136.375;
const CBS_MID = 122;
const EFFECTIVE_MID = 140.25;
const STORED_RATE = 130;
const STORED_AT = new Date('2026-01-01T09:00:00Z');

function isoFromNow(ms) {
  return new Date(Date.now() + ms).toISOString();
}

function usdEntry(overrides = {}) {
  return {
    currency: 'USD',
    buy: 136,
    sell: 136.75,
    mid: MARKET_MID,
    timestampUtc: isoFromNow(-30 * 60 * 1000),
    isManualOverride: false,
    ...overrides,
  };
}

// Shaped like the live response: every currency comes back regardless of
// `currencies=USD`, the official USD rate sits in cbsRates, and USD is not the
// first market entry. effectiveRates carries a different USD mid so a test
// would notice if it were read instead.
function liraScopeBody({ marketUsd = usdEntry() } = {}) {
  return {
    disclaimer: 'test',
    timestampUtc: isoFromNow(-60 * 1000),
    cbsRates: [
      { currency: 'USD', buy: 121.5, sell: 122.5, mid: CBS_MID, timestampUtc: isoFromNow(-5 * 60 * 60 * 1000), isManualOverride: false },
    ],
    marketRates: [
      { currency: 'TRY', buy: 2.78, sell: 2.81, mid: 2.795, timestampUtc: isoFromNow(-60 * 60 * 1000), isManualOverride: false },
      ...(marketUsd ? [marketUsd] : []),
    ],
    effectiveRates: [usdEntry({ mid: EFFECTIVE_MID })],
  };
}

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

// Every test runs against a stubbed fetch - nothing here may reach the real
// LiraScope, whose public quota is 300 requests a month per IP.
let fetchImpl;
let fetchCalls;
function respondWith(impl) {
  fetchImpl = impl;
}

let logs;

test.before(async () => {
  await startMemoryMongo({ dbName: 'feniq-fx-provider-test' });
});

test.after(async () => {
  await stopMemoryMongo();
});

test.beforeEach(async () => {
  await clearCollections(ExchangeRate, ExchangeRateHistory);
  fetchCalls = [];
  fetchImpl = () => {
    throw new Error('no fetch response configured for this test');
  };
  mock.method(globalThis, 'fetch', async (url, options) => {
    fetchCalls.push({ url: String(url), options });
    return fetchImpl(url, options);
  });
  logs = [];
  mock.method(console, 'log', (...args) => logs.push(args.join(' ')));
  mock.method(console, 'error', (...args) => logs.push(args.join(' ')));
});

test.afterEach(() => {
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

// The public GET /exchange-rate handler, driven directly. asyncHandler does
// not return its promise, so the response (or the error) is captured here.
function callPublicRate() {
  return new Promise((resolve, reject) => {
    exchangeRateController.getPublicRate({}, { json: resolve }, reject);
  });
}

// Captures only the service's own refresh timers (a real 24h timer would keep
// this process alive); every other timer passes through untouched.
function captureRefreshTimers() {
  const timeouts = [];
  const intervals = [];
  const realSetTimeout = globalThis.setTimeout;
  const realSetInterval = globalThis.setInterval;
  mock.method(globalThis, 'setTimeout', (fn, ms, ...rest) => {
    if (String(fn).includes('refreshFromApi')) {
      timeouts.push({ fn, ms });
      return { unref() {} };
    }
    return realSetTimeout(fn, ms, ...rest);
  });
  mock.method(globalThis, 'setInterval', (fn, ms, ...rest) => {
    if (fn === exchangeRateService.refreshFromApi) {
      intervals.push({ fn, ms });
      return { unref() {} };
    }
    return realSetInterval(fn, ms, ...rest);
  });
  return { timeouts, intervals };
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

// --- Parser -----------------------------------------------------------------

test('parser: takes the USD market mid - not the official cbs rate, not the effective rate, not ÷100', () => {
  const parsed = exchangeRateService.parseLiraScopeUsdRate(liraScopeBody());
  assert.strictEqual(parsed.usdToSyp, MARKET_MID);
  assert.strictEqual(parsed.mid, MARKET_MID);
  assert.strictEqual(parsed.buy, 136);
  assert.strictEqual(parsed.sell, 136.75);
  assert.ok(parsed.rateAsOf instanceof Date);
  assert.ok(typeof parsed.responseTimestampUtc === 'string');
});

test('parser: reads LiraScope\'s 5- and 6-digit fractional-second timestamps', () => {
  const parsed = exchangeRateService.parseLiraScopeUsdRate(
    { marketRates: [usdEntry({ timestampUtc: '2026-09-16T15:24:56.20202Z' })] },
    new Date('2026-09-16T18:42:09.648188Z')
  );
  assert.strictEqual(parsed.rateAsOf.toISOString(), '2026-09-16T15:24:56.202Z');
});

// --- Success ----------------------------------------------------------------

test('success: the market mid replaces the stored rate as an api rate, with history', async () => {
  await seedStoredRate();
  respondWith(() => jsonResponse(liraScopeBody(), 200, { 'x-rate-limit-remaining': '42' }));

  await exchangeRateService.refreshFromApi();

  assert.strictEqual(fetchCalls.length, 1);
  assert.strictEqual(fetchCalls[0].url, LIRASCOPE_URL);
  assert.doesNotMatch(fetchCalls[0].url, /app_id|key/i, 'no API key is sent');
  assert.ok(fetchCalls[0].options.signal instanceof AbortSignal, 'the request carries a timeout signal');

  const rate = await storedRate();
  assert.strictEqual(rate.usdToSyp, MARKET_MID);
  assert.strictEqual(rate.source, 'api');
  assert.strictEqual(rate.manualOverride, false);
  assert.ok(rate.lastUpdated > STORED_AT);

  const history = await ExchangeRateHistory.find().lean();
  assert.strictEqual(history.length, 1);
  assert.strictEqual(history[0].usdToSyp, MARKET_MID);
  assert.strictEqual(history[0].previousUsdToSyp, STORED_RATE);
  assert.strictEqual(history[0].source, 'api');

  assert.ok(
    logs.some((l) => l.includes('updated from LiraScope') && l.includes(`${MARKET_MID} SYP`) && l.includes('42 requests left')),
    'the successful fetch is logged'
  );
});

// --- Fallback ---------------------------------------------------------------

const fallbackCases = [
  {
    name: 'marketRates has no USD (only the official cbsRates does)',
    respond: () => jsonResponse(liraScopeBody({ marketUsd: null })),
    reason: /did not include a USD market rate/,
  },
  { name: 'empty object body', respond: () => jsonResponse({}), reason: /did not include marketRates/ },
  { name: 'null body', respond: () => jsonResponse(null), reason: /did not include marketRates/ },
  {
    name: 'empty marketRates',
    respond: () => jsonResponse({ ...liraScopeBody(), marketRates: [] }),
    reason: /did not include a USD market rate/,
  },
  ...[null, 0, -5, '136.375'].map((mid) => ({
    name: `mid is ${JSON.stringify(mid)}`,
    respond: () => jsonResponse(liraScopeBody({ marketUsd: usdEntry({ mid }) })),
    reason: /not a positive number/,
  })),
  {
    name: 'timestamp missing',
    respond: () => jsonResponse(liraScopeBody({ marketUsd: usdEntry({ timestampUtc: undefined }) })),
    reason: /invalid timestamp/,
  },
  {
    name: 'timestamp unparseable',
    respond: () => jsonResponse(liraScopeBody({ marketUsd: usdEntry({ timestampUtc: 'yesterday' }) })),
    reason: /invalid timestamp/,
  },
  {
    name: 'rate is 8 days old',
    respond: () => jsonResponse(liraScopeBody({ marketUsd: usdEntry({ timestampUtc: isoFromNow(-8 * DAY_MS) }) })),
    reason: /stale/,
  },
  {
    name: 'rate is dated a day in the future',
    respond: () => jsonResponse(liraScopeBody({ marketUsd: usdEntry({ timestampUtc: isoFromNow(DAY_MS) }) })),
    reason: /in the future/,
  },
  {
    name: 'body is not JSON',
    respond: () => new Response('<html>maintenance</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    reason: /not valid JSON/,
  },
  {
    // What fetch rejects with when AbortSignal.timeout fires.
    name: 'timeout',
    respond: () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    },
    reason: /timed out after 10000ms/,
  },
  {
    name: 'network error',
    respond: () => {
      throw new TypeError('fetch failed');
    },
    reason: /request failed: fetch failed/,
  },
  {
    name: 'HTTP 429',
    respond: () => jsonResponse({ error: 'Rate limit exceeded. Please retry after 45 seconds.', retryAfter: 45 }, 429),
    reason: /HTTP 429\) \(retry after 45s\)/,
  },
  {
    name: 'HTTP 500',
    respond: () => new Response('Internal Server Error', { status: 500 }),
    reason: /status 500/,
  },
];

for (const { name, respond, reason } of fallbackCases) {
  test(`fallback: ${name} -> the last stored rate is kept untouched`, async () => {
    await seedStoredRate();
    respondWith(respond);

    await exchangeRateService.refreshFromApi();

    assert.strictEqual(fetchCalls.length, 1);
    const rate = await storedRate();
    assert.strictEqual(rate.usdToSyp, STORED_RATE);
    assert.strictEqual(rate.source, 'api');
    assert.strictEqual(rate.lastUpdated.getTime(), STORED_AT.getTime());
    assert.strictEqual(await ExchangeRateHistory.countDocuments(), 0);

    const line = logs.find((l) => l.includes('keeping the last known rate'));
    assert.ok(line, 'the fallback is logged');
    assert.match(line, reason);

    // Anything priced now still gets the stored rate.
    assert.deepStrictEqual(await callPublicRate(), { success: true, usdToSyp: STORED_RATE });
    assert.strictEqual((await exchangeRateService.captureFxSnapshot()).rate, STORED_RATE);
  });
}

test('fallback: a first-ever boot with LiraScope down stores nothing and keeps the 404 contract', async () => {
  respondWith(() => new Response('', { status: 503 }));
  const { timeouts } = captureRefreshTimers();

  await exchangeRateService.startScheduledRefresh();

  assert.strictEqual(fetchCalls.length, 1);
  assert.strictEqual(timeouts.length, 1, 'the 09:00 tick is still scheduled to retry');
  assert.strictEqual(await storedRate(), null);
  await assert.rejects(callPublicRate(), (err) => {
    assert.strictEqual(err.code, 'EXCHANGE_RATE_UNAVAILABLE');
    return true;
  });
});

// --- Manual override --------------------------------------------------------

test('a pinned manual rate is never refreshed - LiraScope is not called', async () => {
  await seedStoredRate({ source: 'manual', manualOverride: true });
  respondWith(() => jsonResponse(liraScopeBody()));

  await exchangeRateService.refreshFromApi();

  assert.strictEqual(fetchCalls.length, 0);
  assert.strictEqual((await storedRate()).usdToSyp, STORED_RATE);
  assert.ok(logs.some((l) => l.includes('manual rate is pinned')));
});

test('resetToApi: a failing LiraScope clears the manual pin but keeps the rate', async () => {
  await seedStoredRate({ source: 'manual', manualOverride: true });
  respondWith(() => new Response('', { status: 502 }));

  const rate = await exchangeRateService.resetToApi();

  assert.strictEqual(fetchCalls.length, 1);
  assert.strictEqual(rate.manualOverride, false);
  assert.strictEqual(rate.usdToSyp, STORED_RATE);
  assert.strictEqual(rate.source, 'manual');
});

test('resetToApi: a healthy LiraScope replaces the manual rate with the market mid', async () => {
  await seedStoredRate({ source: 'manual', manualOverride: true });
  respondWith(() => jsonResponse(liraScopeBody()));

  const rate = await exchangeRateService.resetToApi();

  assert.strictEqual(fetchCalls.length, 1);
  assert.strictEqual(rate.manualOverride, false);
  assert.strictEqual(rate.usdToSyp, MARKET_MID);
  assert.strictEqual(rate.source, 'api');
});

// --- Cache cycle ------------------------------------------------------------

test('cache: an empty boot fetches once, reads never fetch, the daily tick refreshes', async () => {
  const { timeouts, intervals } = captureRefreshTimers();

  let marketMid = MARKET_MID;
  respondWith(() => jsonResponse(liraScopeBody({ marketUsd: usdEntry({ mid: marketMid }) })));

  // Request 1 - nothing stored yet: cache miss -> LiraScope -> stored.
  await exchangeRateService.startScheduledRefresh();
  assert.strictEqual(fetchCalls.length, 1);
  assert.strictEqual((await storedRate()).usdToSyp, MARKET_MID);
  assert.strictEqual(timeouts.length, 1, 'the next 09:00 tick is scheduled');
  assert.ok(timeouts[0].ms > 0 && timeouts[0].ms <= DAY_MS);

  // Request 2 - the public endpoint and order pricing read the stored rate
  // only: cache hit, no LiraScope request.
  assert.deepStrictEqual(await callPublicRate(), { success: true, usdToSyp: MARKET_MID });
  assert.strictEqual((await exchangeRateService.getRate()).usdToSyp, MARKET_MID);
  assert.strictEqual((await exchangeRateService.captureFxSnapshot()).rate, MARKET_MID);
  assert.strictEqual(fetchCalls.length, 1, 'reads never reach LiraScope');

  // A restart with a rate already stored waits for the tick instead.
  await exchangeRateService.startScheduledRefresh();
  assert.strictEqual(fetchCalls.length, 1, 'a restart does not refetch');
  assert.ok(logs.some((l) => l.includes('skipping the boot-time fetch')));

  // Request 3 - the 09:00 tick (the stored rate's TTL running out): cache
  // miss -> LiraScope -> refreshed, and the 24h interval starts.
  marketMid = 137.5;
  timeouts[0].fn();
  await waitFor(async () => (await storedRate()).usdToSyp === 137.5, 'the 09:00 refresh');
  assert.strictEqual(fetchCalls.length, 2);
  assert.strictEqual(intervals.length, 1);
  assert.strictEqual(intervals[0].ms, DAY_MS);
  assert.deepStrictEqual(await callPublicRate(), { success: true, usdToSyp: 137.5 });
  assert.strictEqual(fetchCalls.length, 2);

  // Each following day the interval refreshes again.
  marketMid = 138;
  await intervals[0].fn();
  assert.strictEqual(fetchCalls.length, 3);
  assert.strictEqual((await storedRate()).usdToSyp, 138);
  assert.deepStrictEqual(
    (await ExchangeRateHistory.find().sort({ _id: 1 }).lean()).map((r) => r.usdToSyp),
    [MARKET_MID, 137.5, 138]
  );
});

// --- Snapshot ---------------------------------------------------------------

// The freeze itself (orders, payments and ledger entries keeping their rate
// after the singleton moves) is covered end-to-end in fx.freeze.test.js; this
// checks that a LiraScope-sourced rate feeds that snapshot the same way.
test('snapshot: captures the stored LiraScope rate, and a later refresh only prices new events', async () => {
  respondWith(() => jsonResponse(liraScopeBody()));
  await exchangeRateService.refreshFromApi();
  const stored = await storedRate();

  const snapshot = await exchangeRateService.captureFxSnapshot();
  assert.deepStrictEqual(snapshot, {
    rate: MARKET_MID,
    source: 'api',
    rateAsOf: stored.lastUpdated,
    estimated: false,
  });

  respondWith(() => jsonResponse(liraScopeBody({ marketUsd: usdEntry({ mid: 140 }) })));
  await exchangeRateService.refreshFromApi();

  assert.strictEqual(snapshot.rate, MARKET_MID);
  assert.strictEqual((await exchangeRateService.captureFxSnapshot()).rate, 140);
});
