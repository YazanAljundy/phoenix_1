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
  },
  { timestamps: true }
);

module.exports = model('User', userSchema);
