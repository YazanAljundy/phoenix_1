const mongoose = require('mongoose');
const { ApiError } = require('../utils/ApiError');
const Product = require('../models/product.model');
const Offer = require('../models/offer.model');
const Order = require('../models/order.model');
const OrderItem = require('../models/orderItem.model');
const Warehouse = require('../models/warehouse.model');
const Counter = require('../models/counter.model');
const Return = require('../models/return.model');
const Review = require('../models/review.model');
const { isWarehouseAvailable } = require('./warehouse.service');
const {
  RETURN_WINDOW_MS,
  findDeliveredAt,
  hoursRemainingFor,
} = require('./return.service');
const { getRate } = require('./exchangeRate.service');
const { applyResolvedIdentity } = require('./productCatalog.service');
const { getDiscountMapForWarehouse, computeDiscountedPriceUsd } = require('./manufacturerDiscount.service');
const { emitToWarehouse, EVENTS } = require('../realtime');

// Section 15: applies an Offer percentage then a manufacturer-discount
// percentage, in SYP, rounding to the nearest lira after each stage (same
// per-stage-rounding convention the rest of this file already uses) -
// either argument being falsy just skips that stage.
function stackedDiscountSyp(baseSyp, offerPercentage, manufacturerDiscountPercentage) {
  let price = baseSyp;
  if (offerPercentage) {
    price = Math.round(price * (1 - offerPercentage / 100));
  }
  if (manufacturerDiscountPercentage) {
    price = Math.round(price * (1 - manufacturerDiscountPercentage / 100));
  }
  return price;
}

// Section 6.7/7: the five tracked stages, in order - 'cancelled' is
// deliberately excluded, since it's a special status shown outside the
// progress bar, never as one of its steps.
const CANCELLABLE_STATUSES = ['pending', 'confirmed', 'preparing'];

function mergeDuplicateItems(items) {
  const merged = new Map();
  for (const item of items) {
    const existing = merged.get(item.productId);
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      merged.set(item.productId, { productId: item.productId, quantity: item.quantity });
    }
  }
  return Array.from(merged.values());
}

async function nextOrderNumber() {
  const counter = await Counter.findOneAndUpdate(
    { _id: 'order_number' },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );
  return counter.seq;
}

