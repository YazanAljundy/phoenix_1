const { Schema, model } = require('mongoose');

// One line of a package: which product and how many of it. A package carries
// no per-product price - each product's price is always its CURRENT catalog
// price, read live wherever the package is shown or ordered, and the package
// total (totalPriceUsd below) is the one figure the warehouse sets. The normal
// Product.price is never touched, so a package can be withdrawn with nothing
// to undo. `quantity` defaults to 1 so an item written before quantities
// existed reads back as one unit.
const advertisementItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, required: true, min: 1, default: 1 },
  },
  { _id: false }
);

// A multi-product package a warehouse advertises to pharmacies. Distinct from
// Offer (offer.model.js), which is a single product's discount *percentage*
// applied automatically while browsing that warehouse's catalog: an
// Advertisement is a curated bundle of products sold together at one package
// price, entered through the cart rather than the catalog. The per-product
// prices are the live catalog prices; the package total is the discount. The
// two features are independent and neither reads the other.
const advertisementSchema = new Schema(
  {
    // Sequential, assigned atomically via counter.model.js (same pattern as
    // Banner's bannerNumber) - a short, human-readable id for the WhatsApp
    // conversation with the admin about publishing/payment, instead of the raw
    // ObjectId. Not `required`: rows created before this field existed have
    // none, and updateAdvertisement lazily assigns one the next time such a
    // row is saved.
    advertisementNumber: { type: Number },
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    titleAr: { type: String, required: true, trim: true },
    titleEn: { type: String, required: true, trim: true },
    items: { type: [advertisementItemSchema], required: true },
    // The price of the whole package - the figure the pharmacy actually pays,
    // set against the sum of the products' current catalog prices (shown
    // alongside it as context, and as a saving %). Editable after approval,
    // see the service.
    totalPriceUsd: { type: Number, required: true, min: 0 },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    // Unlike Offer (pending/approved, where a rejection just deletes the row),
    // a rejected advertisement is kept with its note: the warehouse curated a
    // whole package and needs to know what to fix - same reasoning as Banner.
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    rejectionNote: { type: String, default: null },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// The warehouse's own list, and the admin moderation queue via the `status`
// prefix.
advertisementSchema.index({ warehouseId: 1, status: 1 });
// sparse: pre-existing rows have no number and must not collide as duplicate
// nulls; every new advertisement still gets a unique one.
advertisementSchema.index({ advertisementNumber: 1 }, { unique: true, sparse: true });
// The pharmacist-facing "currently running" read - same status + date-range
// shape as bannerSchema's index.
advertisementSchema.index({ status: 1, startDate: 1, endDate: 1 });
advertisementSchema.index({ 'items.productId': 1 });

module.exports = model('Advertisement', advertisementSchema);
