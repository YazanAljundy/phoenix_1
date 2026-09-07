const { Schema, model } = require('mongoose');

// A record that a warehouse actually PAID the platform the commission it owed
// for some period.
//
// Deliberately NOT a LedgerEntry, and deliberately not posted to any
// LedgerAccount. A LedgerAccount is the pharmacy↔warehouse receivable: what a
// pharmacy owes a warehouse for goods. Commission is a different relationship
// entirely - warehouse↔platform - and mixing it into the pharmacy's balance
// would corrupt the one number the whole ledger exists to keep honest.
//
// This is the same call Step 6 made for the settlement report itself: a report
// over frozen order fields, not a second ledger. Commission owed is *derived*
// (settlement.service.js recomputes it from delivered orders every time); this
// collection is the only piece of commission state that is *stored*, because
// "someone handed over money" is a fact no computation can derive.
//
// If the platform ever needs a real warehouse↔platform ledger - running
// balances, statements, reversals that compose - this model is the migration's
// input, not its competitor.
const commissionCollectionSchema = new Schema(
  {
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },

    // The settlement window this payment covers. Stored rather than derived
    // because the admin picks it freely, and a collection has to keep meaning
    // the same thing when it is read back months later.
    //
    // Overlapping windows are ALLOWED: a warehouse might pay a quarter in one
    // go and later a month inside it. The overview sums every active
    // collection whose window overlaps the range being viewed, which is the
    // honest reading of "how much of this range has been settled".
    periodFrom: { type: Date, required: true },
    periodTo: { type: Date, required: true },

    // Whole lira, like every settlement figure. Not necessarily the full
    // amount owed - a partial payment is a normal thing.
    amountSyp: { type: Number, required: true, min: 0 },

    // Same vocabulary as a pharmacy payment (payment.model.js's METHODS) so
    // the two read alike; reconciliation detail only, never changes a figure.
    method: { type: String, enum: ['cash', 'bank_transfer', 'cheque', 'other'], default: 'cash' },
    reference: { type: String, default: null, trim: true },
    note: { type: String, default: null, trim: true },

    recordedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    recordedAt: { type: Date, required: true, default: Date.now },

    // `status` is the only field that ever changes, and only once. A mistake
    // is reversed, never deleted - the same rule the rest of Money-Flow V2
    // follows, so the history shows what was believed and when.
    status: { type: String, enum: ['recorded', 'reversed'], default: 'recorded' },
    reversedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reversedAt: { type: Date, default: null },
    reversalReason: { type: String, default: null, trim: true },
  },
  { timestamps: true }
);

// The overview's per-warehouse sum: find({warehouseId, status:'recorded'})
// with an overlap test on the two period bounds.
commissionCollectionSchema.index({ warehouseId: 1, status: 1, periodFrom: 1, periodTo: 1 });
// The history list, newest first.
commissionCollectionSchema.index({ warehouseId: 1, recordedAt: -1 });

module.exports = model('CommissionCollection', commissionCollectionSchema);
