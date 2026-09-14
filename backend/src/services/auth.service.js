const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const env = require('../config/env');
const { ApiError } = require('../utils/ApiError');
const { assertPasswordPolicy } = require('../utils/password');
const User = require('../models/user.model');
const Pharmacy = require('../models/pharmacy.model');
const Warehouse = require('../models/warehouse.model');
const otpService = require('./otp.service');
const { emitToAdmins, EVENTS } = require('../realtime');

const BCRYPT_SALT_ROUNDS = 10;

// Login throttling (Audit H-2). Five consecutive failures buy a lockout, and
// each further block of five doubles it: 15m, 30m, 1h, 2h... capped so an
// account is never bricked outright by someone else's guessing.
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_BASE_MINUTES = 15;
const LOCKOUT_MAX_MINUTES = 24 * 60;

// A real bcrypt hash of a value nobody holds, compared against whenever the
// phone has no account (Audit H-1). Without it, a miss returns in ~0ms while a
// hit spends ~100ms in bcrypt, and that gap alone enumerates the user table
// regardless of how carefully the error messages are matched. Hashed once at
// module load, not per request.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('feniq-timing-equalizer-not-a-real-password', BCRYPT_SALT_ROUNDS);

// One error for every way password login can fail (Audit H-1). The previous
// pair - 404 "No account found for this phone number" vs 401 "Incorrect phone
// number or password" - separated "this number is registered" from "this
// number is not" precisely enough to enumerate the user base over a phone
// space this small, which is the reconnaissance half of an account takeover.
const invalidCredentials = () =>
  ApiError.unauthorized('Incorrect phone number or password.', 'INVALID_CREDENTIALS');

// Exactly the fields auth.viewmodel.js's serializeUser reads, and nothing
// else. Everything omitted is dead weight on every auth response:
//   - deviceTokens: an unbounded array that no auth path reads (the push
//     layer loads it separately in notification.service.js);
//   - password: already select:false at the schema level - listed with a
//     leading '+' only where loginWithPassword actually needs to compare it;
//   - createdAt / updatedAt: never serialised, never branched on.
// loadProfile only needs role/_id, issueToken only needs role/_id, and the
// blocked-account guard only needs status - all still present here.
const AUTH_USER_FIELDS = 'name phone role status lang';

// What the password-login path needs on top of AUTH_USER_FIELDS: the stored
// hash plus the two throttling counters. Kept as its own constant rather than
// folded into AUTH_USER_FIELDS so the hottest read in the app (/auth/me, on
// every launch and resume) does not start fetching a bcrypt hash and two
// fields it has no use for.
const LOGIN_USER_FIELDS = `+password failedLoginAttempts lockedUntil ${AUTH_USER_FIELDS}`;

function issueToken(user) {
  return jwt.sign({ sub: user._id.toString(), role: user.role }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  });
}

// .lean(): every caller (register, login, loginWithPassword, getMe)
// passes the result straight to auth.viewmodel.js and never saves it.
//
// .select(): serializePharmacy / serializeWarehouse in auth.viewmodel.js are
// the only consumers of these two documents. Every field they don't read -
// userId, the reserved licence fields, addedBy, the rating counters,
// isActive, the GeoJSON `location` subdocument, timestamps - is fetched and
// deserialised for nothing on a response the Flutter client hits on every
// launch and resume.
async function loadProfile(user) {
  if (user.role === 'pharmacy') {
    return {
      pharmacy: await Pharmacy.findOne({ userId: user._id })
        .select('nameAr nameEn ownerName address city areaType phone verificationPhoto')
        .lean(),
      warehouse: null,
    };
  }
  if (user.role === 'warehouse') {
    return {
      pharmacy: null,
      warehouse: await Warehouse.findOne({ userId: user._id })
        .select('nameAr nameEn city phone logo')
        .lean(),
    };
  }
  return { pharmacy: null, warehouse: null };
}

