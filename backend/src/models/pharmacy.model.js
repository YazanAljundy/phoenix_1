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
    // Optional - captured via the registration screen's map picker
    // (OpenStreetMap/Nominatim). `address` above stays the human-readable
    // text shown everywhere; this is only for future map/distance features.
    // GeoJSON order is [longitude, latitude], not [lat, lng].
    //
    // No default anywhere in here (not even 'Point' on the inner `type`) -
    // a default there makes Mongoose materialize a `{ type: 'Point' }`
    // subdocument with no `coordinates` on every save(), even for pharmacies
    // that never set a location, and the 2dsphere index then rejects that as
    // an invalid GeoJSON point on every single save. auth.service.js only
    // ever sets this whole field together with real coordinates, or not at
    // all - the schema needs to actually allow "not at all".
    location: {
      type: { type: String, enum: ['Point'] },
      coordinates: { type: [Number] },
    },
  },
  { timestamps: true }
);

pharmacySchema.index({ userId: 1 });
pharmacySchema.index({ city: 1 });
pharmacySchema.index({ location: '2dsphere' });

module.exports = model('Pharmacy', pharmacySchema);
