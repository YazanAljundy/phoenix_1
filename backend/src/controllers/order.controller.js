const mongoose = require('mongoose');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const Pharmacy = require('../models/pharmacy.model');
const orderService = require('../services/order.service');
const orderViewModel = require('../viewmodels/order.viewmodel');

async function loadPharmacyOrThrow(userId) {
  const pharmacy = await Pharmacy.findOne({ userId });
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
  const items = await orderService.listOrdersForPharmacy(pharmacy._id);
  res.json({ success: true, ...orderViewModel.toOrderListResponse(items) });
});

const getOne = asyncHandler(async (req, res) => {
  const pharmacy = await loadPharmacyOrThrow(req.user._id);
  const { order, warehouse, items, returnRequest, myReview } = await orderService.getOrderForPharmacy(
    req.params.id,
    pharmacy._id
  );
  res.json({
    success: true,
    ...orderViewModel.toOrderDetailResponse(order, warehouse, items, returnRequest, myReview),
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

module.exports = { create, list, getOne, cancel };
