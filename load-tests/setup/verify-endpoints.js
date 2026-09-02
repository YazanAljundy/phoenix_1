/**
 * Single-request correctness + baseline-latency probe for every endpoint the
 * load scenarios touch. Run before any load level so a later failure can be
 * attributed to load rather than to a broken request shape.
 *
 * Each call uses its own X-Forwarded-For value. The backend sets
 * `trust proxy: 1`, so express-rate-limit keys its buckets on that header;
 * distinct values model distinct client IPs and keep this probe from
 * consuming the shared 300-per-15-minute allowance. See RATE_LIMITING notes
 * in the report.
 */
const fs = require('node:fs');
const path = require('node:path');

const fixtures = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '.runtime', 'load-fixtures.json'), 'utf8')
);
const BASE = process.env.BASE_URL || fixtures.baseUrl;

let ipCounter = 0;
function nextIp() {
  ipCounter += 1;
  return '10.' + ((ipCounter >> 16) & 255) + '.' + ((ipCounter >> 8) & 255) + '.' + (ipCounter & 255);
}

async function timed(label, method, url, { token, body, headers } = {}) {
  const started = process.hrtime.bigint();
  let status = 0;
  let json = null;
  let error = null;
  try {
    const response = await fetch(url, {
      method,
      headers: {
        'X-Forwarded-For': nextIp(),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    status = response.status;
    try { json = await response.json(); } catch (_) { json = null; }
  } catch (err) {
    error = err.message;
  }
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  const ok = status >= 200 && status < 300;
  console.log(
    (ok ? 'OK  ' : 'FAIL') + '  ' + String(Math.round(ms)).padStart(6) + ' ms  ' +
    String(status).padStart(3) + '  ' + label + (error ? '  ERROR: ' + error : '')
  );
  return { ok, status, json, ms };
}

async function main() {
  console.log('BASE_URL = ' + BASE);
  console.log('--- unauthenticated ---');
  await timed('GET  /health', 'GET', BASE + '/health');

  console.log('--- auth ---');
  const phone = fixtures.pharmacyPhones[0];
  const login = await timed('POST /auth/login-password', 'POST', BASE + '/auth/login-password', {
    body: { phone, password: fixtures.password },
  });
  if (!login.ok) {
    console.error('Login failed, cannot continue: ' + JSON.stringify(login.json));
    process.exitCode = 1;
    return;
  }
  const token = login.json.token;
  await timed('GET  /auth/me', 'GET', BASE + '/auth/me', { token });

  console.log('--- catalog reads ---');
  const warehouses = await timed('GET  /warehouses', 'GET', BASE + '/warehouses', { token });
  console.log('     warehouses returned: ' + (warehouses.json && warehouses.json.warehouses
    ? warehouses.json.warehouses.length : 'n/a'));
  await timed('GET  /categories', 'GET', BASE + '/categories', { token });
  await timed('GET  /banners/active', 'GET', BASE + '/banners/active', { token });
  await timed('GET  /exchange-rate', 'GET', BASE + '/exchange-rate', { token });
  await timed('GET  /pharmacy/debts', 'GET', BASE + '/pharmacy/debts', { token });

  for (const warehouse of fixtures.catalogWarehouses) {
    console.log('--- warehouse catalog (' + warehouse.size + ' products) ---');
    await timed('GET  /warehouses/:id/profile      [' + warehouse.size + ']', 'GET',
      BASE + '/warehouses/' + warehouse.id + '/profile', { token });
    await timed('GET  /warehouses/:id/manufacturers[' + warehouse.size + ']', 'GET',
      BASE + '/warehouses/' + warehouse.id + '/manufacturers', { token });
    const list = await timed('GET  /warehouses/:id/products?limit=20 [' + warehouse.size + ']', 'GET',
      BASE + '/warehouses/' + warehouse.id + '/products?limit=20', { token });
    const cursor = list.json && list.json.pagination && list.json.pagination.nextCursor;
    if (cursor) {
      await timed('GET  /warehouses/:id/products (page 2)  [' + warehouse.size + ']', 'GET',
        BASE + '/warehouses/' + warehouse.id + '/products?limit=20&after=' + cursor, { token });
    }
    await timed('GET  /warehouses/:id/products?search=  [' + warehouse.size + ']', 'GET',
      BASE + '/warehouses/' + warehouse.id + '/products?search=Medicine', { token });
  }

  console.log('--- orders / returns / reviews ---');
  await timed('GET  /orders?limit=15', 'GET', BASE + '/orders?limit=15', { token });
  const orderIds = fixtures.deliveredOrdersByPhone[phone];
  await timed('GET  /orders/:id', 'GET', BASE + '/orders/' + orderIds[0], { token });
  await timed('GET  /orders/returnable', 'GET', BASE + '/orders/returnable', { token });
  await timed('GET  /returns?limit=15', 'GET', BASE + '/returns?limit=15', { token });
  await timed('GET  /reviews', 'GET', BASE + '/reviews', { token });

  console.log('--- writes (fixture accounts only) ---');
  const created = await timed('POST /orders', 'POST', BASE + '/orders', {
    token,
    body: {
      warehouseId: fixtures.orderTargetWarehouseId,
      items: [{ productId: fixtures.orderTargetProductIds[0], quantity: 2 }],
      notes: '[LOADTEST] verify-endpoints',
    },
  });
  if (!created.ok) console.log('     order create response: ' + JSON.stringify(created.json));
  const review = await timed('POST /reviews', 'POST', BASE + '/reviews', {
    token,
    body: { orderId: orderIds[0], rating: 5, comment: '[LOADTEST] verify-endpoints' },
  });
  if (!review.ok) console.log('     review create response: ' + JSON.stringify(review.json));

  console.log('--- socket-capable account ---');
  const socketLogin = await timed('POST /auth/login-password (warehouse role)', 'POST',
    BASE + '/auth/login-password', {
      body: { phone: fixtures.socketWarehousePhones[0], password: fixtures.password },
    });
  console.log('     warehouse token acquired: ' + Boolean(socketLogin.json && socketLogin.json.token));
}

main().catch((error) => {
  console.error('verify FAILED: ' + error.message);
  process.exitCode = 1;
});
