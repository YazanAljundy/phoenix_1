const { Schema, model } = require('mongoose');

// Money-Flow V2. ONE immutable financial fact posted to a LedgerAccount.
//
// Nothing here is ever updated after insert and nothing is ever deleted. A
// mistake is undone by posting a *_reversal entry that references the original
// and exactly negates its amounts (copied, never recomputed at today's rate),
// so the history of what was believed - and when - survives intact.

// Which side of the account an entry moves. Kept as its own field rather than
// inferred from `kind` at read time so a query can filter on it directly.
const DEBIT = 'debit';   // pharmacy owes MORE  -> +amountSyp
const CREDIT = 'credit'; // pharmacy owes LESS  -> -amountSyp

// Every kind, and the direction it always carries. The enum is deliberately
// shaped so each value maps cleanly onto one leg of a future double-entry
// journal (see the V2 spec §16) if the platform ever needs consolidated
// accounting - adding the counter-leg would not change any row written here.
const ENTRY_KINDS = {
  charge: DEBIT,                  // a delivered order
  charge_reversal: CREDIT,        // that order was never really delivered
  payment: CREDIT,                // a settlement the warehouse recorded
  payment_reversal: DEBIT,        // that payment was recorded in error
  return_credit: CREDIT,          // an approved return, valued from the order
  return_credit_reversal: DEBIT,  // that credit was issued in error
  manual_credit: CREDIT,          // goodwill / dispute resolution (admin)
  manual_debit: DEBIT,            // missed charge / correction (admin)
  adjustment_reversal: null,      // opposite of whatever it reverses
  migration_adjustment: null,     // V1 -> V2 opening reconciliation
  opening_balance: null,          // V1 -> V2 opening position
};

const ledgerEntrySchema = new Schema(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'LedgerAccount', required: true },
    // Denormalised so the statement/report queries never need a join back to
    // the account just to scope by party.
    pharmacyId: { type: Schema.Types.ObjectId, ref: 'Pharmacy', required: true },
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },

    // Monotonic per account, gap-free, assigned by $inc on the account inside
    // the posting transaction. THIS - not wall-clock - breaks same-day ties in
    // a statement, so a backdated payment still lands on its real date without
    // the ordering becoming ambiguous.
    sequence: { type: Number, required: true },
    // Global, human-readable ("LE-000123") for support and audit references.
    entryNumber: { type: Number, required: true },

    kind: { type: String, enum: Object.keys(ENTRY_KINDS), required: true },
    direction: { type: String, enum: [DEBIT, CREDIT], required: true },

    // Magnitude, always >= 0. The signed value is
    // amountSyp * (direction === 'debit' ? +1 : -1).
    // Whole lira: the authoritative side of the ledger.
    amountSyp: { type: Number, required: true, min: 0 },
    // Frozen reporting projection, 2dp. Null only for migrated entries whose
    // historical rate could not be recovered.
    amountUsd: { type: Number, default: null },

    // The rate this entry's two amounts were derived through, captured once.
    // A later change to the global rate never touches these.
    fx: {
      rate: { type: Number, default: null },
      source: { type: String, enum: ['api', 'manual', 'order', 'estimated', 'migration'], default: null },
      rateAsOf: { type: Date, default: null },
      // true => amountUsd is a best guess (migration only). Surfaced in reports.
      estimated: { type: Boolean, default: false },
    },

    // When the row was written.
    postedAt: { type: Date, required: true, default: Date.now },
    // The BUSINESS date this entry belongs to (delivery date, payment date).
    // Statements group and order on this, never on postedAt alone.
    effectiveAt: { type: Date, required: true, default: Date.now },

    // Exactly one of these is set, depending on `kind`.
    source: {
      orderId: { type: Schema.Types.ObjectId, ref: 'Order', default: null },
      paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', default: null },
      returnId: { type: Schema.Types.ObjectId, ref: 'Return', default: null },
    },

    // Set on every *_reversal: the entry being negated. An entry can be
    // reversed at most once (unique partial index below), and a reversal is
    // itself un-reversible (enforced in ledger.service.js).
    reversalOf: { type: Schema.Types.ObjectId, ref: 'LedgerEntry', default: null },

    // The acting user. Null for system-posted charges, where the actor is the
    // order's own status-change author.
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    // Required (non-empty) for manual_credit / manual_debit / every reversal /
    // migration_adjustment - enforced in ledger.service.js's postEntry.
    reason: { type: String, default: null },

    idempotencyKey: { type: String, default: null },

    // Kind-specific frozen context: for return_credit the whole valuation
    // breakdown, for charge a copy of the order's pricing lines - so a
    // statement or a dispute never has to recompute anything.
    metadata: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

// Gap-free ordering per account.
ledgerEntrySchema.index({ accountId: 1, sequence: 1 }, { unique: true });
ledgerEntrySchema.index({ entryNumber: 1 }, { unique: true });
// Statement render: everything for an account in business-date order.
ledgerEntrySchema.index({ accountId: 1, effectiveAt: 1, sequence: 1 });

// THE double-charge guard: one 'charge' per order, at the database level.
// The $type clause matters as much as the kind clause: without it every entry
// that has no order (a payment, an adjustment) shares the key `null` and the
// second one collides.
ledgerEntrySchema.index(
  { 'source.orderId': 1 },
  { unique: true, partialFilterExpression: { kind: 'charge', 'source.orderId': { $type: 'objectId' } } }
);
// One credit per approved return - same reasoning.
ledgerEntrySchema.index(
  { 'source.returnId': 1 },
  {
    unique: true,
    partialFilterExpression: { kind: 'return_credit', 'source.returnId': { $type: 'objectId' } },
  }
);
// One entry per payment event (the settlement and its reversal are two
// different Payment documents, so this stays unique per payment).
ledgerEntrySchema.index(
  { 'source.paymentId': 1, kind: 1 },
  { unique: true, partialFilterExpression: { 'source.paymentId': { $type: 'objectId' } } }
);
// An entry may be reversed at most once.
ledgerEntrySchema.index(
  { reversalOf: 1 },
  { unique: true, partialFilterExpression: { reversalOf: { $type: 'objectId' } } }
);
// Idempotent replays of payment / manual-adjustment posts.
ledgerEntrySchema.index(
  { idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }
);
// Warehouse settlement + platform reporting: charges in a period.
ledgerEntrySchema.index({ warehouseId: 1, kind: 1, effectiveAt: 1 });

module.exports = model('LedgerEntry', ledgerEntrySchema);
module.exports.ENTRY_KINDS = ENTRY_KINDS;
module.exports.DEBIT = DEBIT;
module.exports.CREDIT = CREDIT;
