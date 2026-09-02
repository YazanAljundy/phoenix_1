const mongoose = require('mongoose');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const Pharmacy = require('../models/pharmacy.model');
const orderService = require('../services/order.service');
const orderViewModel = require('../viewmodels/order.viewmodel');
const { parseCursorQuery, parseNumericCursor, paginationMeta } = require('../utils/pagination');

const ORDERS_DEFAULT_LIMIT = 15;

async function loadPharmacyOrThrow(userId) {
  // Runs on every order/return/review/debt request and only ever yields
  // `pharmacy._id` to its callers, so neither the rest of the document nor
  // Mongoose hydration is needed.
  const pharmacy = await Pharmacy.findOne({ userId }).select('_id').lean();
  if (!pharmacy) {
    throw ApiError.notFound('Pharmacy profile not found.', 'PHARMACY_NOT_FOUND');
  }
  return pharmacy;
}

function validateItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw ApiError.badRequest('Your cart is empty.', undefined, 'CART_EMPTY');
  }

  return items.map((item) => {
    if (!item || typeof item.productId !== 'string' || !mongoose.Types.ObjectId.isValid(item.productId)) {
      throw ApiError.badRequest('Invalid product in cart.', undefined, 'INVALID_PRODUCT');
    }
    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw ApiError.badRequest('Invalid quantity in cart.', undefined, 'INVALID_QUANTITY');
    }
    return { productId: item.productId, quantity };
  });
}

const create = asyncHandler(async (req, res) => {
  const { warehouseId, notes } = req.body;

  if (typeof warehouseId !== 'string' || !mongoose.Types.ObjectId.isValid(warehouseId)) {
    throw ApiError.badRequest('Invalid warehouse.', undefined, 'INVALID_WAREHOUSE');
  }
  const items = validateItems(req.body.items);

  // pharmacyId comes from the authenticated user's own profile, never from
  // the request body - a pharmacist can only ever order as themselves.
  const pharmacy = await loadPharmacyOrThrow(req.user._id);

  const order = await orderService.createOrder({
    userId: req.user._id,
    pharmacyId: pharmacy._id,
    warehouseId,
    items,
    notes: typeof notes === 'string' && notes.trim() ? notes.trim() : null,
  });

  res.status(201).json({
    success: true,
    message: 'Order submitted.',
    ...orderViewModel.toOrderResponse(order),
  });
});

const list = asyncHandler(async (req, res) => {
  const pharmacy = await loadPharmacyOrThrow(req.user._id);
  const { limit, after } = parseCursorQuery(req.query, ORDERS_DEFAULT_LIMIT);
  const cursor = parseNumericCursor(after);

  const { rows, hasMore, nextCursor } = await orderService.listOrdersForPharmacy(pharmacy._id, {
    limit,
    after: cursor,
  });
  res.json({
    success: true,
    ...orderViewModel.toOrderListResponse(rows),
    pagination: paginationMeta(hasMore, nextCursor),
  });
});

const getOne = asyncHandler(async (req, res) => {
  const pharmacy = await loadPharmacyOrThrow(req.user._id);
  const { order, warehouse, items, returnRequest, myReview, complaints } =
    await orderService.getOrderForPharmacy(req.params.id, pharmacy._id);
  res.json({
    success: true,
    ...orderViewModel.toOrderDetailResponse(
      order,
      warehouse,
      items,
      returnRequest,
      myReview,
      complaints
    ),
  });
});

const cancel = asyncHandler(async (req, res) => {
  const pharmacy = await loadPharmacyOrThrow(req.user._id);
  const { order, warehouse, items } = await orderService.cancelOrder(req.params.id, pharmacy._id, req.user._id);
  res.json({
    success: true,
    message: 'Order cancelled.',
    ...orderViewModel.toOrderDetailResponse(order, warehouse, items),
  });
});

// Section: GET /orders/returnable - orders still inside the 48-hour
// return window. Scoped to the caller's own pharmacy, resolved from the
// JWT rather than any client-supplied id.
const listReturnable = asyncHandler(async (req, res) => {
  const pharmacy = await loadPharmacyOrThrow(req.user._id);
  const rows = await orderService.listReturnableOrders(pharmacy._id);
  res.json({ success: true, ...orderViewModel.toReturnableOrdersResponse(rows) });
});

// Section: POST /orders/:id/reorder - builds a cart-ready payload from a past
// delivered order. Creates NOTHING: no order, no document. pharmacyId comes
// from the authenticated user's own profile (never the body), and
// prepareReorder scopes the lookup to it - a pharmacy can only reorder its
// own orders.
const reorder = asyncHandler(async (req, res) => {
  const pharmacy = await loadPharmacyOrThrow(req.user._id);
  const preparation = await orderService.prepareReorder(req.params.id, pharmacy._id);
  res.json({ success: true, ...orderViewModel.toReorderResponse(preparation) });
});

module.exports = {
  listReturnable, create, list, getOne, cancel, reorder };
