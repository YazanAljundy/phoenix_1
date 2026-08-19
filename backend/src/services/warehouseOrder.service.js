const mongoose = require('mongoose');
const { ApiError } = require('../utils/ApiError');
const Order = require('../models/order.model');
const OrderItem = require('../models/orderItem.model');
const Pharmacy = require('../models/pharmacy.model');
const Review = require('../models/review.model');
const { recomputeBalance } = require('./pharmacyBalance.service');

// Section 7/13b: the warehouse only ever moves an order forward through this
// fixed sequence, one stage at a time - no skipping, no picking an arbitrary
// status. 'cancelled' isn't part of it: only the pharmacist can cancel
// (order.service.js), and only before 'out_for_delivery'.
const PROGRESSION = ['pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered'];

function nextStatus(current) {
  const index = PROGRESSION.indexOf(current);
  if (index === -1 || index === PROGRESSION.length - 1) return null;
  return PROGRESSION[index + 1];
}

// Section 13b: the fulfillment queue - oldest first (orderNumber ascending),
// since that's the order the warehouse should work through them in, not
// newest-first like the pharmacist's own history view.
async function listOrdersForWarehouse(warehouseId, status) {
  const filter = { warehouseId };
  if (status) {
    if (!Order.schema.path('status').enumValues.includes(status)) {
      throw ApiError.badRequest('Invalid status filter.', undefined, 'INVALID_STATUS_FILTER');
    }
    filter.status = status;
  }

  const orders = await Order.find(filter).sort({ orderNumber: 1 });
  if (orders.length === 0) return [];

  const orderIds = orders.map((o) => o._id);
  const pharmacyIds = [...new Set(orders.map((o) => o.pharmacyId.toString()))];

  const [items, pharmacies, reviews] = await Promise.all([
    OrderItem.find({ orderId: { $in: orderIds } }),
    Pharmacy.find({ _id: { $in: pharmacyIds } }),
    // Section 13c: whether *this warehouse* already rated the pharmacy for
    // this order - the unique {orderId, reviewerType} index means there can
    // only ever be one, so the UI knows to offer "Rate pharmacy" or not.
    Review.find({ orderId: { $in: orderIds }, reviewerType: 'warehouse' }, 'orderId'),
  ]);

  const itemsByOrderId = new Map();
  for (const item of items) {
    const key = item.orderId.toString();
    if (!itemsByOrderId.has(key)) itemsByOrderId.set(key, []);
    itemsByOrderId.get(key).push(item);
  }
  const pharmacyById = new Map(pharmacies.map((p) => [p._id.toString(), p]));
  const reviewedOrderIds = new Set(reviews.map((r) => r.orderId.toString()));

  return orders.map((order) => ({
    order,
    items: itemsByOrderId.get(order._id.toString()) ?? [],
    pharmacy: pharmacyById.get(order.pharmacyId.toString()) ?? null,
    hasReviewed: reviewedOrderIds.has(order._id.toString()),
  }));
}

// IDOR guard: scoped to warehouseId, same pattern as getOrderForPharmacy in
// order.service.js - a warehouse can never advance (or even see) an order
// that isn't its own.
async function advanceOrderStatus(orderId, warehouseId, userId) {
  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    throw ApiError.notFound('Order not found.', 'ORDER_NOT_FOUND');
  }
  const order = await Order.findOne({ _id: orderId, warehouseId });
  if (!order) {
    throw ApiError.notFound('Order not found.', 'ORDER_NOT_FOUND');
  }

  const next = nextStatus(order.status);
  if (!next) {
    throw ApiError.badRequest(
      'This order cannot be advanced from its current status.',
      undefined,
      'ORDER_NOT_ADVANCEABLE'
    );
  }

  const now = new Date();
  order.status = next;
  order.statusHistory.push({ status: next, changedBy: userId, changedAt: now });
  await order.save();

  // Section 16: a delivered order is what actually creates the debt - the
  // balance cache is rebuilt right away so it never has to wait on a
  // payment or another trigger to catch up. Never lets a cache hiccup block
  // the order transition itself, which already succeeded above.
  if (next === 'delivered') {
    try {
      await recomputeBalance(order.pharmacyId, order.warehouseId);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to update pharmacy balance after delivery.', err.message);
    }
  }

  return order;
}

module.exports = { listOrdersForWarehouse, advanceOrderStatus };
