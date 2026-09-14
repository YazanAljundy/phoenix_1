// The security package from the auth audit, driven over real HTTP against the
// real Express app so the routes, limiters, controllers and services are all
// in the picture - the same pattern as auth.register.test.js.
//
// Covers:
//   C-1  POST /auth/register must not mint a token for an existing account
//   H-1  login failures must be indistinguishable from one another
//   H-2  consecutive failures must lock the account
//   H-3  forgot -> reset -> login, change-password, and the OTP attempt ceiling
//   M-1  the per-role password minimums
//   (+)  self-service deletion, and that it kills existing tokens
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-auth-security-tests';
process.env.NODE_ENV = 'test';
// This suite drives well over 20 auth requests from one address and repeatedly
// fails logins for the same phone number, which is exactly what the credential
// limiters exist to stop - they would fire on the harness rather than on
// anything real. Opt out of them here (see rateLimiter.js); the limiters
// themselves are still driven for real by ratelimit.test.js, which does NOT
// set this.
process.env.DISABLE_AUTH_RATE_LIMIT = '1';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const { startMemoryMongo, stopMemoryMongo } = require('./helpers/mongo');

const app = require('../src/app');
const User = require('../src/models/user.model');
const Otp = require('../src/models/otp.model');
const { registerSmsProvider, _resetSmsProviders } = require('../src/services/sms');
const { SmsProvider } = require('../src/services/sms/smsProvider');

let server;
let baseUrl;
let phoneCounter = 0;

// A recording transport instead of asserting against console output - this is
// exactly the swap the provider interface exists to make possible (H-3d).
const sent = [];
class RecordingSmsProvider extends SmsProvider {
  get name() {
    return 'test-recorder';
  }
  async send(phone, message) {
    sent.push({ phone, message });
  }
}

function lastCodeFor(phone) {
  const entry = [...sent].reverse().find((m) => m.phone === phone);
  if (!entry) return null;
  const match = entry.message.match(/\b(\d{6})\b/);
  return match ? match[1] : null;
}

