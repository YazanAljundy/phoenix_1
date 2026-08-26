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
    totalPrice: { type: Number, required: true },
    discountAmount: { type: Number, required: true },
    commissionAmount: { type: Number, required: true },
    finalPrice: { type: Number, required: true },
    notes: { type: String, default: null },
    // Always the pharmacist's user - the warehouse has no cancellation authority from the app.
    cancelledBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    cancelReason: { type: String, default: null },
    statusHistory: { type: [statusHistoryEntrySchema], default: [] },
  },
  { timestamps: true }
);

orderSchema.index({ pharmacyId: 1 });
orderSchema.index({ warehouseId: 1 });
orderSchema.index({ status: 1 });

module.exports = model('Order', orderSchema);