// TODO(re-enable-otp): OTP phone verification is temporarily disabled for
// registration (project owner's decision) - admin's manual approval is the
// verification step for now instead of a confirmed phone number. otpService
// and the /auth/otp/send + /auth/login routes are deliberately left fully
// intact (not deleted) so this can be restored later by re-adding the
// otpService.verifyOtp(phone, otpCode) call this function used to make.
//
// SECURITY (Audit C-1). This function used to be `registerOrLogin`, and a
// phone that already had an account was treated as a re-entry: it returned a
// signed token for the existing user without ever checking the password. That
// made POST /auth/register an unauthenticated login for ANY account whose
// phone number was known - and the token carried the existing user's own role,
// not 'pharmacy', so a warehouse's or an admin's phone yielded a warehouse or
// admin token. Warehouse phone numbers are handed to every pharmacy by
// GET /warehouses, and admin.service.js stores the same number as the
// warehouse's login, so the takeover needed exactly one request and no
// guessing.
//
// The convenience it bought (re-entry after JWT expiry or a reinstall, and a
// de-facto password recovery) is now served properly: registration refuses a
// known phone with 409, the client sends the user to /auth/login-password, and
// a forgotten password goes through /auth/forgot-password -> /auth/reset-password.
// Both of those had to exist before this could be closed.
async function register({
  name,
  pharmacyName,
  phone,
  address,
  areaType,
  password,
  location,
}) {
  // Only _id is needed: nothing about the existing account is returned to an
  // unauthenticated caller any more. Leaking back the real owner's name and
  // role - which the old re-entry response did - was its own enumeration
  // channel on top of the bypass.
  const existingUser = await User.findOne({ phone }).select('_id').lean();
  if (existingUser) {
    throw ApiError.conflict(
      'An account already exists for this phone number. Please sign in instead.',
      'PHONE_ALREADY_REGISTERED'
    );
  }

  const hashedPassword = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

  let user;
  try {
    user = await User.create({
      name,
      phone,
      password: hashedPassword,
      role: 'pharmacy',
      status: 'pending',
    });
  } catch (err) {
    // 11000 = duplicate key on the unique users.phone index: a second
    // registration for this number landed between the findOne above and this
    // insert. Same handling as admin.service.js's createWarehouseAccount - the
    // index is the real guard, the lookup above is only there for the clean
    // error message. Without this the race surfaces as a 500.
    if (err && err.code === 11000) {
      throw ApiError.conflict(
        'An account already exists for this phone number. Please sign in instead.',
        'PHONE_ALREADY_REGISTERED'
      );
    }
    throw err;
  }

  // city defaults to Latakia: the registration form (Section 6.2) only collects
  // name/pharmacyName/phone/address, but pharmacies.city is a required field and
  // the spec's initial market is Latakia only (Section 2). Editable later from
  // the profile/admin panel once a city field is actually needed.
  const pharmacy = await Pharmacy.create({
    userId: user._id,
    nameAr: pharmacyName,
    nameEn: pharmacyName,
    ownerName: name,
    address,
    city: 'Latakia',
    areaType,
    phone,
    location: location || undefined,
    addedBy: 'self',
  });

  // A brand-new pharmacy lands in the admin's approval queue, and until an
  // admin acts it cannot order at all - so the wait is the pharmacy's, not
  // just the admin's. Emitted only now, once both the User and its Pharmacy
  // profile are durable (a User with no profile would render as a broken row).
  // Ids only; the panel re-reads GET /admin/pending-accounts.
  emitToAdmins(EVENTS.ACCOUNT_PENDING, {
    userId: user._id.toString(),
    role: user.role,
  });

  return { user, pharmacy, warehouse: null, token: issueToken(user) };
}

// TODO(re-enable-otp): kept fully working, but no current client calls this -
// they use loginWithPassword below instead. See the TODO on register.
async function login({ phone, otpCode }) {
  await otpService.verifyOtp(phone, otpCode);

  const user = await User.findOne({ phone }).select(AUTH_USER_FIELDS);
  if (!user) {
    throw ApiError.notFound('No account found for this phone number. Please register first.');
  }
  if (user.status === 'blocked') {
    throw ApiError.forbidden('This account has been blocked. Please contact support.');
  }

  const { pharmacy, warehouse } = await loadProfile(user);
  return { user, pharmacy, warehouse, token: issueToken(user) };
}

function isLocked(user) {
  return Boolean(user.lockedUntil && user.lockedUntil.getTime() > Date.now());
}

// Escalating lockout, derived from the consecutive-failure count alone so no
// third "how many times has this locked" field is needed: every completed
// block of LOCKOUT_THRESHOLD failures doubles the previous duration.
//   5 failures -> 15m, 10 -> 30m, 15 -> 1h, 20 -> 2h ... capped at 24h.
async function registerFailedAttempt(user) {
  user.failedLoginAttempts += 1;

  if (user.failedLoginAttempts % LOCKOUT_THRESHOLD === 0) {
    const lockNumber = user.failedLoginAttempts / LOCKOUT_THRESHOLD;
    const minutes = Math.min(LOCKOUT_BASE_MINUTES * 2 ** (lockNumber - 1), LOCKOUT_MAX_MINUTES);
    user.lockedUntil = new Date(Date.now() + minutes * 60 * 1000);
  }

  await user.save();
}

async function clearFailedAttempts(user) {
  if (user.failedLoginAttempts === 0 && !user.lockedUntil) return;
  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  await user.save();
}

