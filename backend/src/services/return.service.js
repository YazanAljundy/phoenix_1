const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { ApiError } = require('../utils/ApiError');
const Order = require('../models/order.model');
const OrderItem = require('../models/orderItem.model');
const Return = require('../models/return.model');

const REASON_TYPES = ['damaged', 'wrong_item', 'other'];

// Section 7: a return can only be requested once the pharmacist actually has
// the goods in hand to send back - 'delivered' is the only status where
// that's true (this rule isn't in the schema itself, it's inferred from what
// a return physically means).
function assertDelivered(order) {
  if (order.status !== 'delivered') {
    throw ApiError.badRequest(
      'This order has not been delivered yet.',
      undefined,
      'ORDER_NOT_DELIVERED'
    );
  }
}

// Section 6.9/8: validates and normalizes the `items` array shared by
// create/update - every problem item in the order at once, each against the
// order's own OrderItem rows (not against any other return, since there's
// never more than one per order to accumulate against).
function validateItems(items, orderItemById) {
  if (!Array.isArray(items) || items.length === 0) {
    throw ApiError.badRequest('Please select at least one item to return.', undefined, 'RETURN_ITEMS_EMPTY');
  }

  const seenOrderItemIds = new Set();
  return items.map((raw) => {
    const orderItemId = raw?.orderItemId;
    if (typeof orderItemId !== 'string' || !orderItemById.has(orderItemId)) {
      throw ApiError.notFound('This item could not be found in the order.', 'ORDER_ITEM_NOT_FOUND');
    }
    if (seenOrderItemIds.has(orderItemId)) {
      throw ApiError.badRequest(
        'Each item can only appear once in a return request.',
        undefined,
        'DUPLICATE_RETURN_ITEM'
      );
    }
    seenOrderItemIds.add(orderItemId);

    const orderItem = orderItemById.get(orderItemId);

    const reasonType = raw.reasonType;
    if (!REASON_TYPES.includes(reasonType)) {
      throw ApiError.badRequest('Invalid return reason.', undefined, 'INVALID_REASON_TYPE');
    }
    const trimmedCustomReason = typeof raw.customReason === 'string' ? raw.customReason.trim() : '';
    if (reasonType === 'other' && !trimmedCustomReason) {
      throw ApiError.badRequest(
        'Please describe the reason for this return.',
        undefined,
        'CUSTOM_REASON_REQUIRED'
      );
    }

    const quantity = Number(raw.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw ApiError.badRequest('Invalid return quantity.', undefined, 'INVALID_QUANTITY');
    }
    if (quantity > orderItem.quantity) {
      throw ApiError.badRequest(
        'The return quantity exceeds what was ordered for this item.',
        { availableQuantity: orderItem.quantity },
        'RETURN_QUANTITY_EXCEEDS_ORDERED'
      );
    }

    return {
      orderItemId: orderItem._id,
      productId: orderItem.productId,
      quantity,
      reasonType,
      customReason: reasonType === 'other' ? trimmedCustomReason : null,
    };
  });
}

async function loadOrderItemsMap(orderId) {
  const orderItems = await OrderItem.find({ orderId });
  return new Map(orderItems.map((item) => [item._id.toString(), item]));
}

function deleteImageFiles(urls) {
  for (const url of urls) {
    const filename = url.split('/').pop();
    if (!filename) continue;
    fs.unlink(path.join(__dirname, '../../uploads/return-photos', filename), () => {});
  }
}

// Section 6.9/8: one return per order, ever - `orderId` is unique at the
// schema level, but a duplicate attempt gets a clear message here rather than
// surfacing Mongo's raw E11000 error.
async function createReturn({ pharmacyId, orderId, items, notes, images }) {
  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    throw ApiError.notFound('Order not found.', 'ORDER_NOT_FOUND');
  }
  const order = await Order.findOne({ _id: orderId, pharmacyId });
  if (!order) {
    throw ApiError.notFound('Order not found.', 'ORDER_NOT_FOUND');
  }
  assertDelivered(order);

  const existing = await Return.findOne({ orderId: order._id });
  if (existing) {
    throw ApiError.conflict(
      'A return request has already been submitted for this order.',
      'RETURN_ALREADY_EXISTS'
    );
  }

  const orderItemById = await loadOrderItemsMap(order._id);
  const normalizedItems = validateItems(items, orderItemById);

  const trimmedNotes = typeof notes === 'string' && notes.trim() ? notes.trim() : null;

  const returnRequest = await Return.create({
    orderId: order._id,
    pharmacyId,
    warehouseId: order.warehouseId,
    items: normalizedItems,
    notes: trimmedNotes,
    images: Array.isArray(images) ? images : [],
  });

  return { returnRequest, orderItemById };
}

