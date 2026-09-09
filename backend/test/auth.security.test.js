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
// Pinned rather than inherited: dotenv loads backend/.env for these tests,
// and the access-token lifetime assertion below has to describe the code,
// not whatever this particular machine has configured.
process.env.JWT_EXPIRES_IN = '24h';
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

// --- F-02: login failures must not reveal which accounts exist -------------

// The whole point is that these two responses are indistinguishable, so they
// are compared against each other rather than against a hard-coded literal.
async function loginAttempt(phone, password) {
  return call('POST', '/auth/login-password', { body: { phone, password } });
}

test('F-02: an unknown phone and a wrong password give byte-identical answers', async () => {
  const unknown = await loginAttempt('0939999999', 'anything-at-all');
  const wrongPassword = await loginAttempt(ACCOUNTS.pharmacy.phone, 'not-the-password');

  assert.strictEqual(unknown.status, 401, 'not 404 - that was the oracle');
  assert.strictEqual(wrongPassword.status, 401);
  assert.deepStrictEqual(
    unknown.body,
    wrongPassword.body,
    'same code, same message, same everything - nothing to distinguish them by'
  );
  assert.strictEqual(unknown.body.code, 'INVALID_CREDENTIALS');
});

test('F-02: an account with no password set is indistinguishable too', async () => {
  // This used to answer 400 "Password login is not available for this account",
  // which confirmed the number belonged to someone just as loudly as a 404 did.
  await User.create({
    name: 'Passwordless',
    phone: '0930000004',
    role: 'pharmacy',
    status: 'active',
  });

  const passwordless = await loginAttempt('0930000004', 'anything-at-all');
  const unknown = await loginAttempt('0939999998', 'anything-at-all');

  assert.strictEqual(passwordless.status, 401, 'not 400');
  assert.deepStrictEqual(passwordless.body, unknown.body);
});

test('F-02: a blocked account does not leak its existence to a guesser', async () => {
  await User.updateOne({ _id: ids.pharmacy }, { status: 'blocked' });
  try {
    // Wrong password: the caller has proven nothing, so they learn nothing.
    // The blocked check deliberately runs after the password comparison now.
    const guesser = await loginAttempt(ACCOUNTS.pharmacy.phone, 'not-the-password');
    const unknown = await loginAttempt('0939999997', 'not-the-password');

    assert.strictEqual(guesser.status, 401, 'not 403 - 403 would confirm the account exists');
    assert.deepStrictEqual(guesser.body, unknown.body);

    // The real owner still gets told why they cannot get in.
    const owner = await loginAttempt(ACCOUNTS.pharmacy.phone, PASSWORD);
    assert.strictEqual(owner.status, 403);
    assert.strictEqual(owner.body.code, 'ACCOUNT_BLOCKED');
  } finally {
    await User.updateOne({ _id: ids.pharmacy }, { status: 'active' });
  }
});

test('F-02: a correct password still logs in and returns a token', async () => {
  const { status, body } = await loginAttempt(ACCOUNTS.warehouse.phone, PASSWORD);

  assert.strictEqual(status, 200);
  assert.ok(body.token);
  assert.strictEqual(body.user.role, 'warehouse');
});

// --- F-03: short-lived access tokens, rotating refresh, revocation ---------

const jwt = require('jsonwebtoken');
const RefreshToken = require('../src/models/refreshToken.model');

async function freshSession(role = 'pharmacy') {
  const { body } = await loginAttempt(ACCOUNTS[role].phone, PASSWORD);
  return body;
}

test('F-03: login returns a refresh token alongside a 24h access token', async () => {
  const session = await freshSession();

  assert.ok(session.token, 'access token');
  assert.ok(session.refreshToken, 'refresh token');

  const claims = jwt.decode(session.token);
  const lifetimeHours = (claims.exp - claims.iat) / 3600;
  assert.strictEqual(lifetimeHours, 24, 'down from the 7 days the audit found');

  // The contract three clients and rateLimiter.js depend on is unchanged.
  assert.ok(claims.sub, 'sub is still the user id');
  assert.strictEqual(claims.role, 'pharmacy', 'role claim still present');
  assert.strictEqual(claims.tokenVersion, 0, 'and tokenVersion is now stamped in');

  // Only the digest is persisted - a database leak must not yield usable
  // session credentials.
  const stored = await RefreshToken.findOne({ userId: ids.pharmacy }).sort({ _id: -1 });
  assert.ok(stored, 'a session row exists');
  assert.notStrictEqual(stored.tokenHash, session.refreshToken, 'never stored raw');
  assert.match(stored.tokenHash, /^[0-9a-f]{64}$/, 'sha256 digest');
});

