const { Schema, model } = require('mongoose');

const warehouseSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    nameAr: { type: String, required: true, trim: true },
    nameEn: { type: String, required: true, trim: true },
    address: { type: String, required: true },
    city: { type: String, required: true },
    phone: { type: String, required: true },
    logo: { type: String, default: null },
    discountRate: { type: Number, default: 4 },
    commissionRate: { type: Number, default: 1 },
    deliveryStartTime: { type: String, default: null },
    deliveryEndTime: { type: String, default: null },
    inventoryUpdateTime: { type: String, default: null },
    averageRating: { type: Number, default: 0 },
    reviewsCount: { type: Number, default: 0 },
    deliveryType: {
      type: String,
      enum: ['self', 'third_party'],
      default: 'self',
    },
    // Opt-in proof-of-delivery: when true, the warehouse can only advance an
    // order to 'delivered' once the pharmacy has uploaded a photo of the
    // shipment seal/stamp ("الختم") - see warehouseOrder.service.js's
    // advanceOrderStatus gate and order.service.js's attachDeliverySealPhoto.
    // Defaults to false so every existing warehouse is completely unaffected;
    // documents predating this field read as false.
    requireDeliverySealPhoto: { type: Boolean, default: false },
    // Per-warehouse order size limits, in USD - the same currency the cart
    // totals in, so no conversion sits between what the pharmacist sees and
    // what's enforced (order.service.js). Both are opt-in: 0 means "no
    // minimum" and null means "no maximum", which is what every existing
    // warehouse gets by default, leaving them unaffected.
    minOrderAmountUsd: { type: Number, default: 0, min: 0 },
    maxOrderAmountUsd: { type: Number, default: null, min: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

warehouseSchema.index({ userId: 1 });
warehouseSchema.index({ city: 1 });

module.exports = model('Warehouse', warehouseSchema);
