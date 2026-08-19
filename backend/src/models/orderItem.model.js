const { Schema, model } = require('mongoose');

const orderItemSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    // Snapshotted at order time, so an old invoice stays correct even if the
    // product is later renamed, re-priced, or deleted. English variants are
    // nullable (Section 14 Part 2) - a catalog-linked product commonly has
    // no English name/manufacturer set (Excel import only captures Arabic,
    // see productCatalog.service.js), so the snapshot can't guarantee one
    // either. Callers fall back to the Arabic value for display.
    productNameAr: { type: String, required: true },
    productNameEn: { type: String, default: null },
    manufacturerAr: { type: String, required: true },
    manufacturerEn: { type: String, default: null },
    quantity: { type: Number, required: true, min: 1 },
    // Both SYP, locked in at order time - discountPrice already has any
    // active Offer AND manufacturer discount (Section 15) stacked in, but
    // neither the percentage nor which manufacturer applied is stored here
    // (project owner's decision) - only savingsUsd below carries that this
    // item was discounted at all, as a plain USD amount.
    unitPrice: { type: Number, required: true },
    discountPrice: { type: Number, required: true },
    // USD, not SYP (Section 15 - deliberately the one price-ish field on
    // this model that isn't) - (unitPriceUsd - discountedPriceUsd) *
    // quantity at order time, from the catalog's native currency directly
    // rather than back-converted from the SYP fields above, so it isn't
    // compounding two separate roundings. 0 when nothing was discounted.
    savingsUsd: { type: Number, default: 0 },
  },
  { timestamps: true }
);

orderItemSchema.index({ orderId: 1 });
orderItemSchema.index({ productId: 1 });

module.exports = model('OrderItem', orderItemSchema);
