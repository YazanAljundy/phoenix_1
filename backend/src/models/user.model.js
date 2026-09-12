const { Schema, model } = require('mongoose');

const deviceTokenSchema = new Schema(
  {
    fcmToken: { type: String, required: true },
    deviceType: { type: String, enum: ['android', 'ios'], required: true },
    lastUsedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, unique: true, trim: true },
    password: { type: String, select: false },
    role: {
      type: String,
      enum: ['admin', 'warehouse', 'pharmacy'],
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'active', 'blocked'],
      default: 'pending',
    },
    lang: { type: String, enum: ['ar', 'en'], default: 'ar' },
    deviceTokens: { type: [deviceTokenSchema], default: [] },

    // Bumped to invalidate every access token already issued for this user
    // (audit F-03). authenticate compares it against the claim in the token,
    // reading it from the findById it already performs - so revocation costs
    // no extra query. Defaults to 0, and a token minted before this field
    // existed carries no claim and is read as 0, so deploying it logs nobody
    // out.
    tokenVersion: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Level 2 (see docs/PERFORMANCE_OPTIMIZATION.md). warehouse.listAvailableWarehouses
// (`find({ role:'warehouse', status:'active' })`, on the browsing path) plus the
// admin pending-account list/count and the broadcast recipient scan all filtered
// role + status with no supporting index - a full users scan each time.
userSchema.index({ role: 1, status: 1 });

module.exports = model('User', userSchema);
