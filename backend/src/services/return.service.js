const mongoose = require('mongoose');
const { ApiError } = require('../utils/ApiError');
const Order = require('../models/order.model');
const OrderItem = require('../models/orderItem.model');
const Return = require('../models/return.model');
const { deleteImageByUrl } = require('./upload.service');

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

// Section: a return has to be raised within 48 hours of delivery. The
// window is anchored to the LAST 'delivered' entry in statusHistory rather
// than the order's updatedAt, which moves for unrelated reasons (a review,
// a balance recompute) and would silently extend or shorten the window.
const RETURN_WINDOW_HOURS = 48;
const RETURN_WINDOW_MS = RETURN_WINDOW_HOURS * 60 * 60 * 1000;

function findDeliveredAt(order) {
  let deliveredAt = null;
  for (const entry of order.statusHistory ?? []) {
    if (entry.status === 'delivered' && entry.changedAt) {
      if (deliveredAt === null || entry.changedAt > deliveredAt) deliveredAt = entry.changedAt;
    }
  }
  return deliveredAt;
}

// Hours left before the window shuts, rounded up so "1 hour left" never
// shows as 0 while the return is in fact still allowed. Always computed
// server-side - the client only ever displays this number.
function hoursRemainingFor(deliveredAt, now = new Date()) {
  const msLeft = deliveredAt.getTime() + RETURN_WINDOW_MS - now.getTime();
  return msLeft <= 0 ? 0 : Math.ceil(msLeft / (60 * 60 * 1000));
}

// Re-checked at creation time, not just when the eligible list was built -
// the window can lapse between the pharmacist seeing the card and tapping
// the button.
function assertWithinReturnWindow(order, now = new Date()) {
  const deliveredAt = findDeliveredAt(order);
  // A delivered order with no 'delivered' history entry predates status
  // tracking; refusing it outright would strand those orders, so the window
  // simply doesn't apply to them.
  if (!deliveredAt) return;
  if (now.getTime() - deliveredAt.getTime() > RETURN_WINDOW_MS) {
    throw ApiError.badRequest(
      `A return must be requested within ${RETURN_WINDOW_HOURS} hours of delivery.`,
      { windowHours: RETURN_WINDOW_HOURS, deliveredAt },
      'RETURN_WINDOW_EXPIRED'
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

// Section 6.9: a return must be backed by at least one photo so the
// warehouse has something to verify the claim against.
function assertHasPhoto(images) {
  if (!Array.isArray(images) || images.length === 0) {
    throw ApiError.badRequest(
      'Please attach at least one photo of the item.',
      undefined,
      'RETURN_PHOTO_REQUIRED'
    );
  }
}

async function loadOrderItemsMap(orderId) {
  const orderItems = await OrderItem.find({ orderId });
  return new Map(orderItems.map((item) => [item._id.toString(), item]));
}

// Fire-and-forget Cloudinary cleanup for photos that are no longer part of
// any return (dropped on edit, or the whole request deleted). deleteImageByUrl
// swallows its own errors - an orphaned asset never blocks the operation.
function deleteImages(urls) {
  for (const url of urls) {
    deleteImageByUrl(url);
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
  assertWithinReturnWindow(order);

  const existing = await Return.findOne({ orderId: order._id });
  if (existing) {
    throw ApiError.conflict(
      'A return request has already been submitted for this order.',
      'RETURN_ALREADY_EXISTS'
    );
  }

  const orderItemById = await loadOrderItemsMap(order._id);
  const normalizedItems = validateItems(items, orderItemById);
  assertHasPhoto(images);

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
  const updatedImages = [
    ...returnRequest.images.filter((url) => keepSet.has(url)),
    ...(Array.isArray(newImages) ? newImages : []),
  ];
  assertHasPhoto(updatedImages);

  const droppedImages = returnRequest.images.filter((url) => !keepSet.has(url));
  deleteImages(droppedImages);

  returnRequest.items = normalizedItems;
  returnRequest.notes = trimmedNotes;
  returnRequest.images = updatedImages;
  await returnRequest.save();

  return { returnRequest, orderItemById };
}

async function deleteReturn({ pharmacyId, returnId }) {
  const returnRequest = await loadOwnPendingReturnOrThrow(returnId, pharmacyId);
  deleteImages(returnRequest.images);
  await returnRequest.deleteOne();
}

const DEFAULT_RETURNS_LIMIT = 15;

// Section 6.9: "my returns" list - scoped to the caller's own pharmacy (same
// IDOR pattern used across orders), newest first. Batches the OrderItem/Order
// lookups instead of a query per row.
//
// Cursor pagination: sorted by `_id` descending (not createdAt - `_id` is
// already a unique, monotonically-ordered-by-creation key, so it doubles as
// the cursor without a second index). `after` means "older than this _id".
async function listReturnsForPharmacy(pharmacyId, { limit = DEFAULT_RETURNS_LIMIT, after = null } = {}) {
  const filter = { pharmacyId };
  if (after) {
    filter._id = { $lt: after };
  }

  const returns = await Return.find(filter)
    .sort({ _id: -1 })
    .limit(limit + 1);
  const hasMore = returns.length > limit;
  const page = hasMore ? returns.slice(0, limit) : returns;
  const nextCursor = page.length > 0 ? page[page.length - 1]._id.toString() : null;

  const rows = await attachOrderContext(page);
  return { rows, hasMore, nextCursor };
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
  RETURN_WINDOW_MS,
  findDeliveredAt,
  hoursRemainingFor,
  updateReturn,
  deleteReturn,
  listReturnsForPharmacy,
  loadOrderItemsMap,
  attachOrderContext,
};
