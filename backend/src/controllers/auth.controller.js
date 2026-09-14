const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const { normalizePhone, isValidPhone } = require('../utils/phone');
const { assertPasswordPolicy } = require('../utils/password');
const otpService = require('../services/otp.service');
const authService = require('../services/auth.service');
const authViewModel = require('../viewmodels/auth.viewmodel');

const AREA_TYPES = ['city', 'city_ring', 'rural'];

function requireNonEmptyString(value, message) {
  if (typeof value !== 'string' || !value.trim()) {
    throw ApiError.badRequest(message);
  }
  return value.trim();
}

// pharmacy.model.js's areaType is ALSO `required: true` at the schema level
// now - this check is not redundant with it. It runs before any DB call
// (cheap, and never touches Mongo), and it's what actually gives a bad
// request a clean 400 with a real message: errorHandler.js only maps
// ApiError -> a proper status code, so a bare Mongoose ValidationError
// reaching it would fall through to a generic 500 instead. Keep both:
// this is the API-facing fast path, the schema is the DB-level invariant
// that holds even for a write that goes around this controller entirely.
function requireAreaType(value) {
  if (typeof value !== 'string' || !AREA_TYPES.includes(value)) {
    throw ApiError.badRequest('A valid area type is required.');
  }
  return value;
}

// Registration is the one place the role is known up front and is always
// 'pharmacy' (auth.service.js hardcodes it) - so the policy can be applied
// here, before any DB work. The reset/change paths cannot: their minimum
// depends on the account's own role, so they assert it in the service, after
// the user is loaded. utils/password.js is the single source for all three.
function requirePassword(value, message, role = 'pharmacy') {
  const password = requireNonEmptyString(value, message);
  return assertPasswordPolicy(password, { role, code: 'INVALID_PASSWORD' });
}

// Optional - the registration screen's map picker sends both as plain form
// fields, or neither if the pharmacist skipped/denied it (Section 6.2
// update). Returns null unless both are present and valid, so a partial/bad
// pair is silently dropped rather than failing the whole registration.
function parseOptionalLocation(body) {
  if (body.latitude === undefined && body.longitude === undefined) {
    return null;
  }
  const lat = Number(body.latitude);
  const lng = Number(body.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { type: 'Point', coordinates: [lng, lat] };
}

// TODO(re-enable-otp): route stays live and fully working, but no current
// client calls it - registration/login are password-only for now. See the
// TODO in auth.service.js's register.
const sendOtp = asyncHandler(async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  if (!isValidPhone(phone)) {
    throw ApiError.badRequest('Please enter a valid phone number.');
  }

  await otpService.sendOtp(phone);
  res.json({ success: true, message: 'A verification code has been sent.' });
});

const register = asyncHandler(async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  if (!isValidPhone(phone)) {
    throw ApiError.badRequest('Please enter a valid phone number.');
  }

  const name = requireNonEmptyString(req.body.name, 'Full name is required.');
  const pharmacyName = requireNonEmptyString(req.body.pharmacyName, 'Pharmacy name is required.');
  const address = requireNonEmptyString(req.body.address, 'Address is required.');
  const areaType = requireAreaType(req.body.areaType);
  const password = requirePassword(req.body.password, 'Password is required.');
  const confirmPassword = requireNonEmptyString(
    req.body.confirmPassword,
    'Please confirm your password.'
  );
  if (password !== confirmPassword) {
    throw ApiError.badRequest('Passwords do not match.');
  }

  const location = parseOptionalLocation(req.body);

  const result = await authService.register({
    name,
    pharmacyName,
    phone,
    address,
    areaType,
    password,
    location,
  });

  res.status(201).json({
    success: true,
    message: 'Registration successful.',
    ...authViewModel.toAuthResponse(result),
  });
});

// TODO(re-enable-otp): kept fully working, but no current client calls this.
const login = asyncHandler(async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  if (!isValidPhone(phone)) {
    throw ApiError.badRequest('Please enter a valid phone number.');
  }
  const otpCode = requireNonEmptyString(req.body.otpCode, 'Verification code is required.');

  const result = await authService.login({ phone, otpCode });

  res.json({
    success: true,
    message: 'Login successful.',
    ...authViewModel.toAuthResponse(result),
  });
});

// Section 6-2/3: the only login mechanism while OTP is disabled (see the TODO
// on `sendOtp`/`login` above) - used by the pharmacy app, the warehouse React
// panel, and admin alike. Password is set once, at initial registration (see
// `register` above) or via scripts/create-admin.js for admin accounts.
const loginWithPassword = asyncHandler(async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  if (!isValidPhone(phone)) {
    throw ApiError.badRequest('Please enter a valid phone number.');
  }
  const password = requireNonEmptyString(req.body.password, 'Password is required.');

  const result = await authService.loginWithPassword({ phone, password });

  res.json({
    success: true,
    message: 'Login successful.',
    ...authViewModel.toAuthResponse(result),
  });
});

