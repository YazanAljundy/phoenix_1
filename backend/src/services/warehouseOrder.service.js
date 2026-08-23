const mongoose = require('mongoose');
const { ApiError } = require('../utils/ApiError');
const Order = require('../models/order.model');
const OrderItem = require('../models/orderItem.model');
const Pharmacy = require('../models/pharmacy.model');
const Review = require('../models/review.model');
const Return = require('../models/return.model');
const { recomputeBalance } = require('./pharmacyBalance.service');
const notificationService = require('./notification.service');

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

const DEFAULT_WAREHOUSE_ORDERS_LIMIT = 20;

// Section 13b: the fulfillment queue - oldest first (orderNumber ascending),
// since that's the order the warehouse should work through them in, not
// newest-first like the pharmacist's own history view.
//
// Cursor pagination: `after` is the last orderNumber seen, meaning "orders
// numbered above this one" (ascending = oldest first).
async function listOrdersForWarehouse(
  warehouseId,
  status,
  { limit = DEFAULT_WAREHOUSE_ORDERS_LIMIT, after = null } = {}
) {
  const filter = { warehouseId };
  if (status) {
    if (!Order.schema.path('status').enumValues.includes(status)) {
      throw ApiError.badRequest('Invalid status filter.', undefined, 'INVALID_STATUS_FILTER');
    }
    filter.status = status;
  }
  if (after !== null) {
    filter.orderNumber = { $gt: after };
  }

  const orders = await Order.find(filter)
    .sort({ orderNumber: 1 })
    .limit(limit + 1);
  const hasMore = orders.length > limit;
  const page = hasMore ? orders.slice(0, limit) : orders;
  const nextCursor = page.length > 0 ? String(page[page.length - 1].orderNumber) : null;

  if (page.length === 0) return { rows: [], hasMore: false, nextCursor: null };

  const orderIds = page.map((o) => o._id);
  const pharmacyIds = [...new Set(page.map((o) => o.pharmacyId.toString()))];

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

  const rows = page.map((order) => ({
    order,
    items: itemsByOrderId.get(order._id.toString()) ?? [],
    pharmacy: pharmacyById.get(order.pharmacyId.toString()) ?? null,
    hasReviewed: reviewedOrderIds.has(order._id.toString()),
  }));
  return { rows, hasMore, nextCursor };
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

  // Push the pharmacist a status update for the two stages they'd actually
  // want to be pinged for (out for delivery / delivered) - not every stage,
  // same as sendToUser/sendToAll below, this must never block or undo the
  // status change above if it fails.
  if (next === 'out_for_delivery' || next === 'delivered') {
    try {
      const pharmacy = await Pharmacy.findById(order.pharmacyId, 'userId');
      if (pharmacy) {
        await notificationService.sendToUser(pharmacy.userId, {
          titleAr: 'تحديث طلبك',
          titleEn: 'Order Update',
          bodyAr:
            next === 'out_for_delivery'
              ? `طلبك رقم ${order.orderNumber} خرج للتوصيل`
              : `تم تسليم طلبك رقم ${order.orderNumber}`,
          bodyEn:
            next === 'out_for_delivery'
              ? `Your order #${order.orderNumber} is out for delivery`
              : `Your order #${order.orderNumber} has been delivered`,
          type: 'order_update',
          relatedOrderId: order._id,
        });
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to send order status notification.', err.message);
    }
  }

  return order;
}

// IDOR guard: scoped to warehouseId, same pattern as advanceOrderStatus
// above - read-only, no status change. Mirrors getOrderForPharmacy's
// Promise.all shape (order.service.js) but for the warehouse's own view:
// pharmacy contact info instead of the warehouse's own name, and just
// whether a return exists rather than its full detail (that's the returns
// feature's own page, per WarehouseReturnsPage).
async function getOrderDetailForWarehouse(orderId, warehouseId) {
  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    throw ApiError.notFound('Order not found.', 'ORDER_NOT_FOUND');
  }
  const order = await Order.findOne({ _id: orderId, warehouseId });
  if (!order) {
    throw ApiError.notFound('Order not found.', 'ORDER_NOT_FOUND');
  }

  const [items, pharmacy, returnRequest] = await Promise.all([
    OrderItem.find({ orderId: order._id }),
    Pharmacy.findById(order.pharmacyId),
    Return.findOne({ orderId: order._id }),
  ]);

  return { order, items, pharmacy, hasReturn: Boolean(returnRequest) };
}

module.exports = { listOrdersForWarehouse, advanceOrderStatus, getOrderDetailForWarehouse };
