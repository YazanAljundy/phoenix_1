const mongoose = require('mongoose');
const { ApiError } = require('../utils/ApiError');
const Order = require('../models/order.model');
const OrderItem = require('../models/orderItem.model');
const Pharmacy = require('../models/pharmacy.model');
const Product = require('../models/product.model');
const Offer = require('../models/offer.model');
const Warehouse = require('../models/warehouse.model');
const Review = require('../models/review.model');
const Return = require('../models/return.model');
const Advertisement = require('../models/advertisement.model');
const { recomputeBalance } = require('./pharmacyBalance.service');
const notificationService = require('./notification.service');
const {
  stackedDiscountSyp,
  advertisementDiscountSyp,
  advertisementPackageBreak,
} = require('./order.service');
const { getRate } = require('./exchangeRate.service');
const { applyResolvedIdentity } = require('./productCatalog.service');
const { getDiscountMapForWarehouse, computeDiscountedPriceUsd } = require('./manufacturerDiscount.service');
const { emitToWarehouse, EVENTS } = require('../realtime');

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

  // .select(): warehouseOrder.viewmodel.js's toWarehouseOrderItem (the list
  // row) reads orderNumber/status/finalPrice/notes/createdAt; pharmacyId is
  // the join key. Never saved - advanceOrderStatus / updateOrderItems each
  // re-load the order themselves.
  const orders = await Order.find(filter)
    .select('orderNumber status finalPrice notes createdAt pharmacyId')
    .sort({ orderNumber: 1 })
    .limit(limit + 1);
  const hasMore = orders.length > limit;
  const page = hasMore ? orders.slice(0, limit) : orders;
  const nextCursor = page.length > 0 ? String(page[page.length - 1].orderNumber) : null;

  if (page.length === 0) return { rows: [], hasMore: false, nextCursor: null };

  const orderIds = page.map((o) => o._id);
  const pharmacyIds = [...new Set(page.map((o) => o.pharmacyId.toString()))];

  const [items, pharmacies, reviews] = await Promise.all([
    // serializeOrderItem (list variant) reads everything but savingsUsd.
    OrderItem.find({ orderId: { $in: orderIds } })
      .select('orderId productId productNameAr productNameEn manufacturerAr manufacturerEn quantity unitPrice discountPrice'),
    // serializePharmacy (auth.viewmodel) field set.
    Pharmacy.find({ _id: { $in: pharmacyIds } })
      .select('nameAr nameEn ownerName address city phone verificationPhoto'),
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

  // Section: optional proof-of-delivery, decided PER ORDER
  // (order.requiresDeliverySealPhoto - seeded from the warehouse default at
  // creation, then owned by the order). The final step to 'delivered' is gated
  // on the pharmacy having attached the shipment seal photo
  // (order.service.js's attachDeliverySealPhoto). This is the authoritative
  // check - the client cannot skip it by calling advance-status directly.
  // Every other transition, and every order that doesn't require the photo, is
  // completely unaffected.
  if (next === 'delivered' && order.requiresDeliverySealPhoto && !order.deliverySealPhoto) {
    throw ApiError.badRequest(
      'A seal photo is required to confirm delivery.',
      undefined,
      'DELIVERY_SEAL_PHOTO_REQUIRED'
    );
  }

  const now = new Date();
  order.status = next;
  order.statusHistory.push({ status: next, changedBy: userId, changedAt: now });
  await order.save();

  // Persisted - now tell this warehouse's other open dashboards/tabs. The tab
  // that made the change updates from its own HTTP response as it always has;
  // this is what keeps a second operator's screen from going stale.
  emitToWarehouse(order.warehouseId, EVENTS.ORDER_STATUS_UPDATED, {
    orderId: order._id.toString(),
    orderNumber: order.orderNumber,
    warehouseId: order.warehouseId.toString(),
    status: next,
  });

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
  // want to be pinged for (on the way / delivered) - not every stage,
  // same as sendToUser/sendToAll below, this must never block or undo the
  // status change above if it fails. Wording tracks the user-facing status
  // terminology ('out_for_delivery' -> "On the Way" / "بالطريق").
  if (next === 'out_for_delivery' || next === 'delivered') {
    try {
      const pharmacy = await Pharmacy.findById(order.pharmacyId, 'userId');
      if (pharmacy) {
        await notificationService.sendToUser(pharmacy.userId, {
          titleAr: 'تحديث طلبك',
          titleEn: 'Order Update',
          bodyAr:
            next === 'out_for_delivery'
              ? `طلبك رقم ${order.orderNumber} بالطريق إليك`
              : `تم تسليم طلبك رقم ${order.orderNumber}`,
          bodyEn:
            next === 'out_for_delivery'
              ? `Your order #${order.orderNumber} is on the way`
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
  // Read-only detail (no status change), so a projection is safe here -
  // toWarehouseOrderDetailResponse reads exactly these order fields.
  const order = await Order.findOne({ _id: orderId, warehouseId })
    .select(
      'orderNumber status totalPrice discountAmount commissionAmount advertisementId advertisementDiscountAmount finalPrice notes cancelReason createdAt statusHistory pharmacyId requiresDeliverySealPhoto deliverySealPhoto deliverySealConfirmedAt'
    );
  if (!order) {
    throw ApiError.notFound('Order not found.', 'ORDER_NOT_FOUND');
  }

  const [items, pharmacy, returnRequest] = await Promise.all([
    // Detail item shape adds lineTotal (discountPrice*quantity) and savingsUsd.
    OrderItem.find({ orderId: order._id })
      .select('productId productNameAr productNameEn manufacturerAr manufacturerEn quantity unitPrice discountPrice savingsUsd'),
    Pharmacy.findById(order.pharmacyId)
      .select('nameAr nameEn ownerName address city phone verificationPhoto'),
    Return.findOne({ orderId: order._id }).select('_id'),
  ]);

  return { order, items, pharmacy, hasReturn: Boolean(returnRequest) };
}

const ORDER_ITEMS_EDITED_NOTE = 'تم تعديل أصناف الطلب من قبل المستودع';

function validateEditPayload({ addItems, removeItems, updateItems } = {}) {
  const add = Array.isArray(addItems) ? addItems : [];
  const remove = Array.isArray(removeItems) ? removeItems : [];
  const update = Array.isArray(updateItems) ? updateItems : [];

  for (const item of add) {
    if (!item || typeof item.productId !== 'string' || !mongoose.Types.ObjectId.isValid(item.productId)) {
      throw ApiError.badRequest('Invalid product to add.', undefined, 'INVALID_PRODUCT');
    }
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw ApiError.badRequest('Invalid quantity.', undefined, 'INVALID_QUANTITY');
    }
  }
  for (const id of remove) {
    if (typeof id !== 'string' || !mongoose.Types.ObjectId.isValid(id)) {
      throw ApiError.notFound('One of the items to remove was not found on this order.', 'ORDER_ITEM_NOT_FOUND');
    }
  }
  for (const item of update) {
    if (!item || typeof item.orderItemId !== 'string' || !mongoose.Types.ObjectId.isValid(item.orderItemId)) {
      throw ApiError.notFound('One of the items to update was not found on this order.', 'ORDER_ITEM_NOT_FOUND');
    }
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      throw ApiError.badRequest('Quantity must be at least 1.', undefined, 'INVALID_QUANTITY');
    }
  }
  return { add, remove, update };
}

// Section: the warehouse correcting an order before it's confirmed - add a
// product, drop one, or change a quantity, all in one request, then
// reprice the whole order from scratch. Once the pharmacy or warehouse has
// acted on it (status past 'pending'), items are frozen - see
// ORDER_NOT_EDITABLE below. IDOR guard: scoped to warehouseId, same pattern
// as every other warehouse-side order function in this file.
async function updateOrderItems(orderId, warehouseId, userId, payload) {
  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    throw ApiError.notFound('Order not found.', 'ORDER_NOT_FOUND');
  }
  const order = await Order.findOne({ _id: orderId, warehouseId });
  if (!order) {
    throw ApiError.notFound('Order not found.', 'ORDER_NOT_FOUND');
  }
  if (order.status !== 'pending') {
    throw ApiError.forbidden(
      'This order can no longer be edited after confirmation.',
      'ORDER_NOT_EDITABLE'
    );
  }

  const { add: addItems, remove: removeIds, update: updateItems } = validateEditPayload(payload);

  const currentItems = await OrderItem.find({ orderId: order._id });
  const currentById = new Map(currentItems.map((item) => [item._id.toString(), item]));

  for (const id of removeIds) {
    if (!currentById.has(id)) {
      throw ApiError.notFound('One of the items to remove was not found on this order.', 'ORDER_ITEM_NOT_FOUND');
    }
  }
  for (const { orderItemId } of updateItems) {
    if (!currentById.has(orderItemId)) {
      throw ApiError.notFound('One of the items to update was not found on this order.', 'ORDER_ITEM_NOT_FOUND');
    }
  }

  const removeIdSet = new Set(removeIds);
  const remainingCount = currentItems.length - removeIdSet.size + addItems.length;
  if (removeIdSet.size > 0 && remainingCount <= 0) {
    throw ApiError.badRequest('An order must always have at least one item.', undefined, 'CANNOT_REMOVE_LAST_ITEM');
  }

  // A genuine no-op (nothing to add/remove, and every "updated" quantity
  // already matches what's there) - skip the write entirely, so an
  // accidental empty/repeat request doesn't push a spurious 'modified'
  // entry or ping the pharmacist for nothing. The frontend already guards
  // against sending this at all; this is the same rule enforced again at
  // the boundary.
  const hasQuantityChange = updateItems.some(
    ({ orderItemId, quantity }) => currentById.get(orderItemId).quantity !== quantity
  );
  if (addItems.length === 0 && removeIdSet.size === 0 && !hasQuantityChange) {
    const [pharmacy, returnRequest] = await Promise.all([
      // userId: this function also pushes the pharmacist a notification below.
      Pharmacy.findById(order.pharmacyId)
        .select('userId nameAr nameEn ownerName address city phone verificationPhoto'),
      Return.findOne({ orderId: order._id }).select('_id'),
    ]);
    return { order, items: currentItems, pharmacy, hasReturn: Boolean(returnRequest) };
  }

  const warehouse = await Warehouse.findById(warehouseId);
  const now = new Date();

  for (const { orderItemId, quantity } of updateItems) {
    if (removeIdSet.has(orderItemId)) continue; // being deleted below anyway
    currentById.get(orderItemId).quantity = quantity;
  }
  const changedExisting = updateItems
    .filter(({ orderItemId }) => !removeIdSet.has(orderItemId))
    .map(({ orderItemId }) => currentById.get(orderItemId));
  await Promise.all(changedExisting.map((item) => item.save()));

  if (removeIdSet.size > 0) {
    await OrderItem.deleteMany({ _id: { $in: [...removeIdSet] } });
  }
  const survivingItems = currentItems.filter((item) => !removeIdSet.has(item._id.toString()));

  // New lines get the exact same snapshot pricing as a normal order line
  // (order.service.js's createOrder): today's USD-to-SYP rate, with any
  // active product Offer and the warehouse's manufacturer discount stacked
  // in - a product costs the same whether it's added at checkout or by the
  // warehouse correcting the order afterward.
  let newItems = [];
  if (addItems.length > 0) {
    const productIds = addItems.map((item) => item.productId);
    const products = await Product.find({
      _id: { $in: productIds },
      warehouseId,
      isAvailable: true,
    }).populate('masterProductId');
    products.forEach(applyResolvedIdentity);
    const productById = new Map(products.map((p) => [p._id.toString(), p]));

    const missing = addItems.find((item) => !productById.has(item.productId));
    if (missing) {
      throw ApiError.badRequest(
        'One of the products to add is not available from this warehouse.',
        undefined,
        'PRODUCT_UNAVAILABLE'
      );
    }

    const rate = await getRate();
    if (!rate) {
      throw ApiError.badRequest(
        'Exchange rate is not available yet - items cannot be priced.',
        undefined,
        'EXCHANGE_RATE_UNAVAILABLE'
      );
    }
    const usdToSyp = rate.usdToSyp;

    const [offers, manufacturerDiscountByName] = await Promise.all([
      Offer.find({
        warehouseId,
        status: 'approved',
        startDate: { $lte: now },
        // A permanent offer has no endDate (isPermanent true, endDate null) and
        // stays live from its start date on.
        $or: [{ isPermanent: true }, { endDate: { $gte: now } }],
        productId: { $in: productIds },
      }),
      getDiscountMapForWarehouse(warehouseId),
    ]);
    const offerByProductId = new Map(offers.map((o) => [o.productId.toString(), o]));

    const newItemsData = addItems.map((item) => {
      const product = productById.get(item.productId);
      const offer = offerByProductId.get(item.productId);
      const manufacturerDiscountPercentage = manufacturerDiscountByName.get(product.manufacturerAr) ?? null;

      const unitPrice = Math.round(product.price * usdToSyp);
      const discountPrice = stackedDiscountSyp(unitPrice, offer?.discountPercentage, manufacturerDiscountPercentage);
      const discountedPriceUsd = computeDiscountedPriceUsd(
        product.price,
        offer?.discountPercentage,
        manufacturerDiscountPercentage
      );
      const savingsUsd = Math.round((product.price - discountedPriceUsd) * item.quantity * 100) / 100;

      return {
        orderId: order._id,
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
    newItems = await OrderItem.insertMany(newItemsData);
  }

  const allItems = [...survivingItems, ...newItems];
  const totalPrice = allItems.reduce((sum, item) => sum + item.discountPrice * item.quantity, 0);
  const discountAmount = Math.round((totalPrice * warehouse.discountRate) / 100);
  const commissionAmount = Math.round((totalPrice * warehouse.commissionRate) / 100);

  // An edit can break the advertisement package it was ordered as - the
  // warehouse may have removed one of the advertised products. Re-validate
  // rather than carry the discount blindly: the pharmacy must not keep a
  // package price for goods it is no longer receiving, and equally must not
  // lose it just because an unrelated line changed.
  let advertisementDiscountAmount = 0;
  if (order.advertisementId) {
    const quantityByProductId = new Map(
      allItems.map((item) => [item.productId.toString(), item.quantity])
    );
    const advertisement = await Advertisement.findById(order.advertisementId);
    const stillHolds =
      advertisement && advertisementPackageBreak(advertisement, quantityByProductId) === null;

    if (stillHolds) {
      const rate = await getRate();
      if (!rate) {
        throw ApiError.badRequest(
          'Exchange rate is not available yet - items cannot be priced.',
          undefined,
          'EXCHANGE_RATE_UNAVAILABLE'
        );
      }
      // Sum(order line unit price x ADVERTISED quantity) for the package's
      // products - taken from the order's OWN advertised line prices (not a
      // fresh catalog fetch), so it stays consistent with the totalPrice
      // summed above and finalPrice lands exactly on the package total. The
      // package holds, so every advertised product has a surviving line at
      // >= its advertised quantity.
      const advertisedQtyById = new Map(
        advertisement.items.map((i) => [i.productId.toString(), i.quantity])
      );
      const advertisedSypSubtotal = allItems
        .filter((line) => advertisedQtyById.has(line.productId.toString()))
        .reduce(
          (sum, line) => sum + line.discountPrice * advertisedQtyById.get(line.productId.toString()),
          0
        );
      advertisementDiscountAmount = advertisementDiscountSyp(
        advertisedSypSubtotal,
        advertisement.totalPriceUsd,
        rate.usdToSyp
      );
    } else {
      // The package no longer applies. The order stays valid and simply
      // reprices as a normal one; the 'modified' history entry below records
      // that something changed.
      order.advertisementId = null;
    }
  }

  const finalPrice = totalPrice - discountAmount - advertisementDiscountAmount;

  order.totalPrice = totalPrice;
  order.discountAmount = discountAmount;
  order.commissionAmount = commissionAmount;
  order.advertisementDiscountAmount = advertisementDiscountAmount;
  order.finalPrice = finalPrice;
  order.statusHistory.push({
    status: 'modified',
    changedBy: userId,
    changedAt: now,
    note: ORDER_ITEMS_EDITED_NOTE,
  });
  await order.save();

  const [pharmacy, returnRequest] = await Promise.all([
    // userId: the pharmacist is notified of the edit just below.
    Pharmacy.findById(order.pharmacyId)
      .select('userId nameAr nameEn ownerName address city phone verificationPhoto'),
    Return.findOne({ orderId: order._id }).select('_id'),
  ]);

  // Never lets a notification hiccup undo the edit above, which already
  // succeeded - same defensive pattern as advanceOrderStatus above. Sent
  // only after order.save() resolves, i.e. only once the edit is durable.
  try {
    if (pharmacy) {
      await notificationService.sendToUser(pharmacy.userId, {
        titleAr: 'تم تعديل طلبك',
        titleEn: 'Your order was modified',
        bodyAr: `قام المستودع بتعديل أصناف طلبك رقم ${order.orderNumber}`,
        bodyEn: `The warehouse modified items in order #${order.orderNumber}`,
        type: 'order_update',
        relatedOrderId: order._id,
      });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to send order-items-modified notification.', err.message);
  }

  return { order, items: allItems, pharmacy, hasReturn: Boolean(returnRequest) };
}

// Section: the warehouse flips this one order's proof-of-delivery requirement
// (order.requiresDeliverySealPhoto - seeded from the warehouse default at
// creation, then per-order). Only this flag is writable here; nothing else on
// the order changes, no status transition, no notification/realtime. IDOR
// guard: scoped to warehouseId, same as every other function in this file.
// Locked once the order is done - a delivered/cancelled order's requirement
// can no longer matter.
async function setDeliverySealRequirement(orderId, warehouseId, requiresDeliverySealPhoto) {
  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    throw ApiError.notFound('Order not found.', 'ORDER_NOT_FOUND');
  }
  const order = await Order.findOne({ _id: orderId, warehouseId });
  if (!order) {
    throw ApiError.notFound('Order not found.', 'ORDER_NOT_FOUND');
  }
  if (order.status === 'delivered' || order.status === 'cancelled') {
    throw ApiError.badRequest(
      'This order is closed - its delivery seal requirement can no longer be changed.',
      undefined,
      'ORDER_SEAL_REQUIREMENT_LOCKED'
    );
  }

  order.requiresDeliverySealPhoto = Boolean(requiresDeliverySealPhoto);
  await order.save();
  return order;
}

module.exports = {
  listOrdersForWarehouse,
  advanceOrderStatus,
  getOrderDetailForWarehouse,
  updateOrderItems,
  setDeliverySealRequirement,
};