// Step 1 of password recovery (Audit H-3). The response is deliberately the
// same whether or not the number has an account - see forgotPassword in
// auth.service.js. Do not "improve" this by reporting an unknown number.
const forgotPassword = asyncHandler(async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  if (!isValidPhone(phone)) {
    throw ApiError.badRequest('Please enter a valid phone number.');
  }

  await authService.forgotPassword({ phone });

  res.json({
    success: true,
    message: 'If an account exists for this number, a verification code has been sent.',
  });
});

// Step 2 of password recovery. The new password is NOT length-checked here:
// the minimum depends on the account's role, so the service applies it once it
// has loaded the user (utils/password.js).
const resetPassword = asyncHandler(async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  if (!isValidPhone(phone)) {
    throw ApiError.badRequest('Please enter a valid phone number.');
  }
  const otpCode = requireNonEmptyString(req.body.otpCode, 'Verification code is required.');
  const password = requireNonEmptyString(req.body.password, 'A new password is required.');
  const confirmPassword = requireNonEmptyString(
    req.body.confirmPassword,
    'Please confirm your new password.'
  );
  if (password !== confirmPassword) {
    throw ApiError.badRequest('Passwords do not match.', undefined, 'PASSWORD_MISMATCH');
  }

  await authService.resetPassword({ phone, otpCode, password });

  res.json({ success: true, message: 'Your password has been reset. Please sign in.' });
});

// Changing a known password from inside the app - requires the current one.
// Same note as resetPassword on where the length rule is applied.
const changePassword = asyncHandler(async (req, res) => {
  const currentPassword = requireNonEmptyString(
    req.body.currentPassword,
    'Your current password is required.'
  );
  const newPassword = requireNonEmptyString(req.body.newPassword, 'A new password is required.');
  const confirmPassword = requireNonEmptyString(
    req.body.confirmPassword,
    'Please confirm your new password.'
  );
  if (newPassword !== confirmPassword) {
    throw ApiError.badRequest('Passwords do not match.', undefined, 'PASSWORD_MISMATCH');
  }

  await authService.changePassword(req.user._id, { currentPassword, newPassword });

  res.json({ success: true, message: 'Your password has been changed.' });
});

// Self-service account deletion (soft delete - see deleteAccount in
// auth.service.js for why it cannot be a hard one). Re-authenticates with the
// current password: a token alone must not be enough to destroy the account.
const deleteAccount = asyncHandler(async (req, res) => {
  const password = requireNonEmptyString(req.body.password, 'Your password is required.');

  await authService.deleteAccount(req.user._id, { password });

  res.json({ success: true, message: 'Your account has been deleted.' });
});

const me = asyncHandler(async (req, res) => {
  const result = await authService.getMe(req.user._id);
  res.json({ success: true, ...authViewModel.toMeResponse(result) });
});

const registerDeviceToken = asyncHandler(async (req, res) => {
  // TEMP DIAGNOSTIC LOGS (see FCM_DEBUG task) - no full token/auth header.
  // eslint-disable-next-line no-console
  console.log('AUTH_DEBUG: POST /auth/device-token called');
  // eslint-disable-next-line no-console
  console.log(`AUTH_DEBUG: authenticated userId = ${req.user._id}`);

  const fcmToken = requireNonEmptyString(req.body.fcmToken, 'fcmToken is required.');
  const deviceType = req.body.deviceType;
  if (deviceType !== 'android' && deviceType !== 'ios') {
    throw ApiError.badRequest("deviceType must be 'android' or 'ios'.");
  }

  // eslint-disable-next-line no-console
  console.log(`AUTH_DEBUG: deviceType = ${deviceType}`);
  // eslint-disable-next-line no-console
  console.log(
    `AUTH_DEBUG: fcmToken masked = ${fcmToken.length > 16 ? `${fcmToken.slice(0, 8)}...${fcmToken.slice(-8)}` : fcmToken}`
  );

  await authService.registerDeviceToken(req.user._id, { fcmToken, deviceType });
  // eslint-disable-next-line no-console
  console.log('AUTH_DEBUG: database update succeeded');
  res.json({ success: true, message: 'Device registered.' });
});

module.exports = {
  sendOtp,
  register,
  login,
  loginWithPassword,
  forgotPassword,
  resetPassword,
  changePassword,
  deleteAccount,
  me,
  registerDeviceToken,
};
