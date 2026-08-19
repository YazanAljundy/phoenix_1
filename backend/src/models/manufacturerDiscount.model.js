const { Schema, model } = require('mongoose');

// Section 15: a warehouse-set, always-on discount applied to every one of
// its own products from a given manufacturer - distinct from Offer
// (admin-approved, time-bounded, per-product). Stacks with an active Offer
// on the same product rather than replacing it (project owner's decision),
// see productCatalog.service.js's computeDiscountedPriceUsd.
const manufacturerDiscountSchema = new Schema(
  {
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    manufacturerAr: { type: String, required: true, trim: true },
    discountPercentage: { type: Number, required: true, min: 1, max: 100 },
  },
  { timestamps: true }
);

// One discount rule per (warehouse, manufacturer) - editing an existing
// rule is a PATCH, not a second row.
manufacturerDiscountSchema.index({ warehouseId: 1, manufacturerAr: 1 }, { unique: true });

module.exports = model('ManufacturerDiscount', manufacturerDiscountSchema);
