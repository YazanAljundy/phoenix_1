const mongoose = require('mongoose');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const Pharmacy = require('../models/pharmacy.model');
const orderService = require('../services/order.service');
const orderViewModel = require('../viewmodels/order.viewmodel');
const { verifyImageMagicBytes } = require('../middlewares/upload.middleware');
const { uploadImage, deleteImageByUrl } = require('../services/upload.service');
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

// `items` are the LOOSE lines only. A cart holding nothing but packages sends
// none, so an empty array is valid here and createOrder makes the final call
// on whether the whole cart is empty (it can see the packages too).
function validateItems(items) {
  if (items === undefined || items === null) return [];
  if (!Array.isArray(items)) {
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

    // The unit price the cart was SHOWING when the pharmacist submitted -
    // never what the order is billed at (createOrder prices every line from
    // the catalog itself), only what it compares against so a price that
    // moved between add-to-cart and checkout is reported rather than
    // silently charged. Optional: an older app build sends no price at all,
    // and a line without one simply skips that comparison.
    let displayedUnitPriceUsd = null;
    if (item.displayedUnitPriceUsd !== undefined && item.displayedUnitPriceUsd !== null) {
      const price = Number(item.displayedUnitPriceUsd);
      if (!Number.isFinite(price) || price < 0) {
        throw ApiError.badRequest('Invalid price in cart.', undefined, 'INVALID_PRICE');
      }
      displayedUnitPriceUsd = price;
    }

    return { productId: item.productId, quantity, displayedUnitPriceUsd };
  });
}

// The packages the cart holds, each as { advertisementId, copies }. Shape
// only - createOrder is what decides whether each package is live, belongs to
// this warehouse and can still be ordered.
function validatePackages(packages) {
  if (packages === undefined || packages === null) return [];
  if (!Array.isArray(packages)) {
    throw ApiError.badRequest('Invalid advertisement.', undefined, 'INVALID_ADVERTISEMENT');
  }

  return packages.map((entry) => {
    if (
      !entry ||
      typeof entry.advertisementId !== 'string' ||
      !mongoose.Types.ObjectId.isValid(entry.advertisementId)
    ) {
      throw ApiError.badRequest('Invalid advertisement.', undefined, 'INVALID_ADVERTISEMENT');
    }
    const copies = entry.copies === undefined || entry.copies === null ? 1 : Number(entry.copies);
    if (!Number.isInteger(copies) || copies < 1) {
      throw ApiError.badRequest('Invalid package quantity.', undefined, 'INVALID_PACKAGE_COPIES');
    }
    return { advertisementId: entry.advertisementId, copies };
  });
}

// Money-Flow V2. `idempotencyKey` is a client-generated UUID: a retried
// submission with the same key returns the order the first attempt created
// instead of placing a second one. Optional for now so an older app build
// keeps working, but the Flutter cart always sends it.
function parseIdempotencyKey(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 100) {
    throw ApiError.badRequest('Invalid idempotency key.', undefined, 'INVALID_IDEMPOTENCY_KEY');
  }
  return value;
}

