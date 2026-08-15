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
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

warehouseSchema.index({ userId: 1 });
warehouseSchema.index({ city: 1 });

module.exports = model('Warehouse', warehouseSchema);
