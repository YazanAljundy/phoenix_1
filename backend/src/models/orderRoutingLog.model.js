const { Schema, model } = require('mongoose');

// Structure ready only - not activated. Reserved for a future unified delivery /
// auto-routing feature (see Section 9, out of scope for this version).
const orderRoutingLogSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    routedAt: { type: Date, default: Date.now },
    reason: { type: String, default: null },
  },
  { timestamps: true }
);

module.exports = model('OrderRoutingLog', orderRoutingLogSchema);
