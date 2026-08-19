const { Schema, model } = require('mongoose');

// Section 16: a per-(pharmacy, warehouse) cache of the running debt, rebuilt
// from scratch on every relevant change (a delivered order, or any payment
// create/update/delete) rather than incrementally adjusted - see
// pharmacyBalance.service.js's recomputeBalance. Never written to directly
// from a controller.
const pharmacyBalanceSchema = new Schema({
  pharmacyId: { type: Schema.Types.ObjectId, ref: 'Pharmacy', required: true },
  warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
  // All three USD - orders are priced in SYP and payments can be either
  // currency, both converted through the live exchange rate at recompute
  // time (see pharmacyBalance.service.js).
  totalOrdersUsd: { type: Number, required: true, default: 0 },
  totalPaidUsd: { type: Number, required: true, default: 0 },
  // = totalOrdersUsd - totalPaidUsd. Can be negative - the pharmacy has paid
  // ahead of what it owes, shown as a credit rather than a debt.
  balanceUsd: { type: Number, required: true, default: 0 },
  lastUpdated: { type: Date, default: Date.now },
});

pharmacyBalanceSchema.index({ pharmacyId: 1, warehouseId: 1 }, { unique: true });

module.exports = model('PharmacyBalance', pharmacyBalanceSchema);
