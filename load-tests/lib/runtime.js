/**
 * Shared k6 runtime helpers for the full-system suite.
 *
 * Fixture data and pre-minted JWTs are read from .runtime/*.json with open()
 * in the init context and shared across VUs through SharedArray, so 2,000 VUs
 * do not each hold their own copy of a 500-token list.
 */
import { SharedArray } from 'k6/data';
import exec from 'k6/execution';
import { Counter, Trend } from 'k6/metrics';

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

const rawFixtures = JSON.parse(open('../.runtime/load-fixtures.json'));
const rawTokens = JSON.parse(open('../.runtime/tokens.json'));

export const baseUrl = (__ENV.BASE_URL || rawFixtures.baseUrl).replace(/\/$/, '');

export const pharmacyTokens = new SharedArray('pharmacyTokens', () => rawTokens.pharmacyTokens);
export const warehouseTokens = new SharedArray('warehouseTokens', () => rawTokens.warehouseTokens);
export const catalogWarehouses = new SharedArray('catalogWarehouses', () => rawFixtures.catalogWarehouses);
export const orderProductIds = new SharedArray('orderProductIds', () => rawFixtures.orderTargetProductIds);

// One row per pharmacy: its token plus the delivered-order ids it owns. A
// write VU must only ever act on an order belonging to the identity it is
// authenticated as, or the API correctly answers 404 and the test would be
// measuring the IDOR guard instead of the write path.
export const identities = new SharedArray('identities', () =>
  rawTokens.pharmacyTokens.map((entry) => ({
    phone: entry.phone,
    token: entry.token,
    orderIds: rawFixtures.deliveredOrdersByPhone[entry.phone] || [],
  }))
);

export const orderTargetWarehouseId = rawFixtures.orderTargetWarehouseId;
export const fixturePassword = rawFixtures.password;
export const pharmacyPhones = new SharedArray('pharmacyPhones', () => rawFixtures.pharmacyPhones);

// ---------------------------------------------------------------------------
// Client-IP simulation
// ---------------------------------------------------------------------------
//
// app.js sets `trust proxy: 1`, so express-rate-limit keys its buckets on the
// X-Forwarded-For value rather than on the socket address. Real users arrive
// from distinct addresses; a load generator arrives from one. Sending a
// distinct XFF per request models the real deployment and keeps the 300-per-
// 15-minute apiLimiter from being the only thing this suite measures.
//
// The pool is bounded on purpose: express-rate-limit's MemoryStore keeps one
// entry per key for a whole window, so unbounded unique IPs would inflate the
// server's memory and confound the measurement. IP_POOL entries at 300
// requests each is the ceiling this suite can generate before the limiter
// engages - reported alongside every level.
//
// SIMULATE_CLIENT_IPS=false turns this off, which is the control test: it
// measures the system exactly as a single-egress-IP client sees it today.
export const simulateClientIps = __ENV.SIMULATE_CLIENT_IPS !== 'false';
const IP_POOL = Number(__ENV.IP_POOL || 60000);

