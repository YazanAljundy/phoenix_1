const { Schema, model } = require('mongoose');

const statusHistoryEntrySchema = new Schema(
  {
    status: { type: String, required: true },
    changedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    changedAt: { type: Date, default: Date.now },
    // Only set for entries that aren't a plain status transition (e.g.
    // 'modified' - the warehouse edited the order's items while it was still
    // pending, see warehouseOrder.service.js's updateOrderItems). null for
    // every ordinary status change.
    note: { type: String, default: null },
  },
  { _id: false }
);

// One product line of a package, exactly as the Advertisement listed it at
// order time: the quantity here is for ONE copy of the package, so the units
// actually ordered are `quantity x group.copies`.
const orderPackageItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

// The package's terms, frozen at order time. This is the whole point of the
// package group: once an order exists, NOTHING about how it is priced may be
// re-read from the live Advertisement. The warehouse remains free to edit or
// withdraw the advertisement itself - orders already placed against it keep
// the terms the pharmacy actually agreed to.
//
// `usdToSyp` is the order's own fx.rate, copied here so a `copies` change
// months later converts the package total at the SAME rate the order's lines
// were priced through, instead of mixing today's rate into a frozen invoice.
const orderPackageSnapshotSchema = new Schema(
  {
    // Kept so the warehouse's order screen can name the package without
    // reaching for the live Advertisement (which may since have been retitled
    // or deleted outright).
    titleAr: { type: String, default: null },
    titleEn: { type: String, default: null },
    // The price of ONE copy of the package, in USD - the figure the pharmacy
    // agreed to. `group.totalPriceUsd` below is this x copies.
    totalPriceUsd: { type: Number, required: true, min: 0 },
    items: { type: [orderPackageItemSchema], required: true },
    usdToSyp: { type: Number, required: true },
  },
  { _id: false }
);

// A package bought as a unit. Its `_id` is what every OrderItem belonging to
// it carries as `packageGroupId` (orderItem.model.js), which is how the edit
// path tells a locked package line from an ordinary one.
//
// An order can hold several of these (two different packages, or the same
// package is one group with copies > 1 - never two groups for one
// advertisement), alongside ordinary product lines.
const orderPackageGroupSchema = new Schema({
  advertisementId: { type: Schema.Types.ObjectId, ref: 'Advertisement', required: true },
  advertisementSnapshot: { type: orderPackageSnapshotSchema, required: true },
  // How many whole copies of the package. The only field on a placed order's
  // package the warehouse may still change.
  copies: { type: Number, required: true, min: 1, default: 1 },
  // advertisementSnapshot.totalPriceUsd x copies - stored rather than derived
  // so a report never has to multiply it back out.
  totalPriceUsd: { type: Number, required: true, min: 0 },
});

