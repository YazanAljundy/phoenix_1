const { Schema, model } = require('mongoose');

const bannerSchema = new Schema(
  {
    // Sequential, assigned atomically via counter.model.js (same pattern as
    // Order's orderNumber) - a short, human-readable id for the WhatsApp
    // payment conversation instead of the raw ObjectId.
    bannerNumber: { type: Number, required: true },
    // null = the admin's own banner, not tied to any one warehouse.
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', default: null },
    // TODO(production): stored on the server's local filesystem, same as
    // verificationPhoto/return photos - migrate to Cloudflare R2 before any
    // real production deploy (see upload.middleware.js).
    imageUrl: { type: String, required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', default: null },
    // Resolved and snapshotted at creation time from the product (see
    // warehouseBanner.service.js/adminBanner.service.js) - not looked up
    // live on every read, same reasoning as OrderItem's snapshotted fields.
    manufacturerAr: { type: String, default: null },
    title: { type: String, required: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    rejectionNote: { type: String, default: null },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

// Backs both the active-banners query (status + date range) and the admin/
// warehouse list views (status alone, via the same compound index's prefix).
bannerSchema.index({ status: 1, startDate: 1, endDate: 1 });
bannerSchema.index({ bannerNumber: 1 }, { unique: true });

module.exports = model('Banner', bannerSchema);
