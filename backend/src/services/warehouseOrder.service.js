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
const orderLedger = require('./orderLedger.service');
const ledgerService = require('./ledger.service');
const { runInTransaction } = require('../utils/transaction');
const notificationService = require('./notification.service');
const {
  stackedDiscountSyp,
  advertisementDiscountSyp,
  advertisementPackageBreak,
  rollUpOrderMoney,
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
  let order = await Order.findOne({ _id: orderId, warehouseId });
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

  // Resolved before the transaction opens, never inside it: creating an
  // account is an upsert, and an upsert that also has to create the
  // collection or wait on Mongoose's lazy index build inside a transaction
  // produces write conflicts that burn the retry budget for no reason.
  const account =
    next === 'delivered'
      ? await ledgerService.resolveAccount(order.pharmacyId, order.warehouseId)
      : null;

  // Money-Flow V2. The whole transition is one transaction, and the move is a
  // compare-and-swap on the CURRENT status rather than a read-then-save.
  //
  // Two operators clicking "advance" at the same moment used to both read
  // 'preparing', both write 'out_for_delivery', and both push a history entry.
  // Now the second one matches zero documents and gets a clean conflict, so an
  // order can never skip a stage or be delivered twice.
  //
  // On 'delivered' the charge is posted inside this same transaction: an order
  // cannot end up delivered without its charge, and a charge cannot exist for
  // an order that is not delivered.
  const advanced = await runInTransaction(async (session) => {
    const moved = await Order.findOneAndUpdate(
      { _id: order._id, warehouseId, status: order.status },
      {
        $set: { status: next },
        $push: { statusHistory: { status: next, changedBy: userId, changedAt: now } },
      },
      { new: true, session }
    );

    if (!moved) {
      throw ApiError.conflict(
        'This order was already advanced by someone else.',
        'ORDER_ALREADY_ADVANCED'
      );
    }

    if (next !== 'delivered') return moved;

    const { entry, alreadyPosted } = await orderLedger.postChargeForDelivery(
      { order: moved, userId, deliveredAt: now, account },
      session
    );
    // postChargeForDelivery sets invoiceNumber / deliveredAt / chargeEntryId
    // on the document; persist them in the same transaction as the entry.
    await moved.save({ session });
    await orderLedger.auditDelivery({ order: moved, entry, userId, alreadyPosted }, session);

    return moved;
  });

  // Everything below is post-commit and best-effort: a realtime emit, a legacy
  // cache refresh or a push notification failing must never undo a transition
  // that already succeeded.
  emitToWarehouse(advanced.warehouseId, EVENTS.ORDER_STATUS_UPDATED, {
    orderId: advanced._id.toString(),
    orderNumber: advanced.orderNumber,
    warehouseId: advanced.warehouseId.toString(),
    status: next,
  });

  // The notification block below (and the caller) reads pharmacyId /
  // orderNumber off `order`; point it at the committed document.
  order = advanced;

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
  // The platform discount and the commission are both rolled up AFTER the
  // advertisement block below, because both now depend on the package
  // discount: the discount is taken on what the pharmacy would otherwise pay,
  // and the commission on what it finally does. See rollUpOrderMoney.

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
      // The package covers `advertisedQty` UNITS of each product - counted
      // once per product, not once per order line.
      //
      // updateOrderItems appends a new OrderItem row rather than merging into
      // an existing one, so adding a unit of a product the package already
      // covers leaves two lines for it. Weighting each of those lines by the
      // advertised quantity (which is what this did) counted the package
      // benefit twice, inflating the discount until the extra unit came out
      // free. Consuming the advertised quantity ACROSS a product's lines
      // charges the extras at their normal price, which is the same rule
      // createOrder applies (it merges duplicates before pricing).
      const linesByProductId = new Map();
      for (const line of allItems) {
        const key = line.productId.toString();
        if (!linesByProductId.has(key)) linesByProductId.set(key, []);
        linesByProductId.get(key).push(line);
      }

      let advertisedSypSubtotal = 0;
      for (const [productId, advertisedQty] of advertisedQtyById) {
        let remaining = advertisedQty;
        for (const line of linesByProductId.get(productId) ?? []) {
          if (remaining <= 0) break;
          const covered = Math.min(remaining, line.quantity);
          advertisedSypSubtotal += line.discountPrice * covered;
          remaining -= covered;
        }
      }
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

  const { discountAmount, commissionAmount, finalPrice } = rollUpOrderMoney({
    subtotalSyp: totalPrice,
    advertisementDiscountSypAmount: advertisementDiscountAmount,
    discountRate: warehouse.discountRate,
    commissionRate: warehouse.commissionRate,
  });

  order.totalPrice = totalPrice;
  order.discountAmount = discountAmount;
  order.commissionAmount = commissionAmount;
  order.advertisementDiscountAmount = advertisementDiscountAmount;
  order.finalPrice = finalPrice;
  // The frozen USD figure has to move with the SYP total it mirrors, and it is
  // re-derived through the ORDER's own captured rate - the one its lines were
  // priced at - not whatever the rate happens to be on the day of the edit.
  // An order edited before it is delivered stays internally consistent that way.
  if (order.fx?.rate) {
    order.finalAmountUsd = Math.round((finalPrice / order.fx.rate) * 100) / 100;
  }
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