// Section 7/8: the availability check runs against isAvailable as it stands
// right now at submission - not whatever was shown when the pharmacist added
// the item to their cart, since it can drift in the meantime. Every failure
// is collected (not just the first) so the pharmacist can fix the whole cart
// in one pass instead of resubmitting repeatedly.
// TODO(re-enable-stock): also compared requested quantity against
// stockQuantity here (INSUFFICIENT_STOCK) - see the TODO on product.model.js.
//
// No multi-document transaction here: the dev/local MongoDB is a standalone
// instance (Mongoose transactions require a replica set, which Railway/Atlas
// provide in production but a bare `mongod` does not). All validation runs
// before the order number is issued or anything is written, which keeps the
// inconsistency window to "counter incremented but the writes below fail" -
// a crash-only edge case, not a normal-path risk.
// `isReplacement` (Section 6.9/8): a return, once approved, spins up a normal
// order through this exact same path - reused rather than duplicated - but
// zero-priced (a replacement for goods already paid for, not a new charge).
// Stock/availability is still checked normally: the warehouse genuinely needs
// the replacement units in hand to fulfill it.
async function createOrder({ userId, pharmacyId, warehouseId, items, notes, isReplacement = false }) {
  // Defense in depth: order.controller.js's validateItems already rejects an
  // empty/invalid cart before this is ever called from the API, and a
  // return's own items are validated non-empty at creation time (the other
  // caller, approveReturn in warehouseReturn.service.js) - but this is the
  // one choke point every order write passes through, so it re-checks rather
  // than trusting every future caller to remember to.
  if (!Array.isArray(items) || items.length === 0) {
    throw ApiError.badRequest('Your cart is empty.', undefined, 'CART_EMPTY');
  }
  const invalidItem = items.find((item) => !Number.isInteger(item.quantity) || item.quantity <= 0);
  if (invalidItem) {
    throw ApiError.badRequest('Invalid quantity in cart.', undefined, 'INVALID_QUANTITY');
  }

  const available = await isWarehouseAvailable(warehouseId);
  if (!available) {
    throw ApiError.notFound('Warehouse not found.', 'WAREHOUSE_NOT_FOUND');
  }

  const warehouse = await Warehouse.findById(warehouseId);
  const merged = mergeDuplicateItems(items);
  const productIds = merged.map((item) => item.productId);

  // Section 14 Part 2: resolved here (read-only - these docs are never
  // saved, only their values get snapshotted into OrderItem below) so the
  // order's own productNameAr/productNameEn are correct whether the product
  // is catalog-linked or legacy.
  const products = await Product.find({ _id: { $in: productIds }, warehouseId, isActive: true }).populate(
    'masterProductId'
  );
  products.forEach(applyResolvedIdentity);
  const productById = new Map(products.map((p) => [p._id.toString(), p]));

  // Each problem is a structured { code, productId, ...params } rather than a
  // pre-rendered sentence - the Flutter client already knows every cart
  // item's localized name (it's the one that put them there), so it only
  // needs the code + numeric params to render its own Arabic/English
  // message. `fallbackText` below is only for the English `message` field
  // (logs, and any client that hasn't adopted the code-based translation yet).
  const problems = [];
  const fallbackText = [];
  for (const item of merged) {
    const product = productById.get(item.productId);
    if (!product) {
      problems.push({ code: 'PRODUCT_NOT_FOUND', productId: item.productId });
      fallbackText.push('One of the requested products is no longer available from this warehouse.');
      continue;
    }
    if (!product.isAvailable) {
      problems.push({ code: 'PRODUCT_UNAVAILABLE', productId: item.productId });
      fallbackText.push(`${product.nameEn} is currently unavailable.`);
    }
  }

  if (problems.length > 0) {
    throw ApiError.badRequest(fallbackText.join(' '), { problems }, 'STOCK_CHECK_FAILED');
  }

  // Section: USD-first catalog pricing - product.price is USD, but orders/
  // invoices stay SYP (locked in at purchase time, same as any real
  // invoice). The live rate is fetched once here and applied to every line
  // below, rather than per-item, so a single order is never priced against
  // two different rates. No rate at all (API never configured, no admin
  // manual entry) means there's nothing to charge in SYP - fail clearly
  // rather than order at a made-up rate.
  const rate = await getRate();
  if (!rate) {
    throw ApiError.badRequest(
      'Exchange rate is not available yet - orders cannot be priced.',
      undefined,
      'EXCHANGE_RATE_UNAVAILABLE'
    );
  }
  const usdToSyp = rate.usdToSyp;

  const now = new Date();
  const [offers, manufacturerDiscountByName] = await Promise.all([
    Offer.find({
      warehouseId,
      status: 'approved',
      startDate: { $lte: now },
      endDate: { $gte: now },
      productId: { $in: productIds },
    }),
    getDiscountMapForWarehouse(warehouseId),
  ]);
  const offerByProductId = new Map(offers.map((o) => [o.productId.toString(), o]));

  let totalPrice = 0;
  // Accumulated natively in USD rather than back-converted from the SYP
  // figures below (same reasoning as savingsUsd) - this is the number the
  // warehouse's order-size limits are checked against, and it matches the
  // cart's own subtotal exactly, so the app's gate and this one agree.
  let subtotalUsd = 0;
  const orderItemsData = merged.map((item) => {
    const product = productById.get(item.productId);
    const offer = offerByProductId.get(item.productId);
    // manufacturerAr here is already resolved (Section 14 Part 2's
    // applyResolvedIdentity, above) whether this product is catalog-linked
    // or legacy, so this lookup works either way.
    const manufacturerDiscountPercentage = manufacturerDiscountByName.get(product.manufacturerAr) ?? null;

    // product.price is USD - converted to SYP here, at order time, using
    // today's rate (see comment above).
    const unitPrice = Math.round(product.price * usdToSyp);
    // Section 4/15: the product-level offer and the warehouse's
    // manufacturer discount (if any) both apply here, stacked - the
    // platform discount/commission below applies afterward, to the order
    // total. A replacement order (Section 6.9) is always zero-priced
    // regardless of either - unitPrice is kept as-is purely for display
    // context ("this replaces a unitPrice item"), not billed.
    const discountPrice = isReplacement
      ? 0
      : stackedDiscountSyp(unitPrice, offer?.discountPercentage, manufacturerDiscountPercentage);
    totalPrice += discountPrice * item.quantity;

    // Section 15: computed independently in USD, straight from the
    // catalog's native currency, rather than back-converted from the SYP
    // figures above - avoids compounding two separate roundings. Only the
    // amount is stored, deliberately not the percentage or which
    // manufacturer it came from (project owner's decision).
    const discountedPriceUsd = isReplacement
      ? product.price
      : computeDiscountedPriceUsd(product.price, offer?.discountPercentage, manufacturerDiscountPercentage);
    const savingsUsd = isReplacement
      ? 0
      : Math.round((product.price - discountedPriceUsd) * item.quantity * 100) / 100;
    subtotalUsd += discountedPriceUsd * item.quantity;

    return {
      productId: product._id,
      productNameAr: product.nameAr,
      productNameEn: product.nameEn,
      manufacturerAr: product.manufacturerAr,
      manufacturerEn: product.manufacturerEn,
      quantity: item.quantity,
      unitPrice,
      discountPrice,
      savingsUsd,
    };
  });

  // Section: the warehouse's own order-size limits (warehouse.model.js).
  // Replacement orders are exempt - they're zero-priced and created by
  // approveReturn on the warehouse's own behalf, so enforcing a minimum
  // here would block a return the warehouse had just approved.
  if (!isReplacement) {
    const orderSubtotalUsd = Math.round(subtotalUsd * 100) / 100;
    if (warehouse.minOrderAmountUsd > 0 && orderSubtotalUsd < warehouse.minOrderAmountUsd) {
      throw ApiError.badRequest(
        `The minimum order from this warehouse is $${warehouse.minOrderAmountUsd}.`,
        { minOrderAmountUsd: warehouse.minOrderAmountUsd, subtotalUsd: orderSubtotalUsd },
        'ORDER_BELOW_MINIMUM'
      );
    }
    if (warehouse.maxOrderAmountUsd != null && orderSubtotalUsd > warehouse.maxOrderAmountUsd) {
      throw ApiError.badRequest(
        `The maximum order from this warehouse is $${warehouse.maxOrderAmountUsd}.`,
        { maxOrderAmountUsd: warehouse.maxOrderAmountUsd, subtotalUsd: orderSubtotalUsd },
        'ORDER_ABOVE_MAXIMUM'
      );
    }
  }

  const discountAmount = Math.round((totalPrice * warehouse.discountRate) / 100);
  const commissionAmount = Math.round((totalPrice * warehouse.commissionRate) / 100);
  const finalPrice = totalPrice - discountAmount;

  const orderNumber = await nextOrderNumber();

  const order = await Order.create({
    orderNumber,
    pharmacyId,
    warehouseId,
    status: 'pending',
    totalPrice,
    discountAmount,
    commissionAmount,
    finalPrice,
    notes: notes || null,
    statusHistory: [{ status: 'pending', changedBy: userId, changedAt: now }],
  });

  await OrderItem.insertMany(
    orderItemsData.map((item) => ({ ...item, orderId: order._id }))
  );

  // Realtime signal to this order's own warehouse dashboard - emitted only
  // now, once both the order and its items are durable, and never able to
  // throw back into this function (emitToWarehouse swallows its own errors).
  // Carries ids only: the dashboard re-reads the order through the same
  // /warehouse/orders endpoint it already uses.
  emitToWarehouse(order.warehouseId, EVENTS.ORDER_CREATED, {
    orderId: order._id.toString(),
    orderNumber: order.orderNumber,
    warehouseId: order.warehouseId.toString(),
  });

  return order;
}

