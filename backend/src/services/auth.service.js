const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const env = require('../config/env');
const { ApiError } = require('../utils/ApiError');
const User = require('../models/user.model');
const Pharmacy = require('../models/pharmacy.model');
const Warehouse = require('../models/warehouse.model');
const otpService = require('./otp.service');
const { emitToAdmins, EVENTS } = require('../realtime');

const BCRYPT_SALT_ROUNDS = 10;

// A real bcrypt hash of a value nothing can ever submit, burned once at
// startup. loginWithPassword compares against it when there is no account so
// that a miss costs the same wall-clock time as a hit - see the comment
// there. Generated rather than hard-coded so it always matches the cost
// factor above.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(
  'feniq/no-such-account/timing-equaliser',
  BCRYPT_SALT_ROUNDS
);

// Always returns false. Exists purely to spend the same time a real compare
// would, so the absence of an account is not observable through latency.
async function comparePasswordAgainstNothing(password) {
  await bcrypt.compare(String(password ?? ''), DUMMY_PASSWORD_HASH);
  return false;
}

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
        .select('nameAr nameEn ownerName address city phone verificationPhoto')
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
// SECURITY (audit F-01): this function used to double as a login. When `phone`
// already existed it returned a freshly issued token for that account WITHOUT
// ever comparing the submitted password - and without filtering by role, so
// knowing any phone number (a warehouse's, published by GET /warehouses, or an
// admin's) was enough to mint a valid token for it. That re-entry branch is
// gone: an existing phone is now a 409 and no token is issued from this path at
// all. Returning users go through POST /auth/login-password, which the pharmacy
// app has had a dedicated screen for since PasswordLoginView landed - the
// "registration is the only entry point" premise this branch was built on had
// already stopped being true.
//
// Note the 409 makes this endpoint an account-existence oracle. That is
// inherent to any synchronous registration (the caller has to be told the
// number is taken) and is the accepted trade-off; the enumeration that mattered
// - silently handing over the account - is what actually got closed here.
async function register({
  name,
  pharmacyName,
  phone,
  address,
  password,
  location,
}) {
  const existingUser = await User.findOne({ phone }).select('_id').lean();
  if (existingUser) {
    throw ApiError.conflict(
      'This phone number is already registered. Please log in instead.',
      'PHONE_ALREADY_REGISTERED'
    );
  }

  const hashedPassword = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
  const user = await User.create({
    name,
    phone,
    password: hashedPassword,
    role: 'pharmacy',
    status: 'pending',
  });

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
    // Deliberately NOT collapsed into the generic credential error the way
    // loginWithPassword's is (audit F-02). Reaching this line means
    // otpService.verifyOtp already succeeded, so the caller has proven they
    // control this phone - telling them there is no account yet is useful,
    // and discloses nothing they could not learn by trying to register.
    throw ApiError.notFound(
      'No account found for this phone number. Please register first.',
      'ACCOUNT_NOT_FOUND'
    );
  }
  if (user.status === 'blocked') {
    throw ApiError.forbidden(
      'This account has been blocked. Please contact support.',
      'ACCOUNT_BLOCKED'
    );
  }

  const { pharmacy, warehouse } = await loadProfile(user);
  return { user, pharmacy, warehouse, token: issueToken(user) };
}

// Section 6-2/3: phone + password, no OTP - now the ONLY login mechanism for
// all three roles (pharmacy, warehouse, admin) while OTP is disabled (see the
// TODO on register above). Previously scoped to role='pharmacy' only;
// generalized here since the warehouse React panel and admin now use this
// same endpoint instead of their own OTP flow.
async function loginWithPassword({ phone, password }) {
  const user = await User.findOne({ phone }).select(`+password ${AUTH_USER_FIELDS}`);

  // One indistinguishable failure for all three ways this can go wrong: no
  // such account, an account that has no password set, and a wrong password
  // (audit F-02). They used to answer 404 / 400 / 401 with three different
  // sentences, which made this endpoint an account-existence oracle: sweep
  // the Syrian mobile range, keep every number that answers anything other
  // than 404, and you have a list of every account on the platform.
  //
  // The dummy compare on the no-account path matters as much as the message.
  // Without it an unknown number returns in ~1ms while a known one pays
  // bcrypt's ~100ms, handing the same oracle back through the clock.
  const matches = user && user.password
    ? await bcrypt.compare(password, user.password)
    : await comparePasswordAgainstNothing(password);
  if (!matches) {
    throw ApiError.unauthorized('Incorrect phone number or password.', 'INVALID_CREDENTIALS');
  }

  // Only now - to a caller who has proven they own this account - is it safe
  // to say why they still cannot get in. Checking this before the password
  // would leak the account's existence to anyone who guessed the number.
  if (user.status === 'blocked') {
    throw ApiError.forbidden(
      'This account has been blocked. Please contact support.',
      'ACCOUNT_BLOCKED'
    );
  }

  const { pharmacy, warehouse } = await loadProfile(user);
  return { user, pharmacy, warehouse, token: issueToken(user) };
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

module.exports = { register, login, loginWithPassword, getMe, registerDeviceToken };
