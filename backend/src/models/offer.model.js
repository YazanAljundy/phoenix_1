const { Schema, model } = require('mongoose');

const offerSchema = new Schema(
  {
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    titleAr: { type: String, required: true },
    titleEn: { type: String, required: true },
    discountPercentage: { type: Number, required: true, min: 0, max: 100 },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    // No "rejected" state - an offer is either waiting or approved by the admin.
    status: { type: String, enum: ['pending', 'approved'], default: 'pending' },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

offerSchema.index({ productId: 1 });
offerSchema.index({ warehouseId: 1, status: 1 });

module.exports = model('Offer', offerSchema);
