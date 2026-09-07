const { Schema, model } = require('mongoose');

// One entry per problem item covered by this return - a single return can
// span multiple items from the same order (Section 6.9).
const returnItemSchema = new Schema(
  {
    orderItemId: { type: Schema.Types.ObjectId, ref: 'OrderItem', required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, required: true, min: 1 },
    reasonType: {
      type: String,
      enum: ['damaged', 'wrong_item', 'other'],
      required: true,
    },
    // Required only when reasonType = 'other' - enforced in return.service.js.
    customReason: { type: String, default: null },
  },
  { _id: false }
);

const returnSchema = new Schema(
  {
    // unique: only one return per order, ever - enforced at the DB level, not
    // just in the Service (Section 6.9/8).
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, unique: true },
    pharmacyId: { type: Schema.Types.ObjectId, ref: 'Pharmacy', required: true },
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    items: { type: [returnItemSchema], required: true },
    // One overall note and one shared photo set for the whole return, not per item.
    notes: { type: String, default: null },
    images: { type: [String], default: [] },
    // Money-Flow V2: approving a return CREDITS the pharmacy's account.
    //
    // V1 approved by creating a zero-priced replacement order and moving no
    // money at all, so a pharmacy that handed goods back kept the full bill -
    // and if the product could not be reshipped the approval failed outright,
    // leaving reject as the only option. The replacement mechanism is gone;
    // there is exactly one financial outcome now, and reject still carries a note.
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    rejectionNote: { type: String, default: null },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    resolvedAt: { type: Date, default: null },

    // The `return_credit` ledger entry this return produced, set on approval.
    // The authoritative "only one credit per return" guard is the unique
    // partial index on LedgerEntry.source.returnId; this is for cheap reads.
    creditEntryId: { type: Schema.Types.ObjectId, ref: 'LedgerEntry', default: null },
    // The credited amounts, frozen at approval, and the full working behind
    // them (returnCredit.service.js's breakdown) - so the statement, the
    // invoice and any later dispute all read the same numbers rather than
    // recomputing them against whatever the catalog and the rate say later.
    creditSyp: { type: Number, default: null },
    creditUsd: { type: Number, default: null },
    creditValuation: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

// Level 2 (see docs/PERFORMANCE_OPTIMIZATION.md). The warehouse returns queue
// paginates on _id descending (listPaginatedReturnsForWarehouse):
//   with a status filter -> {warehouseId,status,_id:-1}
//   without one          -> {warehouseId,_id:-1}
// The `_id:-1` suffix on the first also supersedes the old {warehouseId,status}
// (its {warehouseId,status} prefix still serves the unpaginated list + the
// "does this order have a return" lookup) - dropped by the migration script.
returnSchema.index({ warehouseId: 1, status: 1, _id: -1 });
returnSchema.index({ warehouseId: 1, _id: -1 });
returnSchema.index({ pharmacyId: 1 });

module.exports = model('Return', returnSchema);
