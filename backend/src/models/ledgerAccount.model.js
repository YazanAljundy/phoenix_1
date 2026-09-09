const { Schema, model } = require('mongoose');

// Money-Flow V2. The financial relationship between exactly one pharmacy and
// one warehouse - the container every LedgerEntry is posted into. Replaces
// pharmacyBalance.model.js, which WAS the balance; this one only caches it.
//
// Denominated in SYP: Feniq bills in SYP and collects SYP cash, so the debt
// is a SYP obligation. `balanceCache.usd` is a reporting projection built from
// each entry's own frozen amountUsd - never `balanceCache.syp / currentRate`.
const ledgerAccountSchema = new Schema(
  {
    pharmacyId: { type: Schema.Types.ObjectId, ref: 'Pharmacy', required: true },
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    // Fixed to SYP in V2. The field exists so a future USD-denominated account
    // is a data change rather than a schema change.
    settlementCurrency: { type: String, enum: ['SYP'], default: 'SYP' },

    // Last `sequence` handed out to an entry on this account. Incremented with
    // $inc in the SAME atomic update that moves the balance below, so a
    // sequence is never issued twice and never leaves a gap - see
    // ledger.service.js's postEntry.
    seqCounter: { type: Number, required: true, default: 0 },

    // A CACHE, never the source of truth. Its definition is exactly "what a
    // full replay of this account's entries produces" (ledger.service.js's
    // replayAccount), and the nightly verifier proves it.
    balanceCache: {
      // Whole lira, integer - $inc on an integer is exact, and SYP is the
      // authoritative side of the ledger.
      syp: { type: Number, required: true, default: 0 },
      // Reporting only. A float sum of per-entry 2dp figures, so it is rounded
      // to 2dp wherever it is read/serialized rather than trusted bit-exact.
      usd: { type: Number, required: true, default: 0 },
      // Highest entry sequence folded into the two figures above. A replay
      // whose max sequence differs means the cache is stale.
      lastEntrySeq: { type: Number, required: true, default: 0 },
      rebuiltAt: { type: Date, default: null },
    },

    firstChargeAt: { type: Date, default: null },
    lastActivityAt: { type: Date, default: null },
    // Informational only - never blocks posting.
    status: { type: String, enum: ['active', 'closed'], default: 'active' },
  },
  { timestamps: true }
);

// One account per relationship.
ledgerAccountSchema.index({ pharmacyId: 1, warehouseId: 1 }, { unique: true });
// The warehouse debtor list: find({warehouseId}).sort({balanceCache.syp:-1, _id:1})
// with a (balance, id) cursor - same shape the V1 pharmacybalances index served.
ledgerAccountSchema.index({ warehouseId: 1, 'balanceCache.syp': -1, _id: 1 });
// The pharmacy's own "who do I owe" list.
ledgerAccountSchema.index({ pharmacyId: 1, 'balanceCache.syp': -1 });

module.exports = model('LedgerAccount', ledgerAccountSchema);