// Section: the orders this pharmacy could still raise a return against -
// delivered, not already returned, and still inside the 48-hour window
// (return.service.js owns that rule; this reuses it rather than restating
// it, so the list and the create-time check can't drift apart).
async function listReturnableOrders(pharmacyId) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - RETURN_WINDOW_MS);

  // Narrowed in the query where it's cheap (delivered + updated recently),
  // then filtered precisely on the real deliveredAt below. updatedAt only
  // pre-filters - it can be later than delivery but never earlier, so this
  // can't drop an order that is genuinely still eligible.
  const candidates = await Order.find({
    pharmacyId,
    status: 'delivered',
    updatedAt: { $gte: cutoff },
  }).sort({ _id: -1 });
  if (candidates.length === 0) return [];

  const existingReturns = await Return.find(
    { orderId: { $in: candidates.map((o) => o._id) } },
    'orderId'
  );
  const returnedOrderIds = new Set(existingReturns.map((r) => r.orderId.toString()));

  const eligible = [];
  for (const order of candidates) {
    if (returnedOrderIds.has(order._id.toString())) continue;
    const deliveredAt = findDeliveredAt(order);
    if (!deliveredAt) continue;
    const hoursRemaining = hoursRemainingFor(deliveredAt, now);
    if (hoursRemaining <= 0) continue;
    eligible.push({ order, deliveredAt, hoursRemaining });
  }
  if (eligible.length === 0) return [];

  const [items, warehouses] = await Promise.all([
    OrderItem.find({ orderId: { $in: eligible.map((e) => e.order._id) } }),
    Warehouse.find({ _id: { $in: [...new Set(eligible.map((e) => e.order.warehouseId.toString()))] } }),
  ]);
  const itemsByOrderId = new Map();
  for (const item of items) {
    const key = item.orderId.toString();
    if (!itemsByOrderId.has(key)) itemsByOrderId.set(key, []);
    itemsByOrderId.get(key).push(item);
  }
  const warehouseById = new Map(warehouses.map((w) => [w._id.toString(), w]));

  return eligible.map((entry) => ({
    ...entry,
    items: itemsByOrderId.get(entry.order._id.toString()) ?? [],
    warehouse: warehouseById.get(entry.order.warehouseId.toString()) ?? null,
  }));
}