async function call(method, path, { body, token } = {}) {
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

function nextPhone() {
  phoneCounter += 1;
  return `09320${String(10000 + phoneCounter).slice(-5)}`;
}

const GOOD_PASSWORD = 'pharmacy-pass-1'; // >= 8, the pharmacy minimum

function registrationPayload(overrides = {}) {
  const password = overrides.password ?? GOOD_PASSWORD;
  return {
    name: 'Sami Alpha',
    pharmacyName: 'Alpha Pharmacy',
    phone: nextPhone(),
    address: 'Some street',
    areaType: 'city',
    password,
    confirmPassword: password,
    ...overrides,
  };
}

// Registers a fresh pharmacy and returns { phone, password, token }.
async function freshAccount(overrides = {}) {
  const payload = registrationPayload(overrides);
  const { status, body } = await call('POST', '/auth/register', { body: payload });
  assert.strictEqual(status, 201, `registration failed: ${JSON.stringify(body)}`);
  return { phone: payload.phone, password: payload.password, token: body.token };
}

test.before(async () => {
  await startMemoryMongo({ dbName: 'feniq-auth-security-test' });
  registerSmsProvider('test-recorder', () => new RecordingSmsProvider());
  process.env.SMS_PROVIDER = 'test-recorder';
  // env.js already read the old value at require time, so point the resolver
  // at the recorder explicitly rather than relying on the env var alone.
  require('../src/config/env').sms.provider = 'test-recorder';
  _resetSmsProviders();

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await stopMemoryMongo();
});

// --- C-1: the authentication bypass ----------------------------------------

test('C-1: register refuses a phone that already has an account', async () => {
  const account = await freshAccount();

  const { status, body } = await call('POST', '/auth/register', {
    body: registrationPayload({ phone: account.phone, password: 'a-totally-wrong-password' }),
  });

  assert.strictEqual(status, 409);
  assert.strictEqual(body.code, 'PHONE_ALREADY_REGISTERED');
  assert.ok(!body.token, 'no token may be issued');
  assert.ok(!body.user, 'the existing account must not be described back to the caller');
});

test('C-1: register cannot mint an ADMIN token from a known admin phone', async () => {
  const phone = nextPhone();
  await User.create({
    name: 'Real Admin',
    phone,
    password: await bcrypt.hash('the-real-admin-password', 10),
    role: 'admin',
    status: 'active',
  });

  const { status, body } = await call('POST', '/auth/register', {
    body: registrationPayload({ phone, password: 'not-the-admin-password' }),
  });

  assert.strictEqual(status, 409);
  assert.ok(!body.token);

  // And the admin-only surface stays shut.
  const probe = await call('GET', '/admin/accounts');
  assert.strictEqual(probe.status, 401);
});

test('C-1: registering a genuinely new phone still works exactly as before', async () => {
  const payload = registrationPayload();
  const { status, body } = await call('POST', '/auth/register', { body: payload });

  assert.strictEqual(status, 201);
  assert.ok(body.token);
  assert.strictEqual(body.user.role, 'pharmacy');
  assert.strictEqual(body.user.status, 'pending');
  assert.strictEqual(body.pharmacy.areaType, 'city');
  assert.strictEqual(jwt.verify(body.token, process.env.JWT_SECRET).role, 'pharmacy');
});

// --- H-1: account enumeration ----------------------------------------------

test('H-1: unknown phone and wrong password are indistinguishable', async () => {
  const account = await freshAccount();

  const unknown = await call('POST', '/auth/login-password', {
    body: { phone: nextPhone(), password: 'some-password' },
  });
  const wrong = await call('POST', '/auth/login-password', {
    body: { phone: account.phone, password: 'wrong-password' },
  });

  assert.strictEqual(unknown.status, 401);
  assert.strictEqual(wrong.status, 401);
  assert.strictEqual(unknown.body.message, wrong.body.message);
  assert.strictEqual(unknown.body.code, wrong.body.code);
  assert.strictEqual(unknown.body.code, 'INVALID_CREDENTIALS');
});

test('H-1: forgot-password reports the same thing for a known and unknown phone', async () => {
  const account = await freshAccount();

  const known = await call('POST', '/auth/forgot-password', { body: { phone: account.phone } });
  const unknown = await call('POST', '/auth/forgot-password', { body: { phone: nextPhone() } });

  assert.strictEqual(known.status, 200);
  assert.strictEqual(unknown.status, 200);
  assert.strictEqual(known.body.message, unknown.body.message);
});

// --- H-2: lockout ----------------------------------------------------------

test('H-2: five consecutive failures lock the account, and the lock is reported only to whoever knows the password', async () => {
  const account = await freshAccount();

  for (let i = 0; i < 5; i += 1) {
    const res = await call('POST', '/auth/login-password', {
      body: { phone: account.phone, password: 'wrong-password' },
    });
    assert.strictEqual(res.status, 401, `attempt ${i + 1} should be a plain 401`);
    assert.strictEqual(res.body.code, 'INVALID_CREDENTIALS');
  }

  const stored = await User.findOne({ phone: account.phone }).select('failedLoginAttempts lockedUntil');
  assert.strictEqual(stored.failedLoginAttempts, 5);
  assert.ok(stored.lockedUntil && stored.lockedUntil.getTime() > Date.now(), 'expected a live lock');

  // Someone who does not know the password still learns nothing.
  const attacker = await call('POST', '/auth/login-password', {
    body: { phone: account.phone, password: 'still-wrong' },
  });
  assert.strictEqual(attacker.status, 401);
  assert.strictEqual(attacker.body.code, 'INVALID_CREDENTIALS');

  // The real owner is told why the correct password is being refused.
  const owner = await call('POST', '/auth/login-password', {
    body: { phone: account.phone, password: account.password },
  });
  assert.strictEqual(owner.status, 429);
  assert.strictEqual(owner.body.code, 'ACCOUNT_TEMPORARILY_LOCKED');
});

test('H-2: a successful sign-in clears the failure streak', async () => {
  const account = await freshAccount();

  for (let i = 0; i < 3; i += 1) {
    await call('POST', '/auth/login-password', {
      body: { phone: account.phone, password: 'wrong-password' },
    });
  }
  assert.strictEqual(
    (await User.findOne({ phone: account.phone }).select('failedLoginAttempts')).failedLoginAttempts,
    3
  );

  const ok = await call('POST', '/auth/login-password', {
    body: { phone: account.phone, password: account.password },
  });
  assert.strictEqual(ok.status, 200);

  const after = await User.findOne({ phone: account.phone }).select('failedLoginAttempts lockedUntil');
  assert.strictEqual(after.failedLoginAttempts, 0);
  assert.strictEqual(after.lockedUntil, null);
});

// --- H-3: recovery, change, and the OTP ceiling ----------------------------

test('H-3: forgot-password -> reset-password -> sign in with the new password', async () => {
  const account = await freshAccount();

  const forgot = await call('POST', '/auth/forgot-password', { body: { phone: account.phone } });
  assert.strictEqual(forgot.status, 200);

  const code = lastCodeFor(account.phone);
  assert.ok(code, 'the provider interface should have carried a 6-digit code');

  const newPassword = 'brand-new-password';
  const reset = await call('POST', '/auth/reset-password', {
    body: { phone: account.phone, otpCode: code, password: newPassword, confirmPassword: newPassword },
  });
  assert.strictEqual(reset.status, 200, JSON.stringify(reset.body));

  const withNew = await call('POST', '/auth/login-password', {
    body: { phone: account.phone, password: newPassword },
  });
  assert.strictEqual(withNew.status, 200);

  const withOld = await call('POST', '/auth/login-password', {
    body: { phone: account.phone, password: account.password },
  });
  assert.strictEqual(withOld.status, 401);
});

test('H-3: a reset code cannot be replayed', async () => {
  const account = await freshAccount();
  await call('POST', '/auth/forgot-password', { body: { phone: account.phone } });
  const code = lastCodeFor(account.phone);

  const first = await call('POST', '/auth/reset-password', {
    body: { phone: account.phone, otpCode: code, password: 'first-new-pass', confirmPassword: 'first-new-pass' },
  });
  assert.strictEqual(first.status, 200);

  const replay = await call('POST', '/auth/reset-password', {
    body: { phone: account.phone, otpCode: code, password: 'second-new-pass', confirmPassword: 'second-new-pass' },
  });
  assert.strictEqual(replay.status, 400);
  assert.strictEqual(replay.body.code, 'INVALID_OTP');
});

test('H-3c: a reset code is burned after 5 wrong guesses', async () => {
  const account = await freshAccount();
  await call('POST', '/auth/forgot-password', { body: { phone: account.phone } });
  const realCode = lastCodeFor(account.phone);
  const wrongCode = realCode === '000000' ? '111111' : '000000';

  for (let i = 0; i < 5; i += 1) {
    const res = await call('POST', '/auth/reset-password', {
      body: { phone: account.phone, otpCode: wrongCode, password: 'nope-nope-nope', confirmPassword: 'nope-nope-nope' },
    });
    assert.strictEqual(res.status, 400);
  }

  const burned = await Otp.findOne({ phone: account.phone }).sort({ createdAt: -1 });
  assert.strictEqual(burned.isUsed, true, 'the code must be burned, not merely counted');

  // Even the RIGHT code is now worthless.
  const withReal = await call('POST', '/auth/reset-password', {
    body: { phone: account.phone, otpCode: realCode, password: 'too-late-password', confirmPassword: 'too-late-password' },
  });
  assert.strictEqual(withReal.status, 400);
  assert.strictEqual(withReal.body.code, 'INVALID_OTP');
});

test('H-3: change-password requires the current password', async () => {
  const account = await freshAccount();
  const login = await call('POST', '/auth/login-password', {
    body: { phone: account.phone, password: account.password },
  });
  const token = login.body.token;

  const wrong = await call('POST', '/auth/change-password', {
    token,
    body: { currentPassword: 'not-my-password', newPassword: 'a-new-password', confirmPassword: 'a-new-password' },
  });
  assert.strictEqual(wrong.status, 401);
  assert.strictEqual(wrong.body.code, 'INVALID_CURRENT_PASSWORD');

  const ok = await call('POST', '/auth/change-password', {
    token,
    body: { currentPassword: account.password, newPassword: 'a-new-password', confirmPassword: 'a-new-password' },
  });
  assert.strictEqual(ok.status, 200);

  const signIn = await call('POST', '/auth/login-password', {
    body: { phone: account.phone, password: 'a-new-password' },
  });
  assert.strictEqual(signIn.status, 200);
});

test('H-3: change-password is refused without a token', async () => {
  const res = await call('POST', '/auth/change-password', {
    body: { currentPassword: 'x', newPassword: 'yyyyyyyyyy', confirmPassword: 'yyyyyyyyyy' },
  });
  assert.strictEqual(res.status, 401);
});

// --- M-1: the password policy ----------------------------------------------

test('M-1: registration enforces the 8-character pharmacy minimum', async () => {
  const short = await call('POST', '/auth/register', {
    body: registrationPayload({ password: 'short7c' }),
  });
  assert.strictEqual(short.status, 400);
  assert.strictEqual(short.body.code, 'INVALID_PASSWORD');
  assert.match(short.body.message, /at least 8 characters/);

  const ok = await call('POST', '/auth/register', {
    body: registrationPayload({ password: 'exactly8' }),
  });
  assert.strictEqual(ok.status, 201);
});

test('M-1: a reset cannot be used to set a password below the minimum', async () => {
  const account = await freshAccount();
  await call('POST', '/auth/forgot-password', { body: { phone: account.phone } });
  const code = lastCodeFor(account.phone);

  const res = await call('POST', '/auth/reset-password', {
    body: { phone: account.phone, otpCode: code, password: 'tiny', confirmPassword: 'tiny' },
  });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.code, 'INVALID_PASSWORD');
});

