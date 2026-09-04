const { Schema, model } = require('mongoose');

// A warehouse's edit to an offer that is ALREADY approved is not applied
// straight away - it is parked here until an admin approves it, so the offer
// pharmacies currently see never changes mid-review (see warehouseOffer.service
// updateOffer / adminOffer.service approveOffer|rejectOffer). Same field shape
// as the offer itself; `endDate` is null when `isPermanent` is true.
const offerUpdateSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    titleAr: { type: String, required: true },
    titleEn: { type: String, required: true },
    discountPercentage: { type: Number, required: true, min: 0, max: 100 },
    startDate: { type: Date, required: true },
    endDate: { type: Date, default: null },
    isPermanent: { type: Boolean, default: false },
    requestedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const offerSchema = new Schema(
  {
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    titleAr: { type: String, required: true },
    titleEn: { type: String, required: true },
    discountPercentage: { type: Number, required: true, min: 0, max: 100 },
    startDate: { type: Date, required: true },
    // null = a permanent offer (no expiry). `isPermanent` is kept in lockstep
    // with this by the service and is what every query/UI checks, so neither
    // has to infer the other. A non-permanent offer always has an endDate.
    endDate: { type: Date, default: null },
    isPermanent: { type: Boolean, default: false },
    // No "rejected" state - an offer is either waiting or approved by the admin.
    status: { type: String, enum: ['pending', 'approved'], default: 'pending' },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null },
    // Set only on an approved offer whose warehouse has proposed an edit that
    // is itself waiting for the admin. null the rest of the time.
    pendingUpdate: { type: offerUpdateSchema, default: null },
  },
  { timestamps: true }
);

offerSchema.index({ productId: 1 });
offerSchema.index({ warehouseId: 1, status: 1 });
// The pharmacist-facing "currently running" read filters on status + the date
// window; a permanent offer matches on `isPermanent` instead of `endDate`.
offerSchema.index({ status: 1, startDate: 1, endDate: 1 });

module.exports = model('Offer', offerSchema);
