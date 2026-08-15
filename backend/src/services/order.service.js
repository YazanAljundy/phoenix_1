const mongoose = require('mongoose');
const { ApiError } = require('../utils/ApiError');
const Product = require('../models/product.model');
const Offer = require('../models/offer.model');
const Order = require('../models/order.model');
const OrderItem = require('../models/orderItem.model');
const Warehouse = require('../models/warehouse.model');
const Counter = require('../models/counter.model');
const Return = require('../models/return.model');
const { isWarehouseAvailable } = require('./warehouse.service');

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

// Section 7/8: the stock check runs against isAvailable and stockQuantity as
// they stand right now at submission - not whatever was shown when the
// pharmacist added the item to their cart, since both can drift in the
// meantime. Every failure is collected (not just the first) so the pharmacist
// can fix the whole cart in one pass instead of resubmitting repeatedly.
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
  const available = await isWarehouseAvailable(warehouseId);
  if (!available) {
    throw ApiError.notFound('Warehouse not found.', 'WAREHOUSE_NOT_FOUND');
  }

  const warehouse = await Warehouse.findById(warehouseId);
  const merged = mergeDuplicateItems(items);
  const productIds = merged.map((item) => item.productId);

  const products = await Product.find({ _id: { $in: productIds }, warehouseId, isActive: true });
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
    } else if (item.quantity > product.stockQuantity) {
      problems.push({
        code: 'INSUFFICIENT_STOCK',
        productId: item.productId,
        availableQuantity: product.stockQuantity,
      });
      fallbackText.push(`Only ${product.stockQuantity} of ${product.nameEn} is currently available.`);
    }
  }

  if (problems.length > 0) {
    throw ApiError.badRequest(fallbackText.join(' '), { problems }, 'STOCK_CHECK_FAILED');
  }

  const now = new Date();
  const offers = await Offer.find({
    warehouseId,
    status: 'approved',
    startDate: { $lte: now },
    endDate: { $gte: now },
    productId: { $in: productIds },
  });
  const offerByProductId = new Map(offers.map((o) => [o.productId.toString(), o]));

  let totalPrice = 0;
  const orderItemsData = merged.map((item) => {
    const product = productById.get(item.productId);
    const offer = offerByProductId.get(item.productId);
    const unitPrice = product.price;
    // Section 4: the product-level offer (if any) applies first, at the item
    // level - the platform discount/commission below applies afterward, to
    // the order total. A replacement order (Section 6.9) is always
    // zero-priced regardless of offers - unitPrice is kept as-is purely for
    // display context ("this replaces a unitPrice item"), not billed.
    const discountPrice = isReplacement
      ? 0
      : offer
        ? Math.round(unitPrice * (1 - offer.discountPercentage / 100))
        : unitPrice;
    totalPrice += discountPrice * item.quantity;

    return {
      productId: product._id,
      productNameAr: product.nameAr,
      productNameEn: product.nameEn,
      manufacturerAr: product.manufacturerAr,
      manufacturerEn: product.manufacturerEn,
      quantity: item.quantity,
      unitPrice,
      discountPrice,
    };
  });

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

  return order;
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
  const [warehouse, items, returnRequest] = await Promise.all([
    Warehouse.findById(order.warehouseId),
    OrderItem.find({ orderId: order._id }),
    Return.findOne({ orderId: order._id }),
  ]);
  return { order, warehouse, items, returnRequest };
}

// Section 6.8: "my orders" list - every status included (delivered/cancelled
// are history, not just active tracking), scoped to the caller's own
// pharmacy (same IDOR pattern as getOrderForPharmacy above). Sorted by
// orderNumber, not createdAt: it's already a unique-indexed, sequentially
// assigned field, so descending order is both "newest first" and index-backed
// without adding a second index.
async function listOrdersForPharmacy(pharmacyId) {
  const orders = await Order.find({ pharmacyId }).sort({ orderNumber: -1 });
  const warehouseIds = [...new Set(orders.map((o) => o.warehouseId.toString()))];
  const warehouses = await Warehouse.find({ _id: { $in: warehouseIds } });
  const warehouseById = new Map(warehouses.map((w) => [w._id.toString(), w]));

  return orders.map((order) => ({
    order,
    warehouse: warehouseById.get(order.warehouseId.toString()) ?? null,
  }));
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

  return { order, warehouse, items };
}

module.exports = { createOrder, getOrderForPharmacy, cancelOrder, listOrdersForPharmacy };