// --- Admin emergency password reset -----------------------------------------
//
// The manual stand-in for /auth/forgot-password while no SMS provider is wired.

async function adminToken() {
  const phone = nextPhone();
  const password = 'admin-password-1234'; // >= 12, the admin minimum
  await User.create({
    name: 'Reset Admin',
    phone,
    password: await bcrypt.hash(password, 10),
    role: 'admin',
    status: 'active',
  });
  const login = await call('POST', '/auth/login-password', { body: { phone, password } });
  assert.strictEqual(login.status, 200, JSON.stringify(login.body));
  return login.body.token;
}

test('admin reset: recovers a locked-out account and clears the lockout', async () => {
  const account = await freshAccount();

  // Lock it the way a real attacker would.
  for (let i = 0; i < 5; i += 1) {
    await call('POST', '/auth/login-password', {
      body: { phone: account.phone, password: 'wrong-password' },
    });
  }
  const locked = await call('POST', '/auth/login-password', {
    body: { phone: account.phone, password: account.password },
  });
  assert.strictEqual(locked.status, 429, 'precondition: the account is locked');

  const stored = await User.findOne({ phone: account.phone }).select('_id');
  const token = await adminToken();
  const newPassword = 'recovered-by-admin';

  const res = await call('POST', `/admin/accounts/${stored._id}/reset-password`, {
    token,
    body: { password: newPassword, reason: 'Owner called support, verified by licence number.' },
  });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  // The plaintext must never come back out of the server.
  assert.ok(!JSON.stringify(res.body).includes(newPassword));

  const after = await User.findById(stored._id).select('failedLoginAttempts lockedUntil');
  assert.strictEqual(after.failedLoginAttempts, 0);
  assert.strictEqual(after.lockedUntil, null);

  // The user is genuinely back in immediately - not still serving the lockout.
  const signIn = await call('POST', '/auth/login-password', {
    body: { phone: account.phone, password: newPassword },
  });
  assert.strictEqual(signIn.status, 200, JSON.stringify(signIn.body));

  // And the old password is dead.
  const old = await call('POST', '/auth/login-password', {
    body: { phone: account.phone, password: account.password },
  });
  assert.strictEqual(old.status, 401);
});