let ipCursor = 0;
function nextClientIp() {
  // Offset by the VU id so two VUs never walk the pool in lockstep.
  ipCursor = (ipCursor + 1) % IP_POOL;
  const n = (ipCursor + exec.vu.idInTest * 7919) % IP_POOL;
  return '10.' + (64 + ((n >> 16) & 63)) + '.' + ((n >> 8) & 255) + '.' + (n & 255);
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export const endpointLatency = new Trend('endpoint_latency', true);
export const endpointReqs = new Counter('endpoint_reqs');
export const endpointErrors = new Counter('endpoint_errors');
export const http4xx = new Counter('http_4xx');
export const http5xx = new Counter('http_5xx');
export const http429 = new Counter('http_429');
export const httpTimeouts = new Counter('http_timeouts');

// Every endpoint tag the suite emits. Listed explicitly because k6 only
// materialises a tagged sub-metric in the summary when a threshold names it,
// and the per-endpoint p95/p99 table is the whole point of Phase 9.
export const ENDPOINTS = [
  'health',
  'auth_login_password',
  'auth_me',
  'warehouses_list',
  'warehouse_profile',
  'warehouse_manufacturers',
  'categories_list',
  'banners_active',
  'exchange_rate',
  'pharmacy_debts',
  'products_list',
  'products_page2',
  'products_search',
  'products_by_manufacturer',
  'orders_list',
  'order_detail',
  'orders_returnable',
  'orders_create',
  'returns_list',
  'reviews_list',
  'reviews_create',
  'warehouse_orders_list',
];

export function endpointThresholds() {
  const thresholds = {};
  for (const endpoint of ENDPOINTS) {
    // Permanently-satisfied thresholds, present only to force k6 to emit the
    // tagged sub-metric with full percentile stats into handleSummary().
    thresholds['endpoint_latency{endpoint:' + endpoint + '}'] = ['max>=0'];
    thresholds['endpoint_reqs{endpoint:' + endpoint + '}'] = ['count>=0'];
    thresholds['endpoint_errors{endpoint:' + endpoint + '}'] = ['count>=0'];
    // Same three, restricted to the steady-state window (see phase tagging
    // below): the ramp-up half of a level runs at a fraction of its target
    // load, so whole-run percentiles understate what the level actually did.
    thresholds['endpoint_latency{endpoint:' + endpoint + ',phase:steady}'] = ['max>=0'];
    thresholds['endpoint_reqs{endpoint:' + endpoint + ',phase:steady}'] = ['count>=0'];
    thresholds['endpoint_errors{endpoint:' + endpoint + ',phase:steady}'] = ['count>=0'];
  }
  thresholds['http_req_duration{phase:steady}'] = ['max>=0'];
  thresholds['http_reqs{phase:steady}'] = ['count>=0'];
  thresholds['http_req_failed{phase:steady}'] = ['rate>=0'];
  thresholds['http_429{phase:steady}'] = ['count>=0'];
  thresholds['http_5xx{phase:steady}'] = ['count>=0'];
  thresholds['http_4xx{phase:steady}'] = ['count>=0'];
  thresholds['http_timeouts{phase:steady}'] = ['count>=0'];
  return thresholds;
}

// ---------------------------------------------------------------------------
// Phase tagging
// ---------------------------------------------------------------------------
//
// A level is ramp -> steady -> ramp-down. Only the steady window represents
// the level's nominal concurrency, so every request is tagged with which
// window it fell in and the report reads the steady numbers. Derived from the
// same RAMP/HOLD values the executor stages are built from, in main.js.
function toMillis(duration) {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(String(duration).trim());
  if (!match) return 0;
  const value = Number(match[1]);
  const unit = match[2];
  if (unit === 'ms') return value;
  if (unit === 's') return value * 1000;
  if (unit === 'm') return value * 60000;
  return value * 3600000;
}

const rampMs = toMillis(__ENV.RAMP || '30s');
const holdMs = toMillis(__ENV.HOLD || '60s');

function currentPhase() {
  const elapsed = exec.instance.currentTestRunDuration;
  if (elapsed < rampMs) return 'ramp';
  if (elapsed < rampMs + holdMs) return 'steady';
  return 'down';
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

// `extra` is merged in last, for the one case that needs it: a request whose
// >=400 answer is correct. k6's built-in http_req_failed counts every status
// at or above 400 as a failure, so without a responseCallback the expected
// 409 ALREADY_REVIEWED responses would show up in the headline error rate as
// if the system were misbehaving.
export function params(token, endpoint, extra) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (simulateClientIps) headers['X-Forwarded-For'] = nextClientIp();
  return {
    headers,
    tags: { endpoint, phase: currentPhase() },
    ...extra,
    // Matches the Flutter client's Dio timeouts (api_client.dart: 15s connect
    // and 15s receive), so a request the real app would abandon is counted as
    // a timeout here too rather than waited out indefinitely.
    timeout: __ENV.REQ_TIMEOUT || '15s',
  };
}

// `expected` lists statuses that are a correct application answer for this
// call even though they are >= 400, so they are not counted as errors. The
// only user is reviews_create: a review is unique per order, so once a VU has
// rated every fixture order it owns, 409 ALREADY_REVIEWED is the right
// response and must not be scored as a failure. Raw status counters still
// record it, so the distinction stays visible in the report.
export function record(response, endpoint, expected) {
  const phase = currentPhase();
  const tags = { endpoint, phase };
  endpointLatency.add(response.timings.duration, tags);
  endpointReqs.add(1, tags);
  const status = response.status;
  if (status === 0) {
    // k6 reports 0 for a timeout, refused connection or reset.
    httpTimeouts.add(1, tags);
    endpointErrors.add(1, tags);
    return false;
  }
  if (status === 429) http429.add(1, tags);
  if (status >= 400 && status < 500) http4xx.add(1, tags);
  if (status >= 500) http5xx.add(1, tags);
  if (status >= 400) {
    if (expected && expected.indexOf(status) !== -1) return true;
    endpointErrors.add(1, tags);
    return false;
  }
  return true;
}

export function json(response) {
  try {
    return response.json();
  } catch (_) {
    return null;
  }
}

// A stable identity per VU: the same pharmacy for the whole test run, the way
// one real user keeps one session.
export function identity() {
  return identities[(exec.vu.idInTest - 1) % identities.length];
}

export function warehouseIdentity() {
  return warehouseTokens[(exec.vu.idInTest - 1) % warehouseTokens.length];
}

// Warehouses are picked per VU rather than at random, so the request mix each
// catalog size receives is stable between levels and comparable across them.
//
// CATALOG_SIZES restricts the rotation to catalogs of the given sizes. The
// default sweep spreads VUs across 200 / 1,000 / 5,000-product warehouses,
// which is the honest worst case but means a third of the traffic lands on the
// largest catalog. Setting CATALOG_SIZES=200 reruns the identical mix against
// a catalog the size of the one actually in this database, so the two capacity
// curves separate "the system is slow" from "the system is slow on large
// catalogs".
const catalogFilter = (__ENV.CATALOG_SIZES || '')
  .split(',').map((v) => Number(v.trim())).filter(Boolean);
// Built with an index loop rather than .filter(): SharedArray is a proxy over
// shared memory and does not expose the full Array prototype.
const selectedCatalogs = (() => {
  if (!catalogFilter.length) return null;
  const pool = [];
  for (let i = 0; i < catalogWarehouses.length; i += 1) {
    const warehouse = catalogWarehouses[i];
    if (catalogFilter.indexOf(warehouse.size) !== -1) pool.push(warehouse);
  }
  return pool;
})();

export function catalogWarehouse() {
  const pool = selectedCatalogs && selectedCatalogs.length ? selectedCatalogs : catalogWarehouses;
  return pool[(exec.vu.idInTest - 1) % pool.length];
}
