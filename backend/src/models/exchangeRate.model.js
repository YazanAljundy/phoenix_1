const { Schema, model } = require('mongoose');

// Single document, fixed _id (same pattern as counter.model.js) - never more
// than one row, always upserted in place rather than accumulated. usdToSyp
// is in "new" (post-redenomination) lira terms - LiraScope quotes the new
// lira directly (see exchangeRate.service.js), so nothing downstream needs to
// know about the redenomination.
const exchangeRateSchema = new Schema({
  _id: { type: String, default: 'singleton' },
  usdToSyp: { type: Number, required: true, min: 0 },
  source: { type: String, enum: ['api', 'manual'], required: true },
  lastUpdated: { type: Date, default: Date.now },
  manualOverride: { type: Boolean, default: false },
});

module.exports = model('ExchangeRate', exchangeRateSchema);
