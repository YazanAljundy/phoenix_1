const { Schema, model } = require('mongoose');

// Money-Flow V2. Append-only narrative of every financial mutation: who did
// what, when, to which entity, what it looked like before and after, and why.
//
// Distinct from LedgerEntry: an entry is the atomic financial FACT, this is
// the record of the ACTION that produced it (including actions that produce no
// entry at all, like rejecting a return or changing the exchange rate).
// Nothing here is ever updated or deleted - the service exposes no such method.
const ACTIONS = [
  'order.delivered',            // posts the charge
  'order.charge_reversed',
  'payment.recorded',
  'payment.reversed',
  'return.approved',            // credit-only in V2
  'return.rejected',
  'ledger.manual_credit',
  'ledger.manual_debit',
  'ledger.adjustment_reversed',
  'balance.rebuilt',
  // Platform-side bookkeeping: a warehouse paid the commission it owed.
  // Not a ledger event - see commissionCollection.model.js.
  'commission.collected',
  'commission.collection_reversed',
  'exchangeRate.changed',
  'account.opened',
  'migration.backfill',
];

const financialAuditLogSchema = new Schema(
  {
    at: { type: Date, required: true, default: Date.now },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    // 'system' covers scheduled jobs and the migration backfill.
    actorRole: { type: String, default: null },
    // Set when an admin acts for a warehouse.
    onBehalfOfWarehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', default: null },

    action: { type: String, enum: ACTIONS, required: true },
    entityType: { type: String, default: null },
    entityId: { type: Schema.Types.ObjectId, default: null },
    accountId: { type: Schema.Types.ObjectId, ref: 'LedgerAccount', default: null },
    ledgerEntryIds: { type: [Schema.Types.ObjectId], default: [] },

    // Minimal relevant snapshots, e.g. {status:'posted'} -> {status:'reversed'},
    // or balance {syp: 700000} -> {syp: 500000}.
    before: { type: Schema.Types.Mixed, default: null },
    after: { type: Schema.Types.Mixed, default: null },

    // Mandatory for payment.reversed / manual_* / adjustment_reversed /
    // return.rejected / order.charge_reversed - enforced by the callers.
    reason: { type: String, default: null },
    requestId: { type: String, default: null },
    idempotencyKey: { type: String, default: null },
  },
  { timestamps: false }
);

financialAuditLogSchema.index({ accountId: 1, at: -1 });
financialAuditLogSchema.index({ entityType: 1, entityId: 1, at: -1 });
financialAuditLogSchema.index({ actorId: 1, at: -1 });
financialAuditLogSchema.index({ action: 1, at: -1 });

module.exports = model('FinancialAuditLog', financialAuditLogSchema);
module.exports.ACTIONS = ACTIONS;
