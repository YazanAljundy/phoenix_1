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

// The registration screen (Section 6.2) is the app's only entry point - there is
// no separate "log back in" screen in the 10-screen MVP. So a phone that already
// has an account is treated as a re-entry: the OTP logs the existing account back
// in and the freshly typed name/pharmacyName/address are discarded rather than
// rejected with a conflict error. This also gracefully covers JWT expiry (7 days)
// and reinstalls, without adding a screen the spec doesn't call for. The same
// discard applies to password/verificationPhotoUrl (Section 6-2 update): both are
// only ever captured once, at the account's actual creation.
async function registerOrLogin({ name, pharmacyName, phone, address, otpCode, password, verificationPhotoUrl }) {
  await otpService.verifyOtp(phone, otpCode);

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
    addedBy: 'self',
  });

  return { user, pharmacy, warehouse: null, token: issueToken(user) };
}

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

// Section 6-2: the alternative to OTP for returning users - phone + password,
// no SMS round-trip. Deliberately restricted to role='pharmacy' only, even
// though warehouse/admin accounts also have a `password` field in the schema
// (unused by them today) - this login path is scoped to the pharmacist app,
// not a general replacement for the warehouse/admin OTP flow.
async function loginWithPassword({ phone, password }) {
  const user = await User.findOne({ phone }).select('+password');
  if (!user || user.role !== 'pharmacy') {
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

async function getMe(userId) {
  const user = await User.findById(userId);
  if (!user) {
    throw ApiError.notFound('User not found.');
  }

  const { pharmacy, warehouse } = await loadProfile(user);
  return { user, pharmacy, warehouse };
}

module.exports = { registerOrLogin, login, loginWithPassword, getMe };
