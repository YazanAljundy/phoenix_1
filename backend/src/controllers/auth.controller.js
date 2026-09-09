const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const { normalizePhone, isValidPhone } = require('../utils/phone');
const otpService = require('../services/otp.service');
const authService = require('../services/auth.service');
const authViewModel = require('../viewmodels/auth.viewmodel');

const MIN_PASSWORD_LENGTH = 6;

function requireNonEmptyString(value, message) {
  if (typeof value !== 'string' || !value.trim()) {
    throw ApiError.badRequest(message);
  }
  return value.trim();
}

function requirePassword(value, message) {
  const password = requireNonEmptyString(value, message);
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw ApiError.badRequest(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  return password;
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

// Deliberately unauthenticated: the access token this is called with is
// expired by definition, so requiring a valid one would make it useless.
// The refresh token in the body is the credential.
const refresh = asyncHandler(async (req, res) => {
  const refreshToken = requireNonEmptyString(req.body.refreshToken, 'refreshToken is required.');

  const result = await authService.refreshSession(refreshToken);

  res.json({
    success: true,
    message: 'Session refreshed.',
    ...authViewModel.toAuthResponse(result),
  });
});

const me = asyncHandler(async (req, res) => {
  const result = await authService.getMe(req.user._id);
  res.json({ success: true, ...authViewModel.toMeResponse(result) });
});

// Section F-06. Requires the current password even though the caller is
// already authenticated: a borrowed unlocked laptop must not be enough to
// take an account over.
const changePassword = asyncHandler(async (req, res) => {
  const currentPassword = requireNonEmptyString(
    req.body.currentPassword,
    'Your current password is required.'
  );
  const newPassword = requirePassword(req.body.newPassword, 'A new password is required.');

  if (currentPassword === newPassword) {
    throw ApiError.badRequest('The new password must be different from the current one.');
  }

  const result = await authService.changePassword(req.user._id, {
    currentPassword,
    newPassword,
  });

  // The tokenVersion bump invalidated the token this request arrived with,
  // so the caller is handed a replacement pair to store. Every other device
  // stays signed out, which is the point of changing a password.
  res.json({
    success: true,
    message: 'Password changed. Other devices have been signed out.',
    ...authViewModel.toAuthResponse(result),
  });
});

// Admin-only. The route guard enforces the role; this only validates input.
const adminResetPassword = asyncHandler(async (req, res) => {
  const newPassword = requirePassword(req.body.newPassword, 'A new password is required.');

  await authService.adminResetPassword(req.params.userId, newPassword);

  res.json({ success: true, message: 'Password reset. That account has been signed out.' });
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

// The logout counterpart of registerDeviceToken. Best-effort from the
// client's point of view - it must never block signing out - so this stays
// idempotent: detaching a token that is not attached is a success.
const deleteDeviceToken = asyncHandler(async (req, res) => {
  const fcmToken = requireNonEmptyString(req.body.fcmToken, 'fcmToken is required.');

  await authService.deleteDeviceToken(req.user._id, fcmToken);
  res.json({ success: true, message: 'Device unregistered.' });
});

module.exports = {
  sendOtp,
  register,
  login,
  loginWithPassword,
  refresh,
  me,
  changePassword,
  adminResetPassword,
  registerDeviceToken,
  deleteDeviceToken,
};
