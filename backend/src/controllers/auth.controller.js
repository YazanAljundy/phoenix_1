const fs = require('fs');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const { normalizePhone, isValidPhone } = require('../utils/phone');
const otpService = require('../services/otp.service');
const authService = require('../services/auth.service');
const authViewModel = require('../viewmodels/auth.viewmodel');
const { verifyImageMagicBytes } = require('../middlewares/upload.middleware');

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

// TODO(re-enable-otp): route stays live and fully working, but no current
// client calls it - registration/login are password-only for now. See the
// TODO in auth.service.js's registerOrLogin.
const sendOtp = asyncHandler(async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  if (!isValidPhone(phone)) {
    throw ApiError.badRequest('Please enter a valid phone number.');
  }

  await otpService.sendOtp(phone);
  res.json({ success: true, message: 'A verification code has been sent.' });
});

const register = asyncHandler(async (req, res) => {
  // Multer has already saved the file to disk by this point (if one was
  // sent) - on any validation failure below we must clean it up ourselves,
  // otherwise a rejected registration attempt leaks an orphaned file.
  const cleanupUploadedFile = () => {
    if (req.file) fs.unlink(req.file.path, () => {});
  };

  try {
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

    if (!req.file) {
      throw ApiError.badRequest('A photo of the pharmacy is required.');
    }
    if (!verifyImageMagicBytes(req.file.path)) {
      throw ApiError.badRequest('Verification photo file content is not a valid image.');
    }
    const verificationPhotoUrl = `${req.protocol}://${req.get('host')}/uploads/verification-photos/${req.file.filename}`;

    const result = await authService.registerOrLogin({
      name,
      pharmacyName,
      phone,
      address,
      password,
      verificationPhotoUrl,
    });

    res.status(201).json({
      success: true,
      message: 'Registration successful.',
      ...authViewModel.toAuthResponse(result),
    });
  } catch (err) {
    cleanupUploadedFile();
    throw err;
  }
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

const me = asyncHandler(async (req, res) => {
  const result = await authService.getMe(req.user._id);
  res.json({ success: true, ...authViewModel.toMeResponse(result) });
});

module.exports = { sendOtp, register, login, loginWithPassword, me };
