const { Schema, model } = require('mongoose');

const orderItemSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    // Snapshotted at order time, so an old invoice stays correct even if the
    // product is later renamed, re-priced, or deleted.
    productNameAr: { type: String, required: true },
    productNameEn: { type: String, required: true },
    manufacturerAr: { type: String, required: true },
    manufacturerEn: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true },
    discountPrice: { type: Number, required: true },
  },
  { timestamps: true }
);

orderItemSchema.index({ orderId: 1 });
orderItemSchema.index({ productId: 1 });

module.exports = model('OrderItem', orderItemSchema);