// Section 6-2/3: phone + password, no OTP - now the ONLY login mechanism for
// all three roles (pharmacy, warehouse, admin) while OTP is disabled (see the
// TODO on register above). Previously scoped to role='pharmacy' only;
// generalized here since the warehouse React panel and admin now use this
// same endpoint instead of their own OTP flow.
//
// Audit H-1/H-2. Two properties this function has to hold at once, which is
// what the ordering below is about:
//
//  - An attacker must not learn whether a phone number has an account. So the
//    "no such user", "no password set" and "wrong password" paths are one
//    error (invalidCredentials) and one status code, and the no-user path
//    still spends a bcrypt comparison so the timing matches.
//
//  - A locked-out user must be TOLD they are locked out, or the feature is
//    indistinguishable from "my password stopped working". That is only safe
//    once the password has been proven correct - which is why the lockout is
//    reported after the compare, not before it. Someone who does not know the
//    password gets the same generic 401 whether the account is locked or not
//    and so learns nothing; the real owner gets a clear message.
async function loginWithPassword({ phone, password }) {
  const user = await User.findOne({ phone }).select(LOGIN_USER_FIELDS);

  if (!user || !user.password) {
    // Equalize the response time against the real bcrypt path above.
    await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
    throw invalidCredentials();
  }

  const matches = await bcrypt.compare(password, user.password);

  if (!matches) {
    // Counted even while already locked: continued guessing during a lockout
    // is what drives the next, longer one.
    await registerFailedAttempt(user);
    throw invalidCredentials();
  }

  if (isLocked(user)) {
    const minutesLeft = Math.max(1, Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000));
    throw ApiError.tooManyRequests(
      `Too many failed sign-in attempts. Please try again in ${minutesLeft} minute(s).`,
      'ACCOUNT_TEMPORARILY_LOCKED'
    );
  }

  // Correct password on a live account: the streak is over regardless of what
  // it was. Done before the status checks so a blocked user's counter doesn't
  // grow forever while they retry a password that is in fact right.
  await clearFailedAttempts(user);

  if (user.status === 'blocked') {
    throw ApiError.forbidden('This account has been blocked. Please contact support.');
  }
  if (user.status === 'deleted') {
    throw ApiError.forbidden(
      'This account has been deleted. Please contact support.',
      'ACCOUNT_DELETED'
    );
  }

  const { pharmacy, warehouse } = await loadProfile(user);
  return { user, pharmacy, warehouse, token: issueToken(user) };
}

// ---------------------------------------------------------------------------
// Password recovery and management (Audit H-3)
//
// Before this, a password was captured once at registration and could never be
// changed or recovered by anyone - the only way back into a locked-out account
// was the /auth/register bypass (C-1). Closing that bypass without these three
// functions would have stranded real users, so they ship together.
// ---------------------------------------------------------------------------

// Step 1 of recovery: mint a password_reset code and text it to the number.
//
// Always reports success, whether or not the phone has an account. An honest
// "no account found" here would re-open exactly the enumeration hole H-1
// closes on the login path, and on an endpoint that needs no credentials at
// all. Blocked and deleted accounts are silently skipped for the same reason:
// they must not be recoverable, and the caller must not learn that they exist.
//
// The per-phone send ceiling (3 per 15 minutes) lives in otp.service.js and
// still applies - but only to numbers that actually get a code, so it cannot
// be used as an oracle either.
async function forgotPassword({ phone }) {
  const user = await User.findOne({ phone }).select('_id status').lean();

  if (user && user.status !== 'blocked' && user.status !== 'deleted') {
    await otpService.sendOtp(phone, 'password_reset');
  }
}

// Step 2 of recovery: verify the code and set the new password.
//
// The code is consumed first: a wrong or expired one must cost an attempt
// (otp.service.js burns the code after 5) before anything else is considered.
async function resetPassword({ phone, otpCode, password }) {
  await otpService.verifyOtp(phone, otpCode, 'password_reset');

  const user = await User.findOne({ phone }).select(`role status ${AUTH_USER_FIELDS}`);
  if (!user || user.status === 'blocked' || user.status === 'deleted') {
    // A code can only have been minted for a live account, so this is either a
    // race (blocked between request and reset) or tampering. Same opaque error
    // as a bad code.
    throw ApiError.badRequest('Invalid or expired verification code.', undefined, 'INVALID_OTP');
  }

  // Checked here rather than in the controller because the minimum depends on
  // the account's role, which the controller cannot know without this lookup.
  assertPasswordPolicy(password, { role: user.role, code: 'INVALID_PASSWORD' });

  user.password = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
  // A completed reset is proof of phone ownership, so it also lifts any
  // lockout - otherwise the legitimate owner recovers their password and is
  // still locked out by the attacker's failures.
  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  await user.save();
}

