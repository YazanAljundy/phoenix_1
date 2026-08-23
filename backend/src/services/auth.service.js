const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const env = require('../config/env');
const { ApiError } = require('../utils/ApiError');
const User = require('../models/user.model');
const Pharmacy = require('../models/pharmacy.model');
const Warehouse = require('../models/warehouse.model');
const otpService = require('./otp.service');

const BCRYPT_SALT_ROUNDS = 10;

function issueToken(user) {
  return jwt.sign({ sub: user._id.toString(), role: user.role }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  });
}

async function loadProfile(user) {
  if (user.role === 'pharmacy') {
    return { pharmacy: await Pharmacy.findOne({ userId: user._id }), warehouse: null };
  }
  if (user.role === 'warehouse') {
    return { pharmacy: null, warehouse: await Warehouse.findOne({ userId: user._id }) };
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
// The registration screen (Section 6.2) is the app's only entry point - there is
// no separate "log back in" screen in the 10-screen MVP. So a phone that already
// has an account is treated as a re-entry: registering again logs the existing
// account back in and the freshly typed name/pharmacyName/address are discarded
// rather than rejected with a conflict error. This also gracefully covers JWT
// expiry (7 days) and reinstalls, without adding a screen the spec doesn't call
// for. The same discard applies to password/verificationPhotoUrl (Section 6-2
// update): both are only ever captured once, at the account's actual creation.
async function registerOrLogin({
  name,
  pharmacyName,
  phone,
  address,
  password,
  verificationPhotoUrl,
  location,
}) {
  const existingUser = await User.findOne({ phone });
  if (existingUser) {
    if (existingUser.status === 'blocked') {
      throw ApiError.forbidden('This account has been blocked. Please contact support.');
    }
    const { pharmacy, warehouse } = await loadProfile(existingUser);
    return { user: existingUser, pharmacy, warehouse, token: issueToken(existingUser) };
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
    verificationPhoto: verificationPhotoUrl,
    location: location || undefined,
    addedBy: 'self',
  });

  return { user, pharmacy, warehouse: null, token: issueToken(user) };
}

// TODO(re-enable-otp): kept fully working, but no current client calls this -
// they use loginWithPassword below instead. See the TODO on registerOrLogin.
async function login({ phone, otpCode }) {
  await otpService.verifyOtp(phone, otpCode);

  const user = await User.findOne({ phone });
  if (!user) {
    throw ApiError.notFound('No account found for this phone number. Please register first.');
  }
  if (user.status === 'blocked') {
    throw ApiError.forbidden('This account has been blocked. Please contact support.');
  }

  const { pharmacy, warehouse } = await loadProfile(user);
  return { user, pharmacy, warehouse, token: issueToken(user) };
}

// Section 6-2/3: phone + password, no OTP - now the ONLY login mechanism for
// all three roles (pharmacy, warehouse, admin) while OTP is disabled (see the
// TODO on registerOrLogin above). Previously scoped to role='pharmacy' only;
// generalized here since the warehouse React panel and admin now use this
// same endpoint instead of their own OTP flow.
async function loginWithPassword({ phone, password }) {
  const user = await User.findOne({ phone }).select('+password');
  if (!user) {
    throw ApiError.notFound('No account found for this phone number. Please register first.');
  }
  if (user.status === 'blocked') {
    throw ApiError.forbidden('This account has been blocked. Please contact support.');
  }
  if (!user.password) {
    throw ApiError.badRequest('Password login is not available for this account.');
  }

  const matches = await bcrypt.compare(password, user.password);
  if (!matches) {
    throw ApiError.unauthorized('Incorrect phone number or password.');
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

async function getMe(userId) {
  const user = await User.findById(userId);
  if (!user) {
    throw ApiError.notFound('User not found.');
  }

  const { pharmacy, warehouse } = await loadProfile(user);
  return { user, pharmacy, warehouse };
}

module.exports = { registerOrLogin, login, loginWithPassword, getMe, registerDeviceToken };
