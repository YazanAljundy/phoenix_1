const { Schema, model } = require('mongoose');

const otpSchema = new Schema(
  {
    phone: { type: String, required: true },
    code: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    isUsed: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Rate limiting (max 3 OTPs per phone per 15 minutes) is enforced in otp.service.js
// by counting recent documents - no extra fields needed for it here.
otpSchema.index({ phone: 1, expiresAt: 1 });
// TTL index: MongoDB automatically deletes the document once expiresAt is reached.
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = model('Otp', otpSchema);
