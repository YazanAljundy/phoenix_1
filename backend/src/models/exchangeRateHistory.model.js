const { Schema, model } = require('mongoose');

// Money-Flow V2. Append-only record of every rate the singleton
// (exchangeRate.model.js) has ever held. The singleton stays the "current"
// pointer used to price NEW events; this is the provenance trail behind the
// fx.rateAsOf stamped onto orders, payments and ledger entries.
//
// Written by exchangeRate.service.js whenever the stored rate actually changes
// (same value re-fetched from the API appends nothing).
const exchangeRateHistorySchema = new Schema({
  usdToSyp: { type: Number, required: true, min: 0 },
  source: { type: String, enum: ['api', 'manual'], required: true },
  effectiveFrom: { type: Date, required: true, default: Date.now },
  // The admin who set a manual rate; null for API refreshes.
  changedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  // What it replaced, so a reader sees the movement without a second query.
  previousUsdToSyp: { type: Number, default: null },
});

exchangeRateHistorySchema.index({ effectiveFrom: -1 });

module.exports = model('ExchangeRateHistory', exchangeRateHistorySchema);