test('admin reset: writes an audit record naming the admin, with no password material', async () => {
  const FinancialAuditLog = require('../src/models/financialAuditLog.model');

  const account = await freshAccount();
  const stored = await User.findOne({ phone: account.phone }).select('_id');
  const token = await adminToken();
  const actingAdmin = jwt.verify(token, process.env.JWT_SECRET);

  const res = await call('POST', `/admin/accounts/${stored._id}/reset-password`, {
    token,
    body: { password: 'audited-new-password', reason: 'Verified in person.' },
  });
  assert.strictEqual(res.status, 200);

  const entry = await FinancialAuditLog.findOne({
    action: 'account.password_reset',
    entityId: stored._id,
  }).lean();

  assert.ok(entry, 'an admin password reset must leave a trail');
  assert.strictEqual(String(entry.actorId), actingAdmin.sub);
  assert.strictEqual(entry.actorRole, 'admin');
  assert.strictEqual(entry.entityType, 'User');
  assert.strictEqual(entry.reason, 'Verified in person.');
  assert.ok(
    !JSON.stringify(entry).includes('audited-new-password'),
    'the audit trail must never carry the password itself'
  );
});

test('admin reset: enforces the TARGET role minimum, not the acting admin one', async () => {
  const account = await freshAccount();
  const stored = await User.findOne({ phone: account.phone }).select('_id');
  const token = await adminToken();

  // 7 characters - below the pharmacy minimum of 8.
  const tooShort = await call('POST', `/admin/accounts/${stored._id}/reset-password`, {
    token,
    body: { password: 'short7c' },
  });
  assert.strictEqual(tooShort.status, 400);
  assert.strictEqual(tooShort.body.code, 'INVALID_PASSWORD');
  assert.match(tooShort.body.message, /at least 8 characters/);

  // A warehouse account is held to 10 even though the same admin is acting.
  const warehouseUser = await User.create({
    name: 'WH Owner',
    phone: nextPhone(),
    password: await bcrypt.hash('warehouse-secret-1', 10),
    role: 'warehouse',
    status: 'active',
  });
  const nineChars = await call('POST', `/admin/accounts/${warehouseUser._id}/reset-password`, {
    token,
    body: { password: 'nine-char' },
  });
  assert.strictEqual(nineChars.status, 400);
  assert.match(nineChars.body.message, /at least 10 characters/);
});

