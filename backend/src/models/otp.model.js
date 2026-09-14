const { Schema, model } = require('mongoose');

// The two things an OTP can authorise. They are kept apart so a code minted
// for one purpose can never be replayed against the other: without this, a
// code issued by the (currently dormant) login flow would be accepted by
// /auth/reset-password, turning any "log me in" code into a password-reset
// token. verifyOtp filters on it, sendOtp stamps it.
const OTP_PURPOSES = ['login', 'password_reset'];

const otpSchema = new Schema(
  {
    phone: { type: String, required: true },
    code: { type: String, required: true },
    purpose: { type: String, enum: OTP_PURPOSES, default: 'login', required: true },
    expiresAt: { type: Date, required: true },
    isUsed: { type: Boolean, default: false },
    // Wrong-code guesses against THIS code (Audit H-3c). otp.service.js burns
    // the code once this passes its ceiling, so a 6-digit secret cannot be
    // walked through its 10^6 space by repeated calls.
    attempts: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Rate limiting (max 3 OTPs per phone per 15 minutes) is enforced in otp.service.js
// by counting recent documents - no extra fields needed for it here.
// `purpose` joins the key because verifyOtp now looks up the newest live code
// for a (phone, purpose) pair rather than matching the code value itself.
otpSchema.index({ phone: 1, purpose: 1, expiresAt: 1 });
// TTL index: MongoDB automatically deletes the document once expiresAt is reached.
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = model('Otp', otpSchema);
module.exports.OTP_PURPOSES = OTP_PURPOSES;