// Changing a known password from inside the app. Requires the current one:
// without that, a borrowed unlocked phone or a stolen token is enough to lock
// the real owner out of their own account.
async function changePassword(userId, { currentPassword, newPassword }) {
  const user = await User.findById(userId).select(`+password role ${AUTH_USER_FIELDS}`);
  if (!user) {
    throw ApiError.notFound('User not found.');
  }
  if (!user.password) {
    throw ApiError.badRequest(
      'Password login is not available for this account.',
      undefined,
      'PASSWORD_LOGIN_UNAVAILABLE'
    );
  }

  const matches = await bcrypt.compare(currentPassword, user.password);
  if (!matches) {
    throw ApiError.unauthorized('Current password is incorrect.', 'INVALID_CURRENT_PASSWORD');
  }

  assertPasswordPolicy(newPassword, { role: user.role, code: 'INVALID_PASSWORD' });

  if (await bcrypt.compare(newPassword, user.password)) {
    throw ApiError.badRequest(
      'The new password must be different from the current one.',
      undefined,
      'PASSWORD_UNCHANGED'
    );
  }

  user.password = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);
  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  await user.save();

  // NOTE (follow-up, Audit M-2): tokens minted before this change stay valid
  // for the rest of their 7 days - the JWT is stateless and carries no version
  // to invalidate against. Changing a password therefore does NOT yet sign out
  // other devices. That needs the tokenVersion work scheduled for the next
  // round.
}

// Self-service account deletion.
//
// SOFT delete, deliberately. A hard delete is not available to this schema
// without data loss that reaches other people: a pharmacy's _id is referenced
// by orders, orderItems, returns, reviews, complaints, ledger accounts, ledger
// entries and financialAuditLogs - and those ledger rows are double-entry
// records that ledgerVerifier.service.js re-checks on a schedule, with the
// matching credit sitting in a WAREHOUSE's books. Deleting the user row would
// either orphan every one of those references or force a cascade through the
// warehouse's own financial history, which is not this user's to erase.
//
// What this does instead: the account becomes permanently unusable (status
// 'deleted' is refused at authenticate, which also kills every token already
// issued), push notifications stop, and the records that belong to other
// parties stay intact and attributable.
//
// The password hash is deliberately KEPT: it grants nothing (authentication is
// refused on status before the password is ever consulted) and it is what lets
// support restore an account deleted by mistake. See the summary note about
// the retention/anonymisation policy this still needs.
async function deleteAccount(userId, { password }) {
  const user = await User.findById(userId).select(`+password ${AUTH_USER_FIELDS}`);
  if (!user) {
    throw ApiError.notFound('User not found.');
  }
  if (user.status === 'deleted') {
    throw ApiError.badRequest('This account is already deleted.', undefined, 'ACCOUNT_DELETED');
  }
  if (!user.password) {
    throw ApiError.badRequest(
      'Password login is not available for this account.',
      undefined,
      'PASSWORD_LOGIN_UNAVAILABLE'
    );
  }

  // Re-authentication, for the same reason changePassword demands it: an
  // unattended unlocked phone must not be able to destroy the account.
  const matches = await bcrypt.compare(password, user.password);
  if (!matches) {
    throw ApiError.unauthorized('Current password is incorrect.', 'INVALID_CURRENT_PASSWORD');
  }

  user.status = 'deleted';
  user.deletedAt = new Date();
  // Stop push immediately: a deleted account must not keep receiving order and
  // offer notifications on a device that may well have been handed on.
  user.deviceTokens = [];
  await user.save();
}

// A token can only ever belong to one user at a time - if this exact device
// was previously registered under a different account (a logout/login
// switch on the same phone), remove it from wherever it was before
// re-adding it here. Without this, the previous account would keep getting
// push notifications meant for whoever's actually logged in now. Refreshing
// the same token for the same user goes through the same pull-then-push,
// which is also how lastUsedAt gets bumped on every app launch.
async function registerDeviceToken(userId, { fcmToken, deviceType }) {
  await User.updateMany({ 'deviceTokens.fcmToken': fcmToken }, { $pull: { deviceTokens: { fcmToken } } });
  await User.updateOne(
    { _id: userId },
    { $push: { deviceTokens: { fcmToken, deviceType, lastUsedAt: new Date() } } }
  );
}

// GET /auth/me is the most frequently called endpoint in the app (the Flutter
// client calls it on every launch and resume). .lean(): read-only, straight
// into auth.viewmodel.js. .select(AUTH_USER_FIELDS): `password` stays excluded
// (schema select:false, and not requested here), and deviceTokens / timestamps
// are dropped from the hottest read in the app.
async function getMe(userId) {
  const user = await User.findById(userId).select(AUTH_USER_FIELDS).lean();
  if (!user) {
    throw ApiError.notFound('User not found.');
  }

  const { pharmacy, warehouse } = await loadProfile(user);
  return { user, pharmacy, warehouse };
}

module.exports = {
  register,
  login,
  loginWithPassword,
  forgotPassword,
  resetPassword,
  changePassword,
  deleteAccount,
  getMe,
  registerDeviceToken,
};