test('admin reset: refused to non-admins, and cannot target another admin', async () => {
  const account = await freshAccount();
  const stored = await User.findOne({ phone: account.phone }).select('_id');

  // No token at all.
  const anon = await call('POST', `/admin/accounts/${stored._id}/reset-password`, {
    body: { password: 'anonymous-attempt' },
  });
  assert.strictEqual(anon.status, 401);

  // A pharmacy's own token must not reach it - not even for its own account.
  const login = await call('POST', '/auth/login-password', {
    body: { phone: account.phone, password: account.password },
  });
  const asPharmacy = await call('POST', `/admin/accounts/${stored._id}/reset-password`, {
    token: login.body.token,
    body: { password: 'self-service-attempt' },
  });
  assert.strictEqual(asPharmacy.status, 403);

  // An admin cannot reset another admin: that would make every admin a lateral
  // step to every other one.
  const token = await adminToken();
  const otherAdmin = await User.create({
    name: 'Other Admin',
    phone: nextPhone(),
    password: await bcrypt.hash('other-admin-password', 10),
    role: 'admin',
    status: 'active',
  });
  const adminOnAdmin = await call('POST', `/admin/accounts/${otherAdmin._id}/reset-password`, {
    token,
    body: { password: 'lateral-movement-1234' },
  });
  assert.strictEqual(adminOnAdmin.status, 404);
  assert.strictEqual(adminOnAdmin.body.code, 'ACCOUNT_NOT_FOUND');
});

test('admin reset: refuses a deleted account', async () => {
  const account = await freshAccount();
  const login = await call('POST', '/auth/login-password', {
    body: { phone: account.phone, password: account.password },
  });
  const stored = await User.findOne({ phone: account.phone }).select('_id');
  await call('DELETE', '/auth/account', {
    token: login.body.token,
    body: { password: account.password },
  });

  const token = await adminToken();
  const res = await call('POST', `/admin/accounts/${stored._id}/reset-password`, {
    token,
    body: { password: 'reviving-the-dead' },
  });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.code, 'ACCOUNT_DELETED');
});

