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
    // No "refund" - COD makes it meaningless. Approve always means a
    // no-extra-charge replacement order; reject always carries a note.
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    rejectionNote: { type: String, default: null },
    replacementOrderId: { type: Schema.Types.ObjectId, ref: 'Order', default: null },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

returnSchema.index({ warehouseId: 1, status: 1 });
returnSchema.index({ pharmacyId: 1 });

module.exports = model('Return', returnSchema);
