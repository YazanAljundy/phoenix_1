// Testing thresholds, not an application SLA.
//
// These are the values this repository already used before the full-system
// suite existed (p95 < 1s, p99 < 2s, HTTP failures < 1%) and Phase 7 asks that
// a project's own thresholds win over the generic ones, so they are kept
// unchanged. The finer grading bands used to label each load level
// PASS / DEGRADED / FAIL live in run-progressive.js, which classifies a level
// after the fact instead of aborting it - a level has to be allowed to fail in
// order to find the breaking point.
//
// The `checks` threshold the previous version carried is gone: the suite now
// records outcomes through the per-endpoint error counters in lib/runtime.js
// rather than through check(), and a threshold on a metric that is never
// emitted is a false green.
export const thresholds = {
  http_req_duration: ['p(95)<1000', 'p(99)<2000'],
  http_req_failed: ['rate<0.01'],
};

// Grading bands applied by the runner (Phase 7).
export const bands = {
  errorRate: { healthy: 0.01, degraded: 0.05 },
  p95Ms: { healthy: 500, degraded: 1000 },
  p99Ms: { seriousMs: 2000 },
};