// IDOR guard: scoped to pharmacyId, not just orderId, so one pharmacy can
// never view another's order by guessing/incrementing an id. Not
// distinguishing "malformed id" from "not yours" in the response, same
// pattern used for accounts/warehouses elsewhere in this codebase.
//
// Also the backing call for the digital invoice (Section 6.8): `items` here
// are the snapshotted OrderItem rows (name/quantity/price as they were at
// order time), not a re-fetch of the live product - see orderItem.model.js.
//
// Section 6.9: also carries the order's linked return (if any) - the
// tracking/invoice screen must always show it, never leave it disconnected
// from the original order.
async function getOrderForPharmacy(orderId, pharmacyId) {
  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    throw ApiError.notFound('Order not found.', 'ORDER_NOT_FOUND');
  }
  const order = await Order.findOne({ _id: orderId, pharmacyId });
  if (!order) {
    throw ApiError.notFound('Order not found.', 'ORDER_NOT_FOUND');
  }
  // myReview: this pharmacy's own rating of the warehouse for this order, if
  // it's submitted one already (Section 8/13c).
  const [warehouse, items, returnRequest, myReview] = await Promise.all([
    Warehouse.findById(order.warehouseId),
    OrderItem.find({ orderId: order._id }),
    Return.findOne({ orderId: order._id }),
    Review.findOne({ orderId: order._id, reviewerType: 'pharmacy' }),
  ]);
  return { order, warehouse, items, returnRequest, myReview };
}

const DEFAULT_ORDERS_LIMIT = 15;

// Section 6.8: "my orders" list - every status included (delivered/cancelled
// are history, not just active tracking), scoped to the caller's own
// pharmacy (same IDOR pattern as getOrderForPharmacy above). Sorted by
// orderNumber, not createdAt: it's already a unique-indexed, sequentially
// assigned field, so descending order is both "newest first" and index-backed
// without adding a second index.
//
// Cursor pagination: `after` is the last orderNumber seen, meaning "orders
// numbered below this one" (descending = newest first).
async function listOrdersForPharmacy(pharmacyId, { limit = DEFAULT_ORDERS_LIMIT, after = null } = {}) {
  const filter = { pharmacyId };
  if (after !== null) {
    filter.orderNumber = { $lt: after };
  }

  const orders = await Order.find(filter)
    .sort({ orderNumber: -1 })
    .limit(limit + 1);
  const hasMore = orders.length > limit;
  const page = hasMore ? orders.slice(0, limit) : orders;
  // Stringified even though orderNumber is a Number - the pagination
  // contract's nextCursor is always a string, same shape regardless of
  // which field a given endpoint actually cursors on.
  const nextCursor = page.length > 0 ? String(page[page.length - 1].orderNumber) : null;

  const warehouseIds = [...new Set(page.map((o) => o.warehouseId.toString()))];
  const warehouses = await Warehouse.find({ _id: { $in: warehouseIds } });
  const warehouseById = new Map(warehouses.map((w) => [w._id.toString(), w]));

  const rows = page.map((order) => ({
    order,
    warehouse: warehouseById.get(order.warehouseId.toString()) ?? null,
  }));
  return { rows, hasMore, nextCursor };
}

// Section 7: only the pharmacist may cancel, and only before the order goes
// out for delivery - the app has no cancellation authority at all past that
// point (contact happens manually, outside the app).
async function cancelOrder(orderId, pharmacyId, userId) {
  const { order, warehouse, items } = await getOrderForPharmacy(orderId, pharmacyId);

  if (!CANCELLABLE_STATUSES.includes(order.status)) {
    throw ApiError.badRequest(
      'This order can no longer be cancelled from the app.',
      undefined,
      'ORDER_NOT_CANCELLABLE'
    );
  }

  const now = new Date();
  order.status = 'cancelled';
  order.cancelledBy = userId;
  order.statusHistory.push({ status: 'cancelled', changedBy: userId, changedAt: now });
  await order.save();

  // Only after the cancellation is persisted. This is the one order event the
  // warehouse has no other way of learning about promptly - it's the pharmacy
  // that cancels, and there's no FCM to warehouses today.
  emitToWarehouse(order.warehouseId, EVENTS.ORDER_CANCELLED, {
    orderId: order._id.toString(),
    orderNumber: order.orderNumber,
    warehouseId: order.warehouseId.toString(),
  });

  return { order, warehouse, items };
}

module.exports = {
  createOrder,
  getOrderForPharmacy,
  cancelOrder,
  listOrdersForPharmacy,
  listReturnableOrders,
  stackedDiscountSyp,
};
