const { Schema, model } = require('mongoose');

// Internal helper collection: one document per counter type (e.g. _id: "order_number").
// order.service.js uses findOneAndUpdate with $inc to atomically issue the next
// sequential number, safely even under concurrent order creation.
const counterSchema = new Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

module.exports = model('Counter', counterSchema);
