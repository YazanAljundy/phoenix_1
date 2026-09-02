// Regression tests for the rate-limit strategy.
//
// The limiter used to be a flat 300 requests / 15 min keyed on IP for every
// route, which meant everyone behind one NAT/CGNAT address shared a single
// quota. These tests pin the three properties that fix has to have:
//   1. two authenticated users from the SAME address do not share a quota,
//   2. one user cannot escape their own quota by changing address,
//   3. an unauthenticated caller is still limited by address, and a forged or
//      expired token buys no extra quota.
//
// Driven through a real Express app on an ephemeral port, configured the same
// way app.js configures the real one (trust proxy 1), so req.ip resolution is
// the genuine article rather than a stub.
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/phoenix-ratelimit-test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-ratelimit-tests';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');
const jwt = require('jsonwebtoken');

const { apiLimiter, authLimiter, _identify, _limits } = require('../src/middlewares/rateLimiter');

const { AUTHENTICATED_LIMIT, ANONYMOUS_LIMIT } = _limits;

function tokenFor(userId, options = {}) {
  return jwt.sign({ sub: userId, role: 'pharmacy' }, process.env.JWT_SECRET, options);
}

// One server per test file; each test isolates itself by using distinct user
// ids and IPs, since the limiter's memory store is process-wide.
let server;
let baseUrl;

test.before(async () => {
  const app = express();
  app.set('trust proxy', 1);
  app.use('/api', apiLimiter);
  app.use('/api/auth/login-password', authLimiter);
  app.get('/api/ping', (req, res) => res.json({ ok: true }));
  app.post('/api/auth/login-password', (req, res) => res.json({ ok: true }));

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function hit(path, { ip, token, method = 'GET' } = {}) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: {
      ...(ip ? { 'X-Forwarded-For': ip } : {}),
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
  });
  return response.status;
}

// Sends `count` requests sequentially and returns how many were rejected.
async function hitMany(count, path, options) {
  let rejected = 0;
  for (let i = 0; i < count; i += 1) {
    const status = await hit(path, options);
    if (status === 429) rejected += 1;
  }
  return rejected;
}

// ---------------------------------------------------------------------------
// Keying strategy
// ---------------------------------------------------------------------------

test('a valid token identifies the caller by account', () => {
  const req = { headers: { authorization: 'Bearer ' + tokenFor('user-abc') } };
  assert.strictEqual(_identify(req), 'user-abc');
});

test('a forged or malformed token is not trusted as an identity', () => {
  for (const header of [
    'Bearer not-a-jwt',
    'Bearer ' + jwt.sign({ sub: 'attacker' }, 'the-wrong-secret'),
    'Basic abc',
    '',
  ]) {
    assert.strictEqual(
      _identify({ headers: { authorization: header } }),
      null,
      `"${header.slice(0, 24)}" must fall back to IP keying`
    );
  }
});

test('an expired token is not trusted as an identity', () => {
  const expired = tokenFor('user-expired', { expiresIn: -10 });
  assert.strictEqual(_identify({ headers: { authorization: 'Bearer ' + expired } }), null);
});

// ---------------------------------------------------------------------------
// The NAT fix
// ---------------------------------------------------------------------------

test('normal browsing well past the old 300 cap is not blocked for one user', async () => {
  const token = tokenFor('browse-user');
  const requests = ANONYMOUS_LIMIT + 50; // 350: over the old flat cap
  const rejected = await hitMany(requests, '/api/ping', { ip: '203.0.113.10', token });
  assert.strictEqual(
    rejected, 0,
    `a single user making ${requests} requests must not be throttled (old limit was ${ANONYMOUS_LIMIT})`
  );
});

test('two different users behind the same address do not share a quota', async () => {
  const sharedIp = '203.0.113.20';
  const first = tokenFor('nat-user-1');
  const second = tokenFor('nat-user-2');

  // Spend a large slice of the first user's allowance.
  const firstRejected = await hitMany(400, '/api/ping', { ip: sharedIp, token: first });
  assert.strictEqual(firstRejected, 0);

  // The second user, same address, must be completely unaffected. This is the
  // exact case that produced 99.24% 429s before.
  const secondStatus = await hit('/api/ping', { ip: sharedIp, token: second });
  assert.strictEqual(secondStatus, 200, 'a second user behind the same NAT must not inherit the first user\'s usage');
});

test('a user cannot reset their quota by changing address', async () => {
  const token = tokenFor('roaming-user');
  const spent = AUTHENTICATED_LIMIT - 2;
  await hitMany(spent, '/api/ping', { ip: '203.0.113.30', token });

  // Two left, from a completely different address.
  assert.strictEqual(await hit('/api/ping', { ip: '198.51.100.77', token }), 200);
  assert.strictEqual(await hit('/api/ping', { ip: '198.51.100.88', token }), 200);
  assert.strictEqual(
    await hit('/api/ping', { ip: '198.51.100.99', token }), 429,
    'the account quota must follow the account, not the address'
  );
});

// ---------------------------------------------------------------------------
// Protection that must remain
// ---------------------------------------------------------------------------

test('unauthenticated traffic is still limited per address', async () => {
  const ip = '203.0.113.40';
  const rejected = await hitMany(ANONYMOUS_LIMIT, '/api/ping', { ip });
  assert.strictEqual(rejected, 0, 'the anonymous allowance itself must not be reduced');
  assert.strictEqual(
    await hit('/api/ping', { ip }), 429,
    'an anonymous caller must still be cut off past the anonymous limit'
  );
});

test('a garbage token cannot be used to mint unlimited buckets', async () => {
  const ip = '203.0.113.50';
  // Exhaust the address's anonymous allowance.
  await hitMany(ANONYMOUS_LIMIT, '/api/ping', { ip });
  // Rotating invalid tokens must keep landing in that same exhausted bucket.
  for (const junk of ['Bearer aaa', 'Bearer bbb', 'Bearer ccc']) {
    const response = await fetch(baseUrl + '/api/ping', {
      headers: { 'X-Forwarded-For': ip, Authorization: junk },
    });
    assert.strictEqual(response.status, 429, 'an invalid token must not create a fresh quota');
  }
});

test('the login endpoint keeps its strict per-address limit', async () => {
  const ip = '203.0.113.60';
  const options = { ip, method: 'POST' };
  const rejected = await hitMany(20, '/api/auth/login-password', options);
  assert.strictEqual(rejected, 0, 'the first 20 login attempts are allowed, as before');
  assert.strictEqual(
    await hit('/api/auth/login-password', options), 429,
    'credential stuffing from one address must still be cut off at 20'
  );
});

test('429 responses keep their existing body shape', async () => {
  const ip = '203.0.113.70';
  await hitMany(ANONYMOUS_LIMIT, '/api/ping', { ip });
  const response = await fetch(baseUrl + '/api/ping', { headers: { 'X-Forwarded-For': ip } });
  assert.strictEqual(response.status, 429);
  assert.deepStrictEqual(await response.json(), {
    success: false,
    message: 'Too many requests. Please try again later.',
  });
  assert.ok(response.headers.get('ratelimit-limit'), 'standardHeaders must stay enabled');
  assert.strictEqual(response.headers.get('x-ratelimit-limit'), null, 'legacyHeaders must stay disabled');
});
