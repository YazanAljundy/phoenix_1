const { Schema, model } = require('mongoose');

const bannerSchema = new Schema(
  {
    // Sequential, assigned atomically via counter.model.js (same pattern as
    // Order's orderNumber) - a short, human-readable id for the WhatsApp
    // payment conversation instead of the raw ObjectId.
    bannerNumber: { type: Number, required: true },
    // null = the admin's own banner, not tied to any one warehouse.
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', default: null },
    // Streamed straight to Cloudinary from memory, same as return/seal photos
    // (see upload.middleware.js / upload.service.js) - nothing is ever
    // written to the server's own filesystem.
    //
    // Required when the admin publishes directly (enforced in
    // adminBanner.controller.js); a warehouse-submitted banner may start
    // without one and get it from the admin during review (see
    // adminBanner.service.js's updateBanner) - not enforced at the schema
    // level so that path can save a null.
    imageUrl: { type: String, default: null },
    // 'image' (default - covers every pre-existing banner), 'gif', or
    // 'video'. Resolved from the uploaded file's real MIME type, not the
    // client-sent extension (see upload.middleware.js's
    // resolveAdminBannerMediaType). Only the admin's own upload path
    // (adminBanner.controller.js) can ever produce 'gif'/'video' - a
    // warehouse-submitted banner stays image-only, so this is always
    // 'image' there.
    mediaType: { type: String, enum: ['image', 'video', 'gif'], default: 'image' },
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