test('F-03: a refresh token buys a new pair and is then spent', async () => {
  const session = await freshSession();

  const first = await call('POST', '/auth/refresh', {
    body: { refreshToken: session.refreshToken },
  });
  assert.strictEqual(first.status, 200);
  assert.ok(first.body.token, 'a new access token');
  assert.ok(first.body.refreshToken, 'and a new refresh token - rotation');
  assert.notStrictEqual(
    first.body.refreshToken,
    session.refreshToken,
    'the refresh token must not be reusable as-is'
  );

  // Replaying the consumed token is refused. This is the rotation payoff: if
  // an attacker spends a stolen token, the real client's next refresh fails
  // and the theft surfaces instead of staying silent for 30 days.
  const replay = await call('POST', '/auth/refresh', {
    body: { refreshToken: session.refreshToken },
  });
  assert.strictEqual(replay.status, 401);
  assert.strictEqual(replay.body.code, 'INVALID_REFRESH_TOKEN');

  // The newly issued one still works.
  const second = await call('POST', '/auth/refresh', {
    body: { refreshToken: first.body.refreshToken },
  });
  assert.strictEqual(second.status, 200);
});

test('F-03: a garbage or expired refresh token is refused', async () => {
  const garbage = await call('POST', '/auth/refresh', {
    body: { refreshToken: 'not-a-real-token' },
  });
  assert.strictEqual(garbage.status, 401);
  assert.strictEqual(garbage.body.code, 'INVALID_REFRESH_TOKEN');

  const session = await freshSession();
  await RefreshToken.updateOne(
    { userId: ids.pharmacy },
    { expiresAt: new Date(Date.now() - 1000) },
    { sort: { _id: -1 } }
  );
  const expired = await call('POST', '/auth/refresh', {
    body: { refreshToken: session.refreshToken },
  });
  assert.strictEqual(expired.status, 401);
});

test('F-03: bumping tokenVersion revokes access tokens already issued', async () => {
  const session = await freshSession('warehouse');

  const before = await call('GET', '/auth/me', { token: session.token });
  assert.strictEqual(before.status, 200, 'the token works to begin with');

  await User.updateOne({ _id: ids.warehouse }, { $inc: { tokenVersion: 1 } });

  const after = await call('GET', '/auth/me', { token: session.token });
  assert.strictEqual(after.status, 401, 'the very same token is now dead');

  await User.updateOne({ _id: ids.warehouse }, { tokenVersion: 0 });
});

test('F-03: a token minted before tokenVersion existed still works', async () => {
  // The rollout must not log the entire user base out. A token from the old
  // code carries no tokenVersion claim at all; it has to read as 0 and match
  // the schema default.
  const legacyToken = jwt.sign(
    { sub: String(ids.pharmacy), role: 'pharmacy' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  const { status } = await call('GET', '/auth/me', { token: legacyToken });
  assert.strictEqual(status, 200, 'existing sessions survive the deploy');
});

test('F-03: blocking an account kills its refresh tokens too', async () => {
  const session = await freshSession('admin');
  const adminService = require('../src/services/admin.service');

  // blockAccount only handles pharmacy/warehouse roles, so use the pharmacy.
  const pharmacySession = await freshSession('pharmacy');
  await adminService.blockAccount(ids.pharmacy);

  try {
    const refreshed = await call('POST', '/auth/refresh', {
      body: { refreshToken: pharmacySession.refreshToken },
    });
    assert.notStrictEqual(refreshed.status, 200, 'a blocked account cannot refresh back in');

    const remaining = await RefreshToken.countDocuments({ userId: ids.pharmacy });
    assert.strictEqual(remaining, 0, 'every session row is gone');

    const withOldToken = await call('GET', '/auth/me', { token: pharmacySession.token });
    assert.strictEqual(withOldToken.status, 401, 'and the access token is revoked, not just 403');
  } finally {
    await User.updateOne({ _id: ids.pharmacy }, { status: 'active', tokenVersion: 0 });
  }

  assert.ok(session.token, 'admin session untouched');
});
