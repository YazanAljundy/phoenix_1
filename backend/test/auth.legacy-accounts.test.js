// Accounts that predate a schema addition must still be able to sign in.
//
// The bug this pins: pharmacy.model.js's areaType is `required: true`, but
// that constrains WRITES only. Rows created before the field existed have no
// value for it until scripts/backfill-pharmacy-area-type.js has run, so
// serializePharmacy emitted `areaType: undefined`, JSON.stringify dropped the
// key, and PharmacyModel.fromJson's `json['areaType'] as String` threw a
// TypeError the pharmacy app's auth cubit did not catch - an endless login
// spinner, with the backend answering 200 the entire time. Every pre-areaType
// pharmacy was locked out of the app by a response the server considered fine.
//
// Documents are inserted through the NATIVE driver on purpose: going through
// Mongoose would apply the very defaults whose absence is the whole point.
process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test-secret-for-legacy-account-tests-0123456789';
process.env.NODE_ENV = 'test';
process.env.DISABLE_AUTH_RATE_LIMIT = '1';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const bcrypt = require('bcrypt');
const mongoose = require('mongoose');

const { startMemoryMongo, stopMemoryMongo } = require('./helpers/mongo');

const app = require('../src/app');

let server;
let baseUrl;

test.before(async () => {
  await startMemoryMongo();
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await stopMemoryMongo();
});

// Exactly the shape a User had before the auth-audit round: no tokenVersion,
// no failedLoginAttempts, no lockedUntil, no deletedAt.
async function insertLegacyUser({ phone, role = 'pharmacy', status = 'active' }) {
  const password = await bcrypt.hash('secret123', 10);
  const { insertedId } = await mongoose.connection.collection('users').insertOne({
    name: 'Legacy Account',
    phone,
    password,
    role,
    status,
    lang: 'ar',
    deviceTokens: [],
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    __v: 0,
  });
  return insertedId;
}

// A Pharmacy as it was before the package-availability round added areaType.
async function insertLegacyPharmacy(userId, phone) {
  await mongoose.connection.collection('pharmacies').insertOne({
    userId,
    nameAr: 'Legacy AR',
    nameEn: 'Old Pharmacy',
    ownerName: 'Old Owner',
    address: 'Somewhere',
    city: 'Latakia',
    phone,
    addedBy: 'self',
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    __v: 0,
  });
}

async function post(path, body, token) {
  const response = await fetch(baseUrl + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test('a pre-audit User document can sign in with a password', async () => {
  const phone = '0912000001';
  const userId = await insertLegacyUser({ phone });
  await insertLegacyPharmacy(userId, phone);

  const { status, body } = await post('/api/auth/login-password', {
    phone,
    password: 'secret123',
  });

  assert.strictEqual(status, 200);
  assert.ok(body.token, 'expected an access token');
  assert.ok(body.refreshToken, 'expected a refresh token');
});

test('the login response always carries an areaType, even for a legacy row', async () => {
  const phone = '0912000002';
  const userId = await insertLegacyUser({ phone });
  await insertLegacyPharmacy(userId, phone);

  const { status, body } = await post('/api/auth/login-password', {
    phone,
    password: 'secret123',
  });

  assert.strictEqual(status, 200);
  // The key has to be PRESENT, not merely non-null: JSON.stringify drops an
  // undefined value entirely, which is precisely what broke the client.
  assert.ok(
    Object.prototype.hasOwnProperty.call(body.pharmacy, 'areaType'),
    'pharmacy payload must include an areaType key'
  );
  assert.ok(body.pharmacy.areaType, 'areaType must have a usable value');
  assert.ok(
    ['city', 'city_ring', 'rural'].includes(body.pharmacy.areaType),
    `areaType must be one of the three allowed values, got ${body.pharmacy.areaType}`
  );
});

test('GET /auth/me carries an areaType for a legacy row too', async () => {
  const phone = '0912000003';
  const userId = await insertLegacyUser({ phone });
  await insertLegacyPharmacy(userId, phone);

  const login = await post('/api/auth/login-password', { phone, password: 'secret123' });
  assert.strictEqual(login.status, 200);

  const response = await fetch(baseUrl + '/api/auth/me', {
    headers: { Authorization: `Bearer ${login.body.token}` },
  });
  const body = await response.json();

  assert.strictEqual(response.status, 200);
  assert.ok(
    Object.prototype.hasOwnProperty.call(body.pharmacy, 'areaType'),
    '/auth/me payload must include an areaType key'
  );
  assert.ok(body.pharmacy.areaType, 'areaType must have a usable value');
});

test('a real areaType is never overwritten by the fallback', async () => {
  const phone = '0912000004';
  const userId = await insertLegacyUser({ phone });
  await mongoose.connection.collection('pharmacies').insertOne({
    userId,
    nameAr: 'Real AR',
    nameEn: 'Pharmacy',
    ownerName: 'Owner',
    address: 'Somewhere',
    city: 'Latakia',
    areaType: 'rural',
    phone,
    addedBy: 'self',
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    __v: 0,
  });

  const { status, body } = await post('/api/auth/login-password', {
    phone,
    password: 'secret123',
  });

  assert.strictEqual(status, 200);
  assert.strictEqual(body.pharmacy.areaType, 'rural');
});

test('a pre-audit User gets its throttling counters applied on the fly', async () => {
  const phone = '0912000005';
  const userId = await insertLegacyUser({ phone });
  await insertLegacyPharmacy(userId, phone);

  // A wrong password must count, not crash on an absent counter.
  const failed = await post('/api/auth/login-password', { phone, password: 'wrongpass' });
  assert.strictEqual(failed.status, 401);

  const stored = await mongoose.connection.collection('users').findOne({ _id: userId });
  assert.strictEqual(stored.failedLoginAttempts, 1);

  // ...and the correct password still works afterwards.
  const ok = await post('/api/auth/login-password', { phone, password: 'secret123' });
  assert.strictEqual(ok.status, 200);
});

test('a legacy warehouse account signs in unaffected', async () => {
  const phone = '0912000006';
  const userId = await insertLegacyUser({ phone, role: 'warehouse' });
  await mongoose.connection.collection('warehouses').insertOne({
    userId,
    nameAr: 'Warehouse AR',
    nameEn: 'Warehouse',
    city: 'Latakia',
    phone,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    __v: 0,
  });

  const { status, body } = await post('/api/auth/login-password', {
    phone,
    password: 'secret123',
  });

  assert.strictEqual(status, 200);
  assert.ok(body.token);
  assert.strictEqual(body.pharmacy, null);
});