const create = asyncHandler(async (req, res) => {
  const { warehouseId, notes, advertisementId } = req.body;
  const idempotencyKey = parseIdempotencyKey(req.body.idempotencyKey);

  if (typeof warehouseId !== 'string' || !mongoose.Types.ObjectId.isValid(warehouseId)) {
    throw ApiError.badRequest('Invalid warehouse.', undefined, 'INVALID_WAREHOUSE');
  }
  const items = validateItems(req.body.items);

  // A package is identified by id and a copy count, and nothing else. Any
  // price, total or discount in the body is ignored outright - createOrder
  // re-reads the package from MongoDB and computes every figure itself, so a
  // client cannot name its own discount.
  //
  // `advertisementId` is the pre-packages shape (one package, one copy) and is
  // still accepted so an older app build keeps working; createOrder folds it
  // into the same list.
  if (advertisementId !== undefined && advertisementId !== null) {
    if (typeof advertisementId !== 'string' || !mongoose.Types.ObjectId.isValid(advertisementId)) {
      throw ApiError.badRequest('Invalid advertisement.', undefined, 'INVALID_ADVERTISEMENT');
    }
  }
  const packages = validatePackages(req.body.packages);

  // pharmacyId comes from the authenticated user's own profile, never from
  // the request body - a pharmacist can only ever order as themselves.
  const pharmacy = await loadPharmacyOrThrow(req.user._id);

  const order = await orderService.createOrder({
    userId: req.user._id,
    pharmacyId: pharmacy._id,
    warehouseId,
    items,
    advertisementId: advertisementId || null,
    packages,
    notes: typeof notes === 'string' && notes.trim() ? notes.trim() : null,
    idempotencyKey,
    // Passed through as sent: exchangeRate.service.js's
    // assertRateUsedIsCurrent is the one place that decides what a valid rate
    // is (INVALID_RATE_USED) and whether it is still current (RATE_CHANGED),
    // for this endpoint and the panel's alike. An app build that sends none
    // is not checked - see createOrder.
    rateUsed: req.body.rateUsed,
  });

  // A replayed idempotent request gets 200 + the header rather than a second
  // 201, so the client can tell "already placed" from "just placed". The
  // service sets this on the document it returns when it recognised the key.
  const isReplay = Boolean(order.$locals && order.$locals.idempotentReplay);
  if (isReplay) res.set('Idempotent-Replay', 'true');

  res.status(isReplay ? 200 : 201).json({
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

// Section: GET /orders/savings-summary - the pharmacy's running "money saved
// through discounts" total, for the Account History screen. Read-only
// aggregation of OrderItem.savingsUsd (locked in at order time); computes no
// new discount. Scoped to the caller's own pharmacy, resolved from the JWT.
const savingsSummary = asyncHandler(async (req, res) => {
  const pharmacy = await loadPharmacyOrThrow(req.user._id);
  const summary = await orderService.getSavingsSummaryForPharmacy(pharmacy._id);
  res.json({ success: true, ...orderViewModel.toSavingsSummaryResponse(summary) });
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

// Section: optional delivery seal photo. multipart/form-data with a single
// `image` field (deliverySealPhotoUpload middleware). The photo is uploaded to
// Cloudinary first, then recorded on the order in the same request - if
// recording it fails (wrong status, IDOR, …) the just-uploaded image is
// removed so a failed attempt leaves no orphan, exactly like
// return.controller.js's create. The order status is NOT changed here.
const confirmDelivery = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw ApiError.badRequest(
      'A seal photo is required to confirm delivery.',
      undefined,
      'DELIVERY_SEAL_PHOTO_REQUIRED'
    );
  }
  if (!verifyImageMagicBytes(req.file.buffer)) {
    throw ApiError.badRequest(
      'The seal photo file content is not a valid image.',
      undefined,
      'INVALID_DELIVERY_SEAL_PHOTO'
    );
  }

  const imageUrl = await uploadImage(req.file.buffer, 'delivery-seals');

  let result;
  try {
    const pharmacy = await loadPharmacyOrThrow(req.user._id);
    result = await orderService.attachDeliverySealPhoto(req.params.id, pharmacy._id, imageUrl);
  } catch (err) {
    await deleteImageByUrl(imageUrl);
    throw err;
  }

  const { order, warehouse, items, returnRequest, myReview, complaints } = result;
  res.json({
    success: true,
    message: 'Delivery confirmed.',
    ...orderViewModel.toOrderDetailResponse(order, warehouse, items, returnRequest, myReview, complaints),
  });
});

// Section: GET /orders/returnable - orders still inside the 24-hour
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
  listReturnable, savingsSummary, create, list, getOne, cancel, confirmDelivery, reorder };
