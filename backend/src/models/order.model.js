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
    // Set when this order came from a warehouse advertisement package
    // (advertisement.model.js). The package total is the authoritative price
    // for the advertised lines, so the difference between the sum of their
    // advertised prices and that total is booked here, in SYP like every other
    // money field on this model. null/0 on a normal order, which is exactly how
    // every pre-existing order already behaves - no migration needed.
    advertisementId: { type: Schema.Types.ObjectId, ref: 'Advertisement', default: null },
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