// --- Self-service deletion --------------------------------------------------

test('deletion: requires the password, then kills the account and its live tokens', async () => {
  const account = await freshAccount();
  const login = await call('POST', '/auth/login-password', {
    body: { phone: account.phone, password: account.password },
  });
  const token = login.body.token;

  // The token works right up until the deletion.
  assert.strictEqual((await call('GET', '/auth/me', { token })).status, 200);

  const wrong = await call('DELETE', '/auth/account', { token, body: { password: 'wrong-password' } });
  assert.strictEqual(wrong.status, 401);
  assert.strictEqual(wrong.body.code, 'INVALID_CURRENT_PASSWORD');

  const ok = await call('DELETE', '/auth/account', { token, body: { password: account.password } });
  assert.strictEqual(ok.status, 200);

  // Soft delete: the row survives (the ledger and order history reference it),
  // but the account is unusable.
  const stored = await User.findOne({ phone: account.phone }).select('status deletedAt deviceTokens');
  assert.strictEqual(stored.status, 'deleted');
  assert.ok(stored.deletedAt);
  assert.deepStrictEqual(stored.deviceTokens, []);

  // The already-issued token is dead - this is what "invalidate the session"
  // means for a stateless JWT.
  const afterDelete = await call('GET', '/auth/me', { token });
  assert.strictEqual(afterDelete.status, 401);
  assert.strictEqual(afterDelete.body.code, 'ACCOUNT_DELETED');

  // And it cannot be signed back into.
  const signIn = await call('POST', '/auth/login-password', {
    body: { phone: account.phone, password: account.password },
  });
  assert.strictEqual(signIn.status, 403);
  assert.strictEqual(signIn.body.code, 'ACCOUNT_DELETED');
});

test('deletion: a deleted account disappears from the admin account list and its counts', async () => {
  const adminService = require('../src/services/admin.service');

  const account = await freshAccount();
  const before = await adminService.countAccounts({ role: 'pharmacy' });
  const listedBefore = await adminService.listAccounts({ role: 'pharmacy', limit: 100 });
  assert.ok(
    listedBefore.rows.some((r) => r.user.phone === account.phone),
    'the fresh account should be listed before deletion'
  );

  const login = await call('POST', '/auth/login-password', {
    body: { phone: account.phone, password: account.password },
  });
  await call('DELETE', '/auth/account', {
    token: login.body.token,
    body: { password: account.password },
  });

  const after = await adminService.countAccounts({ role: 'pharmacy' });
  const listedAfter = await adminService.listAccounts({ role: 'pharmacy', limit: 100 });

  assert.strictEqual(after.all, before.all - 1, 'the totals must drop by one');
  assert.ok(
    !listedAfter.rows.some((r) => r.user.phone === account.phone),
    'a deleted account must not appear in the management list'
  );
  // The pills and the rows have to agree - a row with no pill would make the
  // totals visibly disagree with the table.
  assert.strictEqual(
    after.all,
    after.pending + after.active + after.blocked,
    'the per-status pills must still sum to the total'
  );
});

test('deletion: a deleted phone cannot be re-registered, and cannot be recovered', async () => {
  const account = await freshAccount();
  const login = await call('POST', '/auth/login-password', {
    body: { phone: account.phone, password: account.password },
  });
  await call('DELETE', '/auth/account', {
    token: login.body.token,
    body: { password: account.password },
  });

  const reRegister = await call('POST', '/auth/register', {
    body: registrationPayload({ phone: account.phone }),
  });
  assert.strictEqual(reRegister.status, 409);

  // forgot-password stays silent about it rather than reviving it.
  const before = sent.length;
  const forgot = await call('POST', '/auth/forgot-password', { body: { phone: account.phone } });
  assert.strictEqual(forgot.status, 200);
  assert.strictEqual(sent.length, before, 'no code may be sent to a deleted account');
});
