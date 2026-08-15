const { Schema, model } = require('mongoose');

const priceHistoryEntrySchema = new Schema(
  {
    oldPrice: { type: Number, required: true },
    newPrice: { type: Number, required: true },
    changedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    changedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const productSchema = new Schema(
  {
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
    // Reserved for future cross-warehouse price comparison - not used in logic yet.
    masterProductId: { type: Schema.Types.ObjectId, ref: 'ProductCatalog', default: null },
    nameAr: { type: String, required: true, trim: true },
    nameEn: { type: String, required: true, trim: true },
    manufacturerAr: { type: String, required: true, trim: true },
    manufacturerEn: { type: String, required: true, trim: true },
    description: { type: String, default: null },
    // Reserved for a later stage - not used in the UI yet.
    barcode: { type: String, default: null },
    image: { type: String, default: null },
    price: { type: Number, required: true, min: 0 },
    stockQuantity: { type: Number, required: true, min: 0, default: 0 },
    // Computed by product.service.js as (!manuallyDisabled && stockQuantity > 0)
    // whenever stock or manuallyDisabled changes - not written to directly by controllers.
    isAvailable: { type: Boolean, default: true },
    manuallyDisabled: { type: Boolean, default: false },
    unitAr: { type: String, required: true },
    unitEn: { type: String, required: true },
    isActive: { type: Boolean, default: true },
    lastPriceUpdate: { type: Date, default: Date.now },
    priceHistory: { type: [priceHistoryEntrySchema], default: [] },
  },
  { timestamps: true }
);

productSchema.index({ warehouseId: 1, categoryId: 1 });
productSchema.index({ nameAr: 'text', nameEn: 'text', manufacturerAr: 'text', manufacturerEn: 'text' });

module.exports = model('Product', productSchema);
