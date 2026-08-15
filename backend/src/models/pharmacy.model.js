const { Schema, model } = require('mongoose');

const pharmacySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    nameAr: { type: String, required: true, trim: true },
    nameEn: { type: String, required: true, trim: true },
    ownerName: { type: String, required: true },
    address: { type: String, required: true },
    city: { type: String, required: true },
    phone: { type: String, required: true },
    // Photo of the pharmacy's storefront/sign, required at registration and
    // used by the admin to verify the pharmacy physically exists before
    // approving it. Entirely separate from licenseImage below (an official
    // syndicate document, still unused/reserved).
    verificationPhoto: { type: String, default: null },
    // Reserved for a later stage - not used in the UI yet.
    licenseNumber: { type: String, default: null },
    licenseImage: { type: String, default: null },
    addedBy: { type: String, enum: ['admin', 'self'], required: true },
    averageRating: { type: Number, default: 0 },
    reviewsCount: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

pharmacySchema.index({ userId: 1 });
pharmacySchema.index({ city: 1 });

module.exports = model('Pharmacy', pharmacySchema);