async function loadOwnPendingReturnOrThrow(returnId, pharmacyId) {
  if (!mongoose.Types.ObjectId.isValid(returnId)) {
    throw ApiError.notFound('Return request not found.', 'RETURN_NOT_FOUND');
  }
  const returnRequest = await Return.findOne({ _id: returnId, pharmacyId });
  if (!returnRequest) {
    throw ApiError.notFound('Return request not found.', 'RETURN_NOT_FOUND');
  }
  if (returnRequest.status !== 'pending') {
    throw ApiError.badRequest(
      'This return request has already been decided and can no longer be changed.',
      undefined,
      'RETURN_NOT_EDITABLE'
    );
  }
  return returnRequest;
}

// Section 6.9: editable only while still pending - once the warehouse
// decides, the record is final (same principle as offers/pending accounts).
// `keepImageUrls` lets the pharmacist drop specific photos from the existing
// set; `newImages` (already-uploaded URLs) are appended on top.
async function updateReturn({ pharmacyId, returnId, items, notes, keepImageUrls, newImages }) {
  const returnRequest = await loadOwnPendingReturnOrThrow(returnId, pharmacyId);

  const orderItemById = await loadOrderItemsMap(returnRequest.orderId);
  const normalizedItems = validateItems(items, orderItemById);

  const trimmedNotes = typeof notes === 'string' && notes.trim() ? notes.trim() : null;

  const keepSet = new Set(Array.isArray(keepImageUrls) ? keepImageUrls : returnRequest.images);
  const droppedImages = returnRequest.images.filter((url) => !keepSet.has(url));
  deleteImageFiles(droppedImages);

  returnRequest.items = normalizedItems;
  returnRequest.notes = trimmedNotes;
  returnRequest.images = [
    ...returnRequest.images.filter((url) => keepSet.has(url)),
    ...(Array.isArray(newImages) ? newImages : []),
  ];
  await returnRequest.save();

  return { returnRequest, orderItemById };
}

async function deleteReturn({ pharmacyId, returnId }) {
  const returnRequest = await loadOwnPendingReturnOrThrow(returnId, pharmacyId);
  deleteImageFiles(returnRequest.images);
  await returnRequest.deleteOne();
}

// Section 6.9: "my returns" list - scoped to the caller's own pharmacy (same
// IDOR pattern used across orders), newest first. Batches the OrderItem/Order
// lookups instead of a query per row.
async function listReturnsForPharmacy(pharmacyId) {
  const returns = await Return.find({ pharmacyId }).sort({ createdAt: -1 });
  return attachOrderContext(returns);
}

async function attachOrderContext(returns) {
  if (returns.length === 0) return [];

  const orderIds = [...new Set(returns.map((r) => r.orderId.toString()))];
  const allOrderItemIds = [
    ...new Set(returns.flatMap((r) => r.items.map((i) => i.orderItemId.toString()))),
  ];

  const [orders, orderItems] = await Promise.all([
    Order.find({ _id: { $in: orderIds } }, 'orderNumber'),
    OrderItem.find({ _id: { $in: allOrderItemIds } }),
  ]);
  const orderById = new Map(orders.map((o) => [o._id.toString(), o]));
  const orderItemById = new Map(orderItems.map((i) => [i._id.toString(), i]));

  return returns.map((returnRequest) => ({
    returnRequest,
    order: orderById.get(returnRequest.orderId.toString()) ?? null,
    orderItemById,
  }));
}

module.exports = {
  createReturn,
  updateReturn,
  deleteReturn,
  listReturnsForPharmacy,
  loadOrderItemsMap,
  attachOrderContext,
};
