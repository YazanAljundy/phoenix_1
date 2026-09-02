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
    // Nullable at the schema level only for legacy rows created before
    // Section 14 Part 2 - warehouseProduct.service.js's createProduct
    // enforces this as required for every new product (business rule, not a
    // DB constraint), so a Mongoose-level `required: true` here would break
    // `.save()` on the legacy rows below the moment anything else about them
    // changes. Categorization for an imported product may also not be set
    // yet (the catalog's own categoryId is optional too, see
    // productCatalog.model.js), hence also nullable here.
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', default: null },
    // Section 14 Part 2: the source of truth for name/manufacturer once set
    // - resolved live from the populated catalog entry wherever a product is
    // read (see productCatalog.service.js's applyResolvedIdentity), never
    // duplicated onto this document at write time. Only OrderItem snapshots
    // a copy, and only at order time (Section 6.8).
    masterProductId: { type: Schema.Types.ObjectId, ref: 'ProductCatalog', default: null },
    // legacy — needs catalog linking: only ever read directly (as a
    // fallback) for a product created before Part 2, i.e. masterProductId is
    // null. New products leave these unset; nothing writes to them anymore.
    nameAr: { type: String, default: null, trim: true },
    nameEn: { type: String, default: null, trim: true },
    manufacturerAr: { type: String, default: null, trim: true },
    manufacturerEn: { type: String, default: null, trim: true },
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
    // Required for manual entry (warehouseProduct.service.js's createProduct
    // still asks for it on the form) but not for an Excel-imported row - the
    // import template has no unit column, same reasoning as categoryId above.
    unitAr: { type: String, default: null },
    unitEn: { type: String, default: null },
    isActive: { type: Boolean, default: true },
    lastPriceUpdate: { type: Date, default: Date.now },
    priceHistory: { type: [priceHistoryEntrySchema], default: [] },
  },
  { timestamps: true }
);

// Level 2 (see docs/PERFORMANCE_OPTIMIZATION.md). The pharmacist-facing catalog
// browse (product.service fetchMatchingPage) cursors on `_id` ascending:
//   with a category filter -> {warehouseId,categoryId,_id}
//   without one            -> {warehouseId,_id}
// The `_id` suffix on the first supersedes the old {warehouseId,categoryId}
// (its prefix still serves warehouseProduct.listProductsForWarehouse and the
// manufacturer `distinct` filter) - dropped by the migration script.
productSchema.index({ warehouseId: 1, categoryId: 1, _id: 1 });
productSchema.index({ warehouseId: 1, _id: 1 });

// The former `text` index on nameAr/nameEn/manufacturerAr/manufacturerEn was
// removed: Level 1 rewrote catalog search to match a case-insensitive RegExp on
// the ProductCatalog master list (product.service / adminProduct.service), and
// nothing in the codebase issues a `$text` query any more. Dropped by
// scripts/level2-index-migration.js. Re-add here if a `$text` search is built.

// A warehouse can't link the same catalog entry to two of its own products
// (Section 14 Part 2) - partial so it only applies once masterProductId is
// actually set, leaving legacy (null-masterProductId) rows unconstrained.
productSchema.index(
  { warehouseId: 1, masterProductId: 1 },
  { unique: true, partialFilterExpression: { masterProductId: { $type: 'objectId' } } }
);

module.exports = model('Product', productSchema);
