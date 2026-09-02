/**
 * Logs every fixture account in once and writes the resulting JWTs to
 * .runtime/tokens.json for the k6 scripts to `open()`.
 *
 * Two reasons this is done here rather than in k6's own setup():
 *  - POST /auth/login-password is bcrypt-bound (cost 10). Re-logging in on
 *    every iteration would measure bcrypt, not the endpoint under test.
 *  - /auth/* sits behind authLimiter (20 requests / 15 min / IP), so a login
 *    storm from one address returns 429 long before any real load is applied.
 *    Each login here carries its own X-Forwarded-For, which `trust proxy: 1`
 *    makes express-rate-limit key on - one simulated client IP per account.
 *
 * The wall-clock time this takes is itself a measurement: it is the
 * concurrent-login throughput of the service, reported at the end.
 */
const fs = require('node:fs');
const path = require('node:path');

const RUNTIME_DIR = path.join(__dirname, '..', '.runtime');
const fixtures = JSON.parse(fs.readFileSync(path.join(RUNTIME_DIR, 'load-fixtures.json'), 'utf8'));
const BASE = process.env.BASE_URL || fixtures.baseUrl;
// Concurrency of the login burst. bcrypt runs on libuv's threadpool (4 by
// default), so pushing far past that only queues; 32 keeps the socket layer
// busy without turning this into a self-inflicted stress test.
const CONCURRENCY = Number(process.env.MINT_CONCURRENCY || 32);

function ipFor(index) {
  // 10.x.y.z, one distinct simulated client IP per account.
  return '10.' + (128 + ((index >> 16) & 63)) + '.' + ((index >> 8) & 255) + '.' + (index & 255);
}

async function login(phone, index) {
  const started = process.hrtime.bigint();
  const response = await fetch(BASE + '/auth/login-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ipFor(index) },
    body: JSON.stringify({ phone, password: fixtures.password }),
  });
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  if (!response.ok) {
    const text = await response.text();
    throw new Error('login ' + phone + ' -> HTTP ' + response.status + ' ' + text.slice(0, 200));
  }
  const body = await response.json();
  if (!body.token) throw new Error('login ' + phone + ' returned no token');
  return { phone, token: body.token, ms };
}

async function mintAll(phones, label) {
  const results = new Array(phones.length);
  const latencies = [];
  let cursor = 0;
  const started = Date.now();
  async function worker() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= phones.length) return;
      const result = await login(phones[index], index);
      results[index] = result;
      latencies.push(result.ms);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, phones.length) }, worker));
  const elapsedSec = (Date.now() - started) / 1000;
  latencies.sort((a, b) => a - b);
  const pick = (q) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * q))];
  console.log(
    '[mint] ' + label + ': ' + phones.length + ' logins in ' + elapsedSec.toFixed(2) + 's = ' +
    (phones.length / elapsedSec).toFixed(1) + ' logins/sec' +
    '  (concurrency ' + CONCURRENCY + ', p50 ' + Math.round(pick(0.5)) + 'ms, p95 ' +
    Math.round(pick(0.95)) + 'ms, max ' + Math.round(latencies[latencies.length - 1]) + 'ms)'
  );
  return {
    tokens: results,
    loginsPerSecond: Number((phones.length / elapsedSec).toFixed(2)),
    concurrency: CONCURRENCY,
    p50Ms: Math.round(pick(0.5)),
    p95Ms: Math.round(pick(0.95)),
    maxMs: Math.round(latencies[latencies.length - 1]),
    count: phones.length,
    elapsedSec: Number(elapsedSec.toFixed(2)),
  };
}

async function main() {
  const pharmacy = await mintAll(fixtures.pharmacyPhones, 'pharmacy accounts');
  const warehouse = await mintAll(fixtures.socketWarehousePhones, 'warehouse accounts (socket)');

  const payload = {
    baseUrl: BASE,
    mintedAt: new Date().toISOString(),
    loginThroughput: {
      pharmacy: {
        count: pharmacy.count, elapsedSec: pharmacy.elapsedSec,
        loginsPerSecond: pharmacy.loginsPerSecond, concurrency: pharmacy.concurrency,
        p50Ms: pharmacy.p50Ms, p95Ms: pharmacy.p95Ms, maxMs: pharmacy.maxMs,
      },
      warehouse: {
        count: warehouse.count, elapsedSec: warehouse.elapsedSec,
        loginsPerSecond: warehouse.loginsPerSecond, concurrency: warehouse.concurrency,
        p50Ms: warehouse.p50Ms, p95Ms: warehouse.p95Ms, maxMs: warehouse.maxMs,
      },
    },
    // Ordered to match fixtures.pharmacyPhones, so a VU can index both lists
    // with the same number and stay on one consistent identity.
    pharmacyTokens: pharmacy.tokens.map((t) => ({ phone: t.phone, token: t.token })),
    warehouseTokens: warehouse.tokens.map((t) => ({ phone: t.phone, token: t.token })),
  };
  fs.writeFileSync(path.join(RUNTIME_DIR, 'tokens.json'), JSON.stringify(payload));
  fs.writeFileSync(
    path.join(RUNTIME_DIR, 'login-throughput.json'),
    JSON.stringify(payload.loginThroughput, null, 2)
  );
  console.log('[mint] wrote ' + payload.pharmacyTokens.length + ' pharmacy + ' +
    payload.warehouseTokens.length + ' warehouse tokens');
}

main().catch((error) => {
  console.error('[mint] FAILED: ' + error.message);
  process.exitCode = 1;
});
