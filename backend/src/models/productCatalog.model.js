const { Schema, model } = require('mongoose');

// Mirrors product.model.js's priceHistoryEntrySchema, for the same reason: a
// catalog entry's name is resolved live onto every linked product wherever
// one is read (productCatalog.service.js's applyResolvedIdentity) rather than
// copied at write time, so a rename silently restates what a medicine is
// called everywhere it appears. Without this there is no record of what it
// used to be. `changedBy` is nullable only because a rename can come from a
// script rather than a logged-in admin.
const nameHistoryEntrySchema = new Schema(
  {
    oldNameAr: { type: String, required: true },
    newNameAr: { type: String, required: true },
    changedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    changedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

// Section 14: the admin-curated master medicine list - Excel-import only, no
// direct create endpoint (see productCatalog.service.js). product.model.js's
// masterProductId already forward-references this collection by name
// ('ProductCatalog') for a later linking feature (Part 2, not built yet).
//
// categoryId/unitAr are nullable: the Excel template only carries name +
// price (Section 14 Part 1), so a freshly imported row has neither until an
// admin fills them in via PATCH.
const productCatalogSchema = new Schema(
  {
    nameAr: { type: String, required: true, trim: true },
    nameEn: { type: String, default: null, trim: true },
    manufacturerAr: { type: String, required: true, trim: true },
    manufacturerEn: { type: String, default: null, trim: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', default: null },
    unitAr: { type: String, default: null, trim: true },
    unitEn: { type: String, default: null, trim: true },
    // USD, matching every other price in the app (Section: USD-first catalog
    // pricing) - fed by the Excel template's "السعر (دولار)" column. Nullable:
    // a medicine can be imported into the central list with no price yet
    // (project owner's call) - a warehouse fills it in manually later, on its
    // own product, not here.
    priceUsd: { type: Number, default: null, min: 0 },
    // Case- and whitespace-normalized copies of nameAr/manufacturerAr, kept
    // in sync by the pre-validate hook below and never set by hand. They
    // exist purely so a lookup by name can be an indexed equality match:
    // warehouseProduct.service.js's import used to find its catalog entry
    // with a case-insensitive RegExp, which MongoDB cannot serve from the
    // {nameAr, manufacturerAr} index, so every imported row cost a full
    // collection scan. Backfilled onto existing documents by
    // scripts/backfill-catalog-search-keys.js.
    nameKey: { type: String, default: null },
    manufacturerKey: { type: String, default: null },
    nameHistory: { type: [nameHistoryEntrySchema], default: [] },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Lowercased and whitespace-collapsed. Arabic is caseless so toLowerCase is a
// no-op there; it's the Latin names (nameEn-style entries typed into the
// Arabic column) and stray double spaces from Excel that this actually
// normalizes - the same two things the old RegExp's 'i' flag and the
// template's trimming were covering.
function searchKey(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toLowerCase() : null;
}

// A hook rather than a setter on each path: the keys must also be correct for
// documents created through `Model.create` with only the display fields set,
// and must follow a later edit to either name (updateCatalogItem changes
// nameAr). Runs on every save, so the pair can never drift from the fields it
// mirrors.
productCatalogSchema.pre('validate', function setSearchKeys(next) {
  this.nameKey = searchKey(this.nameAr);
  this.manufacturerKey = searchKey(this.manufacturerAr);
  next();
});

// The import's upsert key (Section 14): a re-imported row with the same
// name+manufacturer updates in place instead of duplicating.
productCatalogSchema.index({ nameAr: 1, manufacturerAr: 1 }, { unique: true });

// What the warehouse import actually looks rows up by (Section 14 Part 2).
// Deliberately NOT unique: the display-name pair above is the uniqueness
// rule, and two entries differing only in case would collide here while
// remaining legal there - this index exists to make the lookup indexed, not
// to add a constraint.
productCatalogSchema.index({ nameKey: 1, manufacturerKey: 1 });

// Perf/pagination follow-up: plain single-field indexes backing the free-text
// $or search (offer.service.js's buildOfferSearchOr, adminProduct/product
// catalog search) - NOT a text index, see product.model.js's note on why.
// `nameAr` and `manufacturerAr` are skipped here: measured via explain(), a
// manufacturerAr-only regex query already gets an IXSCAN off the existing
// {nameAr,manufacturerAr} unique index above (MongoDB will scan any index
// that touches the filtered field rather than fall back to a full COLLSCAN),
// so a dedicated single-field index for either would be a pure duplicate with
// no measurable benefit - the "no index without justification" rule cuts the
// other way here.
productCatalogSchema.index({ nameEn: 1 });
productCatalogSchema.index({ manufacturerEn: 1 });

module.exports = model('ProductCatalog', productCatalogSchema);
// Exported so the import path and the backfill script derive their lookup
// keys with the exact same function the documents were written with.
module.exports.searchKey = searchKey;
