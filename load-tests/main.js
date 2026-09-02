import http from 'k6/http';
import { sleep } from 'k6';
import exec from 'k6/execution';
import {
  baseUrl, params, record, identity, endpointThresholds, simulateClientIps,
} from './lib/runtime.js';
import { thresholds } from './thresholds.js';
import { me, authenticationFlow } from './scenarios/auth.js';
import { browse, search, browseByManufacturer, homeScreen } from './scenarios/browsing.js';
import { shoppingFlow } from './scenarios/cart.js';
import { orderFlow, orderDetailDirect } from './scenarios/orders.js';
import { returnsFlow } from './scenarios/returns.js';
import { reviewFlow } from './scenarios/reviews.js';
import { readWarehouse, warehousePanel } from './scenarios/warehouse.js';

// ---------------------------------------------------------------------------
// Execution profile
// ---------------------------------------------------------------------------
//
// One level per k6 process, driven by run-progressive.js. RAMP/HOLD are given
// in k6 duration strings; the ramp is what Phase 5 asks for (no instant
// creation of thousands of VUs) and the hold is the steady state the level's
// numbers are actually taken from.
const targetVus = Number(__ENV.VUS || 10);
const ramp = __ENV.RAMP || '30s';
const hold = __ENV.HOLD || '60s';
const rampDown = __ENV.RAMP_DOWN || '10s';

export const options = {
  scenarios: {
    session: {
      executor: 'ramping-vus',
      startVUs: 0,
      gracefulRampDown: '10s',
      gracefulStop: '15s',
      stages: [
        { duration: ramp, target: targetVus },
        { duration: hold, target: targetVus },
        { duration: rampDown, target: 0 },
      ],
    },
  },
  thresholds: { ...thresholds, ...endpointThresholds() },
  // Percentiles the report needs; k6's default trend stats omit p90 and p99.
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  // Without this k6 discards the response body for tagged requests it deems
  // uninteresting; the browse scenario needs the pagination cursor.
  discardResponseBodies: false,
  noConnectionReuse: false,
  // The default 250k is far below the socket count 2,000+ VUs need on Windows.
  batchPerHost: 0,
};

export function setup() {
  const health = http.get(baseUrl + '/health', params(null, 'health'));
  record(health, 'health');
  if (health.status !== 200) {
    throw new Error('Backend health check failed with HTTP ' + health.status +
      ' - refusing to start a load level against an unhealthy target.');
  }
  return { startedAt: new Date().toISOString(), simulateClientIps };
}

// ---------------------------------------------------------------------------
// Traffic mix
// ---------------------------------------------------------------------------
//
// Weighted to a pharmacy-app population: mostly people looking at catalogs,
// a smaller share checking orders, a small share shopping, and a thin slice
// of logins, reviews, returns and warehouse-panel polling.
//
// The bucket mixes the VU id with the iteration number rather than using the
// VU id alone. Keyed on the VU id only, a 10-VU level would run VUs 1-10 and
// therefore never leave the first bucket, so the low levels would exercise a
// different set of endpoints than the high ones and the levels would not be
// comparable. Mixing in the iteration also matches how one real user behaves:
// they browse, then check an order, then shop - not the same action forever.
// The multipliers are coprime with 100 so the walk covers every bucket.
export default function () {
  const user = identity();
  const token = user.token;
  const bucket = (exec.vu.idInTest * 17 + exec.scenario.iterationInTest * 31) % 100;

  // Session validation: the Flutter app calls /auth/me on every launch and on
  // every resume, so it rides along with whatever the user then does.
  me(token);

  if (bucket < 40) {
    // Scenario B - browsing (40%)
    homeScreen(token);
    browse(token);
  } else if (bucket < 55) {
    // Scenario B - search (15%)
    search(token, 'Medicine');
  } else if (bucket < 62) {
    // Scenario B - manufacturer filter (7%)
    browseByManufacturer(token, 'Manufacturer Alpha');
  } else if (bucket < 77) {
    // Scenario D - order history (15%)
    orderFlow(token);
  } else if (bucket < 82) {
    // Scenario D - direct order detail (5%)
    orderDetailDirect(token);
  } else if (bucket < 90) {
    // Scenario C - shopping (8%)
    shoppingFlow(token);
  } else if (bucket < 94) {
    // Scenario E - returns, read paths (4%)
    returnsFlow(token);
  } else if (bucket < 97) {
    // Scenario F - reviews (3%)
    reviewFlow(token);
  } else if (bucket < 99) {
    // Scenario A - full login (2%)
    authenticationFlow();
  } else {
    // Warehouse panel + pharmacist warehouse detail (1%)
    readWarehouse(token);
    warehousePanel();
  }

  // Think time. Without it every VU becomes a closed-loop hammer and "2,000
  // VUs" would mean 2,000 requests in flight at all times, which no real
  // population of 2,000 app users produces.
  sleep(Number(__ENV.THINK_MIN || 1) + Math.random() * Number(__ENV.THINK_SPREAD || 2));
}

export function handleSummary(data) {
  const out = __ENV.RESULT_JSON || 'load-tests/results/summary.json';
  return {
    [out]: JSON.stringify(data),
    stdout: 'level VUs=' + targetVus +
      ' reqs=' + (data.metrics.http_reqs ? data.metrics.http_reqs.values.count : 0) +
      ' rps=' + (data.metrics.http_reqs ? data.metrics.http_reqs.values.rate.toFixed(1) : 0) +
      ' p95=' + (data.metrics.http_req_duration ? data.metrics.http_req_duration.values['p(95)'].toFixed(0) : 0) + 'ms' +
      ' fail=' + (data.metrics.http_req_failed ? (data.metrics.http_req_failed.values.rate * 100).toFixed(2) : 0) + '%\n',
  };
}
