const { Schema, model } = require('mongoose');

const reviewSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    pharmacyId: { type: Schema.Types.ObjectId, ref: 'Pharmacy', required: true },
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    // 'pharmacy' = the pharmacy rated the warehouse; 'warehouse' = the warehouse rated the pharmacy.
    reviewerType: { type: String, enum: ['pharmacy', 'warehouse'], required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, default: null },
    // Both directions are visible immediately - kept as a real field (rather
    // than removed outright) in case a future moderation need brings back a
    // reason to hide a review.
    isVisible: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Prevents the same party from reviewing the same order more than once, while still
// allowing one review from each side of the same order (reviewerType differs).
reviewSchema.index({ orderId: 1, reviewerType: 1 }, { unique: true });

// Level 2 (see docs/PERFORMANCE_OPTIMIZATION.md). Before these, every
// "reviews received by warehouse X" / "by pharmacy X" query (the pharmacist's
// warehouse-profile screen, the review lists, and the $group rating-stats
// aggregate) was a full collection scan.
//
// listReviewsForWarehouse / listPaginatedReviewsForWarehouse / getReviewStats:
// find({ warehouseId, reviewerType, isVisible }) then either .sort({ _id:-1 })
// (paginated - served directly), .sort({ createdAt:-1 }) (profile - bounded
// in-memory sort of the matched set), or $group (aggregate - served directly).
reviewSchema.index({ warehouseId: 1, reviewerType: 1, isVisible: 1, _id: -1 });
// listReviewsForPharmacy: find({ pharmacyId, reviewerType }).sort({ createdAt:-1 })
reviewSchema.index({ pharmacyId: 1, reviewerType: 1, createdAt: -1 });

module.exports = model('Review', reviewSchema);
