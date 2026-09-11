const { Schema, model } = require('mongoose');

// One row per live session (audit F-03). A session, not a user: the pharmacy
// app and the React panel can be signed into the same account at once, and a
// pharmacist with two devices keeps both - which is why this is its own
// collection rather than a pair of fields on the user document.
//
// Shape follows otp.model.js, the codebase's only other expiring document:
// an explicit absolute `expiresAt`, a lookup index, and a TTL index so
// MongoDB reaps dead rows without a cron job.
const refreshTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },

    // sha256 of the raw token, never the token itself. Deliberately NOT
    // bcrypt, unlike user.password: the raw value is 32 bytes from
    // crypto.randomBytes, so there is no low-entropy secret to slow an
    // attacker down over, and a deterministic digest is what lets the refresh
    // path find the row with an indexed findOne. bcrypt would force a scan of
    // every outstanding session on every refresh.
    tokenHash: { type: String, required: true, unique: true },

    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

// Revoking every session for one account - block, reject, password change -
// is a deleteMany on this.
refreshTokenSchema.index({ userId: 1 });

// TTL: MongoDB deletes the row once expiresAt passes, so an abandoned session
// cannot accumulate forever.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = model('RefreshToken', refreshTokenSchema);
