// POST /auth/register - the pharmacy account creation flow (Section 6-2).
// Drives the real Express app over HTTP, same pattern as
// financial.endpoints.test.js, so the controller's own validation (not just
// the service) is what's actually under test.
//
// Covers the areaType field added alongside the registration screen's new
// dropdown: required, and restricted to the three known values.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-auth-register-tests';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const mongoose = require('mongoose');

const { startMemoryMongo, stopMemoryMongo } = require('./helpers/mongo');

const app = require('../src/app');
const Pharmacy = require('../src/models/pharmacy.model');

let server;
let baseUrl;
let phoneCounter = 0;

async function call(method, path, { body } = {}) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: response.status, body: json };
}

// A fresh phone per call - registerOrLogin treats a phone that already has an
// account as a re-entry (logs it back in, ignores the new form fields), which
// would silently hide a validation bug this suite is trying to catch.
function nextPayload(overrides = {}) {
  phoneCounter += 1;
  return {
    name: 'Sami Alpha',
    pharmacyName: 'Alpha Pharmacy',
    phone: `09310${String(10000 + phoneCounter).slice(-5)}`,
    address: 'Some street',
    areaType: 'city',
    password: 'Password123',
    confirmPassword: 'Password123',
    ...overrides,
  };
}

test.before(async () => {
  await startMemoryMongo({ dbName: 'feniq-auth-register-test' });
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await stopMemoryMongo();
});

test('rejects registration with no areaType at all', async () => {
  const payload = nextPayload();
  delete payload.areaType;

  const { status, body } = await call('POST', '/auth/register', { body: payload });

  assert.strictEqual(status, 400);
  assert.strictEqual(body.success, false);
});

test('rejects registration with an areaType outside the enum', async () => {
  const { status, body } = await call('POST', '/auth/register', {
    body: nextPayload({ areaType: 'suburb' }),
  });

  assert.strictEqual(status, 400);
  assert.strictEqual(body.success, false);
});

// --- pharmacy.model.js's own schema validation ------------------------------
//
// The controller's requireAreaType (tested above over HTTP) is a fast-path,
// clean-400 check - it never touches the database. These two go around it
// entirely and call Pharmacy.create() directly, proving areaType is now also
// a genuine Mongoose-level invariant (required: true), not just an API-layer
// convention a future internal script or entry point could bypass.
function basePharmacyFields(overrides = {}) {
  return {
    userId: new mongoose.Types.ObjectId(),
    nameAr: 'صيدلية',
    nameEn: 'Pharmacy',
    ownerName: 'Owner',
    address: 'Some street',
    city: 'Latakia',
    phone: `0931${String(900000 + phoneCounter++).slice(-6)}`,
    addedBy: 'self',
    ...overrides,
  };
}

test('schema: Pharmacy.create() without areaType throws a ValidationError', async () => {
  await assert.rejects(
    () => Pharmacy.create(basePharmacyFields()),
    (err) => {
      assert.strictEqual(err.name, 'ValidationError');
      assert.ok(err.errors.areaType, 'expected a ValidationError on the areaType path');
      return true;
    }
  );
});

test('schema: Pharmacy.create() with an areaType outside the enum throws a ValidationError', async () => {
  await assert.rejects(
    () => Pharmacy.create(basePharmacyFields({ areaType: 'suburb' })),
    (err) => {
      assert.strictEqual(err.name, 'ValidationError');
      assert.ok(err.errors.areaType, 'expected a ValidationError on the areaType path');
      return true;
    }
  );
});

for (const areaType of ['city', 'city_ring', 'rural']) {
  test(`registers successfully with areaType = "${areaType}"`, async () => {
    const { status, body } = await call('POST', '/auth/register', {
      body: nextPayload({ areaType }),
    });

    assert.strictEqual(status, 201);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.pharmacy.areaType, areaType);

    const stored = await Pharmacy.findById(body.pharmacy.id).lean();
    assert.strictEqual(stored.areaType, areaType);
  });
}
