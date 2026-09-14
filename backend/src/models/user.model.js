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
    // 'deleted' is a self-service deletion (auth.service.js deleteAccount) and
    // is terminal: it is refused at authenticate, so it must never be treated
    // as merely "not active". Distinct from 'blocked', which an admin applies
    // and can lift - nobody can un-delete an account from the panel.
    status: {
      type: String,
      enum: ['pending', 'active', 'blocked', 'deleted'],
      default: 'pending',
    },
    lang: { type: String, enum: ['ar', 'en'], default: 'ar' },
    deviceTokens: { type: [deviceTokenSchema], default: [] },

    // Login throttling (Audit H-2). Counts CONSECUTIVE failures: reset to 0 by
    // any successful password check, so a user who mistypes twice and then
    // gets in carries nothing forward. auth.service.js owns the escalation.
    failedLoginAttempts: { type: Number, default: 0 },
    // While set and in the future, password login is refused even when the
    // password is correct.
    lockedUntil: { type: Date, default: null },

    // Set by deleteAccount alongside status: 'deleted'. Kept separate from
    // `updatedAt` so a later retention/purge job can find accounts by when the
    // user actually asked to leave.
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Level 2 (see docs/PERFORMANCE_OPTIMIZATION.md). warehouse.listAvailableWarehouses
// (`find({ role:'warehouse', status:'active' })`, on the browsing path) plus the
// admin pending-account list/count and the broadcast recipient scan all filtered
// role + status with no supporting index - a full users scan each time.
userSchema.index({ role: 1, status: 1 });

module.exports = model('User', userSchema);