const orderSchema = new Schema(
  {
    // Sequential, generated via the counters collection - see counter.model.js.
    orderNumber: { type: Number, required: true, unique: true },
    pharmacyId: { type: Schema.Types.ObjectId, ref: 'Pharmacy', required: true },
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'],
      default: 'pending',
    },
    // Money-Flow V2. Every money field below is SYP, locked in at order
    // creation. `currency` is explicit rather than implied so a future
    // multi-currency order is a data change, not a schema change.
    currency: { type: String, enum: ['SYP'], default: 'SYP' },
    // The exchange rate this order was priced through, captured ONCE at
    // creation and never recomputed. A later change to the global rate prices
    // new orders only - it can no longer reach back and restate this one (the
    // V1 defect: pharmacyBalance re-divided every historical order by TODAY's
    // rate on every recompute).
    fx: {
      rate: { type: Number, default: null },
      source: { type: String, enum: ['api', 'manual', 'order', 'estimated', 'migration'], default: null },
      rateAsOf: { type: Date, default: null },
      estimated: { type: Boolean, default: false },
    },
    totalPrice: { type: Number, required: true },
    // The PLATFORM discount - always round(totalPrice * warehouse.discountRate
    // / 100), recomputed from that rate on every order edit. Deliberately not
    // a free-form field: the advertisement package discount below is kept
    // separate precisely so an order edit can't silently wipe it.
    discountAmount: { type: Number, required: true },
    commissionAmount: { type: Number, required: true },
    // finalPrice = totalPrice - discountAmount - advertisementDiscountAmount.
    // This is the amount the pharmacy owes, and the amount the delivery posts
    // to the ledger as a `charge`.
    finalPrice: { type: Number, required: true },
    // Money-Flow V2: the same figure in USD, frozen at creation through
    // fx.rate above. Reports sum THIS rather than dividing finalPrice by
    // whatever the rate happens to be when the report runs.
    finalAmountUsd: { type: Number, default: null },
    // The packages bought on this order, each frozen at its agreed terms. An
    // order with none of them is an ordinary order and behaves exactly as it
    // always has.
    orderPackageGroups: { type: [orderPackageGroupSchema], default: [] },
    // Legacy, kept for orders placed before orderPackageGroups existed and for
    // the reports that already read it. The migration
    // (scripts/migrate-order-package-groups.js) backfills the group array from
    // these two, and createOrder still sets advertisementId to the FIRST
    // group's advertisement so nothing downstream that filters on it breaks.
    //
    // APPROXIMATE MIRROR OF THE FIRST GROUP ONLY. Safe as a boolean ("did this
    // order involve a package?") and as a filter; NEVER safe for a figure
    // attributed to a particular package, because an order can carry several
    // and this names one of them. Anything that needs to attribute money reads
    // `orderPackageGroups` (each entry has its own advertisementId and its own
    // frozen snapshot), or `advertisementIds` below for the plain list.
    advertisementId: { type: Schema.Types.ObjectId, ref: 'Advertisement', default: null },
    // Every package on this order, in `orderPackageGroups` order. Kept in step
    // with that array by createOrder and by the warehouse edit path, so a
    // report can filter on "orders involving package X" without unwinding the
    // group array. Empty on an order with no packages.
    advertisementIds: {
      type: [{ type: Schema.Types.ObjectId, ref: 'Advertisement' }],
      default: [],
    },
    // The total package saving on this order, in SYP: the gap between the
    // package lines' catalog prices and the package totals, summed over every
    // group. Every money report (ledger, settlement, invoice, savings) reads
    // THIS rather than the groups, so their arithmetic is untouched by the
    // group array above.
    advertisementDiscountAmount: { type: Number, default: 0 },
    notes: { type: String, default: null },
    // Opt-in proof-of-delivery, decided PER ORDER. Seeded at creation from the
    // warehouse's own default (warehouse.requireDeliverySealPhoto), then owned
    // by the order alone - a later change to the warehouse default never
    // touches an existing order. The warehouse can still flip this per order
    // from the order-detail screen (warehouseOrder.service.setDeliverySealRequirement).
    // `default: false` so every pre-existing order behaves exactly as before -
    // no migration.
    requiresDeliverySealPhoto: { type: Boolean, default: false },
    // The pharmacy uploads a photo of the shipment seal/stamp while the order
    // is 'out_for_delivery'; only the Cloudinary delivery URL is stored, same
    // as return.images[] / banner.imageUrl. deliverySealConfirmedAt marks when
    // the pharmacy confirmed; the order status itself is untouched by this (the
    // warehouse still advances it). Both null on every existing order.
    deliverySealPhoto: { type: String, default: null },
    deliverySealConfirmedAt: { type: Date, default: null },
    // Always the pharmacist's user - the warehouse has no cancellation authority from the app.
    cancelledBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    cancelReason: { type: String, default: null },
    statusHistory: { type: [statusHistoryEntrySchema], default: [] },

    // Money-Flow V2 -----------------------------------------------------
    // Assigned once, at the delivery transaction, from the `invoice_number`
    // counter. Null until delivered; never reused, and kept (marked void)
    // even if the delivery is later reversed - an invoice number that changes
    // meaning is worse than a gap.
    invoiceNumber: { type: Number, default: null },
    deliveredAt: { type: Date, default: null },
    // Back-reference to the one `charge` ledger entry this order produced.
    // The authoritative guard against double-charging is the unique partial
    // index on LedgerEntry.source.orderId; this is for cheap reads.
    chargeEntryId: { type: Schema.Types.ObjectId, ref: 'LedgerEntry', default: null },
    // Client-supplied UUID. A retried submission with the same key returns the
    // original order instead of creating a second one.
    idempotencyKey: { type: String, default: null },
  },
  { timestamps: true }
);

// Level 2 (see docs/PERFORMANCE_OPTIMIZATION.md). Each index matches one real
// query's Equality-Sort-Range shape; the three former single-field indexes
// (`pharmacyId`, `warehouseId`, `status`) are each a prefix of one of these
// and are dropped by scripts/level2-index-migration.js.
//
// listOrdersForPharmacy: find({ pharmacyId, orderNumber:{$lt} }).sort({ orderNumber:-1 })
orderSchema.index({ pharmacyId: 1, orderNumber: -1 });
// listOrdersForWarehouse (status tab): find({ warehouseId, status, orderNumber:{$gt} }).sort({ orderNumber:1 })
orderSchema.index({ warehouseId: 1, status: 1, orderNumber: 1 });
// listOrdersForWarehouse ("all" tab, no status): find({ warehouseId, orderNumber:{$gt} }).sort({ orderNumber:1 })
orderSchema.index({ warehouseId: 1, orderNumber: 1 });
// listReturnableOrders: find({ pharmacyId, status:'delivered', updatedAt:{$gte} })
// (its { pharmacyId, status } prefix also serves the delivered-order reads)
orderSchema.index({ pharmacyId: 1, status: 1, updatedAt: -1 });

// Money-Flow V2. Sparse-unique: only delivered orders carry a number, and no
// two ever share one.
orderSchema.index(
  { invoiceNumber: 1 },
  { unique: true, partialFilterExpression: { invoiceNumber: { $type: 'number' } } }
);
// Order-creation idempotency, scoped per pharmacy - a key only has to be
// unique to the pharmacy that generated it.
orderSchema.index(
  { pharmacyId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }
);

module.exports = model('Order', orderSchema);
