// TODO(re-enable-otp): this whole module is fully functional but currently
// unused - registration/login are password-only for now (project owner's
// decision, see auth.service.js). Left intact deliberately for a future
// re-enable, not deleted.
const crypto = require('crypto');
const env = require('../config/env');
const { ApiError } = require('../utils/ApiError');
const Otp = require('../models/otp.model');

const CODE_LENGTH = 6;
const EXPIRY_MINUTES = 5;
const MAX_ATTEMPTS_PER_WINDOW = 3;
const WINDOW_MINUTES = 15;

function generateCode() {
  return crypto
    .randomInt(0, 10 ** CODE_LENGTH)
    .toString()
    .padStart(CODE_LENGTH, '0');
}

// Sends the code over the configured channel. Only "console" (dev logging) is
// wired up so far - Section 3 of the spec explicitly leaves the real SMS
// provider as an open decision pending the project owner's testing.
async function deliverSms(phone, code) {
  const message = `Your Phoenix verification code is ${code}. It expires in ${EXPIRY_MINUTES} minutes.`;

  if (env.sms.provider === 'console') {
    // eslint-disable-next-line no-console
    console.log(`[SMS -> ${phone}] ${message}`);
    return;
  }

  throw new Error(
    `SMS provider "${env.sms.provider}" is not implemented yet. Set SMS_PROVIDER=console for development.`
  );
}

async function sendOtp(phone) {
  const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000);
  const recentCount = await Otp.countDocuments({
    phone,
    createdAt: { $gte: windowStart },
  });

  if (recentCount >= MAX_ATTEMPTS_PER_WINDOW) {
    throw ApiError.tooManyRequests(
      `Too many verification code requests for this number. Please wait ${WINDOW_MINUTES} minutes and try again.`
    );
  }

  const code = generateCode();
  const expiresAt = new Date(Date.now() + EXPIRY_MINUTES * 60 * 1000);

  await Otp.create({ phone, code, expiresAt });
  await deliverSms(phone, code);

  return { expiresAt };
}

async function verifyOtp(phone, code) {
  const otp = await Otp.findOne({
    phone,
    code,
    isUsed: false,
    expiresAt: { $gt: new Date() },
  }).sort({ createdAt: -1 });

  if (!otp) {
    throw ApiError.badRequest('Invalid or expired verification code.');
  }

  otp.isUsed = true;
  await otp.save();
}

module.exports = { sendOtp, verifyOtp };
