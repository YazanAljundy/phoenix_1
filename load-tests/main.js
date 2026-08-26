import http from 'k6/http';
import { check, sleep } from 'k6';
import { assertConfiguration, baseUrl, testOptions, testUsers, testPhones, testPassword } from './config.js';
import { thresholds } from './thresholds.js';
import { me } from './scenarios/auth.js';
import { browse } from './scenarios/browsing.js';
import { readWarehouse } from './scenarios/warehouse.js';
import { cart } from './scenarios/cart.js';
import { orders } from './scenarios/orders.js';
import { recordStatus } from './scenarios/metrics.js';

export const options = {
  ...testOptions(),
  thresholds,
};

export function setup() {
  assertConfiguration();
  const health = http.get(`${baseUrl}/health`, { tags: { endpoint: 'health' } });
  recordStatus(health, 'health');
  check(health, { 'health returns 200': (response) => response.status === 200 });
  const credentials = testUsers.length ? testUsers : testPhones.map((phone) => ({ phone, password: testPassword }));
  const tokens = credentials.map((user) => {
    const response = http.post(`${baseUrl}/auth/login-password`, JSON.stringify(user), {
      headers: { 'Content-Type': 'application/json' }, tags: { endpoint: 'auth_login_password' },
    });
    recordStatus(response, 'auth_login_password');
    check(response, { 'setup login returns 200': (item) => item.status === 200 });
    try { return response.json().token; } catch (_) { return null; }
  });
  if (tokens.some((token) => !token)) throw new Error('Authentication setup failed for a dedicated test user.');
  return { tokens };
}

export default function (data) {
  const token = data.tokens[(__VU - 1) % data.tokens.length];
  me(token);

  const bucket = (__VU % 20);
  if (bucket < 12) browse(token);
  else if (bucket < 16) browse(token, 'medicine');
  else if (bucket < 18) cart(token);
  else if (bucket < 19) orders(token);
  else readWarehouse(token);
  sleep(Math.random() * 2 + 1);
}

export function handleSummary(data) {
  const metrics = data.metrics;
  const outputPath = __ENV.RESULT_JSON || 'load-tests/results/k6-summary.json';
  return {
    [outputPath]: JSON.stringify(data),
    stdout: `requests=${metrics.http_reqs ? metrics.http_reqs.count : 0}, ` +
      `rps=${metrics.http_reqs ? metrics.http_reqs.rate.toFixed(2) : 0}, ` +
      `failed=${metrics.http_req_failed ? (metrics.http_req_failed.rate * 100).toFixed(2) : 0}%\n`,
  };
}
