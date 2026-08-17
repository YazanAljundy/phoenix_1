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
    // USD, not SYP - warehouses enter and edit prices in USD (Section: USD-
    // first catalog pricing); SYP is derived live from the current exchange
    // rate wherever it's shown or charged (see order.service.js). Field name
    // kept as `price` to avoid a schema rename - always serialized as
    // `priceUsd` at the API boundary, see the viewmodels. priceHistory
    // entries below are USD too, same reasoning. Pre-existing SYP data was
    // converted once via scripts/migrate-prices-to-usd.js.
    price: { type: Number, required: true, min: 0 },
    // TODO(re-enable-stock): quantity tracking is on hold (project owner's
    // decision) - availability is manuallyDisabled-only for now. Field kept
    // commented rather than dropped so the column isn't lost on existing
    // documents and the tracking can come back without a migration.
    // stockQuantity: { type: Number, required: true, min: 0, default: 0 },
    // Computed by warehouseProduct.service.js as (!manuallyDisabled) whenever
    // manuallyDisabled changes - not written to directly by controllers.
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
