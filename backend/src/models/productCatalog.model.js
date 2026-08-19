const { Schema, model } = require('mongoose');

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
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// The import's upsert key (Section 14): a re-imported row with the same
// name+manufacturer updates in place instead of duplicating.
productCatalogSchema.index({ nameAr: 1, manufacturerAr: 1 }, { unique: true });

module.exports = model('ProductCatalog', productCatalogSchema);
