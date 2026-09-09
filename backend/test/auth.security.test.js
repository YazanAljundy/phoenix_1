// The authentication surface, driven over real HTTP.
//
// Everything here exists because of a specific finding in the auth security
// audit, and each test is named after the finding it locks down. The service
// layer already has coverage in readpath.lean.test.js; what this file adds is
// the part that actually faces the internet - status codes, response bodies,
// and the exact shape a stolen or replayed credential gets back.
//
// There was no HTTP-level coverage of /auth/* at all before this.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-auth-security-tests';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/feniq-auth-security-test';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const bcrypt = require('bcrypt');

const { startMemoryMongo, stopMemoryMongo, syncIndexes } = require('./helpers/mongo');

const app = require('../src/app');

const User = require('../src/models/user.model');
const Pharmacy = require('../src/models/pharmacy.model');
const Warehouse = require('../src/models/warehouse.model');

const PASSWORD = 'correct-horse-battery';

// One per role. F-01 was role-agnostic - the takeover worked just as well
// against an admin as against a pharmacy - so every assertion below is run
// against all three rather than against a convenient one.
const ACCOUNTS = {
  pharmacy: { phone: '0930000001', name: 'Target Pharmacy' },
  warehouse: { phone: '0930000002', name: 'Target Warehouse' },
  admin: { phone: '0930000003', name: 'Target Admin' },
};

const ids = {};
let server;
let baseUrl;

async function call(method, path, { token, body } = {}) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
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

// The exact payload the pharmacy app's registration screen sends.
function registrationBody(phone, overrides = {}) {
  return {
    name: 'Attacker',
    pharmacyName: 'Attacker Pharmacy',
    phone,
    address: 'Anywhere',
    password: 'whatever-i-like',
    confirmPassword: 'whatever-i-like',
    ...overrides,
  };
}

test.before(async () => {
  await startMemoryMongo({ dbName: 'feniq-auth-security-test' });
  await syncIndexes(User);

  const hashed = await bcrypt.hash(PASSWORD, 10);
  for (const [role, account] of Object.entries(ACCOUNTS)) {
    const user = await User.create({
      name: account.name,
      phone: account.phone,
      password: hashed,
      role,
      status: 'active',
    });
    ids[role] = user._id;
  }

  await Pharmacy.create({
    userId: ids.pharmacy,
    nameAr: 'ص',
    nameEn: 'Target Pharmacy',
    ownerName: 'Target Pharmacy',
    address: 'Anywhere',
    city: 'Latakia',
    phone: ACCOUNTS.pharmacy.phone,
    addedBy: 'self',
  });
  await Warehouse.create({
    userId: ids.warehouse,
    nameAr: 'م',
    nameEn: 'Target Warehouse',
    city: 'Latakia',
    address: 'Anywhere',
    phone: ACCOUNTS.warehouse.phone,
  });

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await stopMemoryMongo();
});

// --- F-01: /auth/register must not double as a login ----------------------

// The audit's headline finding. POST /auth/register used to return a valid JWT
// for any phone number that already existed, without ever comparing a password
// and without filtering by role - so a warehouse's phone (published to every
// pharmacy by GET /warehouses) or an admin's was a complete account takeover.
for (const role of Object.keys(ACCOUNTS)) {
  test(`F-01: registering an existing ${role} phone is refused, with no token`, async () => {
    const { status, body } = await call('POST', '/auth/register', {
      body: registrationBody(ACCOUNTS[role].phone),
    });

    assert.strictEqual(status, 409, 'conflict, not a successful login');
    assert.strictEqual(body.code, 'PHONE_ALREADY_REGISTERED');
    assert.strictEqual(body.success, false);
    assert.ok(!body.token, 'no token may be issued from this path');
    assert.ok(!body.user, 'and no account details either');
  });
}

test('F-01: the refusal does not depend on knowing the real password', async () => {
  // Submitting the *correct* password must not sneak through the conflict
  // either - /auth/register is not a login, whatever the caller sends.
  const { status, body } = await call('POST', '/auth/register', {
    body: registrationBody(ACCOUNTS.admin.phone, {
      password: PASSWORD,
      confirmPassword: PASSWORD,
    }),
  });

  assert.strictEqual(status, 409);
  assert.ok(!body.token);
});

test('F-01: the targeted account is left completely untouched', async () => {
  // The old code discarded the re-typed name/address, but a future regression
  // that "helpfully" updated them would be a defacement primitive. Nothing the
  // attacker submitted may have landed.
  const admin = await User.findById(ids.admin).select('+password');

  assert.strictEqual(admin.name, ACCOUNTS.admin.name, 'name not overwritten');
  assert.strictEqual(admin.role, 'admin', 'role not downgraded to pharmacy');
  assert.strictEqual(admin.status, 'active');
  assert.ok(
    await bcrypt.compare(PASSWORD, admin.password),
    'the original password still works - the attacker did not reset it'
  );
});

test('F-01: a genuinely new phone still registers and gets a token', async () => {
  const { status, body } = await call('POST', '/auth/register', {
    body: registrationBody('0930000099'),
  });

  assert.strictEqual(status, 201);
  assert.ok(body.token, 'real registrations still work');
  assert.strictEqual(body.user.role, 'pharmacy');
  assert.strictEqual(body.user.status, 'pending', 'still waiting on admin approval');
});
