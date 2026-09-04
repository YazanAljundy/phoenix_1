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
const Complaint = require('../models/complaint.model');
const { isWarehouseAvailable } = require('./warehouse.service');
const {
  RETURN_WINDOW_MS,
  findDeliveredAt,
  hoursRemainingFor,
} = require('./return.service');
const { getRate } = require('./exchangeRate.service');
const { deleteImageByUrl } = require('./upload.service');
const { applyResolvedIdentity } = require('./productCatalog.service');
const { getDiscountMapForWarehouse, computeDiscountedPriceUsd } = require('./manufacturerDiscount.service');
// advertisement.service depends on warehouse/productCatalog only - it never
// requires this file back, so there is no cycle here.
const { loadActiveAdvertisementOrThrow } = require('./advertisement.service');
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
// An advertisement package lists a quantity per product. Each product is
// billed at its CURRENT catalog price; the package total is the discount, so
// it is the gap between the quantity-weighted sum of those catalog prices and
// the total - counted ONCE, regardless of how many extra units the pharmacist
// ordered. Extra units are simply charged the catalog price with no further
// discount, which can never over-discount.
//
// `advertisedSypSubtotal` is passed by the caller as
// Σ(catalog price x ADVERTISED quantity), in SYP, from the same line prices it
// summed into the order total - so createOrder (fresh catalog prices) and the
// warehouse edit path (the order's own stored line prices) each stay
// internally consistent and `finalPrice` lands exactly on the package total.
function advertisementDiscountSyp(advertisedSypSubtotal, totalPriceUsd, usdToSyp) {
  const packageTotalSyp = Math.round(totalPriceUsd * usdToSyp);
  // Clamped at 0: a package total at or above the catalog sum is allowed
  // (warehouseAdvertisement.service.js deliberately doesn't forbid it - it just
  // means "no saving"), but it must never become a surcharge.
  return Math.max(0, advertisedSypSubtotal - packageTotalSyp);
}

// The package only holds if the pharmacist is actually buying it: every
// advertised product ordered at AT LEAST its advertised quantity. Returns the
// reason it doesn't hold, or null when it does.
function advertisementPackageBreak(advertisement, quantityByProductId) {
  for (const item of advertisement.items) {
    const ordered = quantityByProductId.get(item.productId.toString());
    if (!ordered || ordered < item.quantity) return 'ADVERTISEMENT_ITEM_MISSING';
  }
  return null;
}

async function createOrder({
  userId,
  pharmacyId,
  warehouseId,
  items,
  notes,
  advertisementId = null,
  isReplacement = false,
}) {
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

  // Section: advertisement packages. The client sends only an id - every
  // price, the package total, the discount and the warehouse are re-read here
  // and re-validated, so a tampered request can't buy at its own numbers.
  let advertisement = null;
  // productId -> advertised quantity, for the package's products. Those lines
  // are billed at the plain catalog price (skipping offer/manufacturer
  // stacking), and Σ(catalog price x advertised quantity) feeds the single
  // order-level package discount.
  const advertisedQtyByProductId = new Map();
  if (advertisementId && !isReplacement) {
    // Throws ADVERTISEMENT_UNAVAILABLE unless it is approved AND inside its
    // date window right now - the same single gate the cart-prefill endpoint
    // used, so what the pharmacist saw and what checkout accepts agree.
    advertisement = await loadActiveAdvertisementOrThrow(advertisementId);

    if (String(advertisement.warehouseId) !== String(warehouseId)) {
      throw ApiError.badRequest(
        'This advertisement belongs to a different warehouse.',
        undefined,
        'ADVERTISEMENT_WAREHOUSE_MISMATCH'
      );
    }

    const quantityByProductId = new Map(merged.map((item) => [item.productId, item.quantity]));
    const packageBreak = advertisementPackageBreak(advertisement, quantityByProductId);
    if (packageBreak) {
      throw ApiError.badRequest(
        'The advertisement package is incomplete.',
        undefined,
        packageBreak
      );
    }

    // Every advertised product must still be one of this warehouse's own live
    // products. `productById` was built from
    // { _id: {$in}, warehouseId, isActive: true } and the availability loop
    // above already rejected anything not isAvailable, so membership here is
    // the whole check - no extra query.
    for (const item of advertisement.items) {
      const productId = item.productId.toString();
      const product = productById.get(productId);
      if (!product) {
        throw ApiError.badRequest(
          'A product in this advertisement is no longer available.',
          undefined,
          'ADVERTISEMENT_PRODUCT_UNAVAILABLE'
        );
      }
      advertisedQtyByProductId.set(productId, item.quantity);
    }
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
      // A permanent offer has no endDate (isPermanent true, endDate null) and
      // stays live from its start date on.
      $or: [{ isPermanent: true }, { endDate: { $gte: now } }],
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
  // Σ(catalog line price x ADVERTISED quantity) for the package's products, in
  // SYP - the same per-line prices summed into totalPrice above, weighted by
  // the advertised quantity (not the ordered one), so the package discount
  // below leaves finalPrice on the package total.
  let advertisedSypSubtotal = 0;
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

    // A package line is priced at the plain catalog price and deliberately
    // SKIPS the offer/manufacturer stacking below: the package total is the
    // discount for these lines, applied once at the order level, so stacking a
    // percentage on top would discount them twice. Lines added to the cart
    // outside the package price normally.
    const isAdvertised = advertisedQtyByProductId.has(item.productId);

    // Section 4/15: the product-level offer and the warehouse's
    // manufacturer discount (if any) both apply here, stacked - the
    // platform discount/commission below applies afterward, to the order
    // total. A replacement order (Section 6.9) is always zero-priced
    // regardless of either - unitPrice is kept as-is purely for display
    // context ("this replaces a unitPrice item"), not billed.
    const discountPrice = isReplacement
      ? 0
      : isAdvertised
        ? unitPrice
        : stackedDiscountSyp(unitPrice, offer?.discountPercentage, manufacturerDiscountPercentage);
    totalPrice += discountPrice * item.quantity;
    // Weighted by the ADVERTISED quantity, not the ordered one - extra units
    // are billed at the catalog price with no extra discount.
    if (isAdvertised) advertisedSypSubtotal += discountPrice * advertisedQtyByProductId.get(item.productId);

    // Section 15: computed independently in USD, straight from the
    // catalog's native currency, rather than back-converted from the SYP
    // figures above - avoids compounding two separate roundings. Only the
    // amount is stored, deliberately not the percentage or which
    // manufacturer it came from (project owner's decision).
    // A package line's per-line saving is 0: it is billed at the catalog price
    // and the whole package saving is the one order-level
    // advertisementDiscountAmount below, so counting it here too would
    // double-count it in the invoice's savings footer.
    const discountedPriceUsd = isReplacement || isAdvertised
      ? product.price
      : computeDiscountedPriceUsd(product.price, offer?.discountPercentage, manufacturerDiscountPercentage);
    const savingsUsd = isReplacement
      ? 0
      : Math.max(0, Math.round((product.price - discountedPriceUsd) * item.quantity * 100) / 100);
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
  // Deliberately still on totalPrice: the platform's commission is not reduced
  // by a warehouse's own package promotion, exactly as it isn't by the
  // platform discount below.
  const commissionAmount = Math.round((totalPrice * warehouse.commissionRate) / 100);
  // Kept as its own subtrahend rather than folded into discountAmount, which
  // is always re-derived from warehouse.discountRate (here and in
  // warehouseOrder.service.js's edit path) and would silently erase this.
  const advertisementDiscountAmount = advertisement
    ? advertisementDiscountSyp(advertisedSypSubtotal, advertisement.totalPriceUsd, usdToSyp)
    : 0;
  const finalPrice = totalPrice - discountAmount - advertisementDiscountAmount;

  const orderNumber = await nextOrderNumber();

  const order = await Order.create({
    orderNumber,
    pharmacyId,
    warehouseId,
    status: 'pending',
    totalPrice,
    discountAmount,
    commissionAmount,
    advertisementId: advertisement ? advertisement._id : null,
    advertisementDiscountAmount,
    finalPrice,
    notes: notes || null,
    // Section: proof-of-delivery. Seeded from the warehouse's current default;
    // from here on the order owns this flag (the warehouse can still flip it
    // per order, but changing the warehouse default won't). The client never
    // sends this - it's read straight from the warehouse.
    requiresDeliverySealPhoto: warehouse.requireDeliverySealPhoto ?? false,
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
  // .lean() here and on the three reads below: listReturnableOrders is
  // read-only, straight into order.viewmodel.js. findDeliveredAt only walks
  // statusHistory, which is a plain array on a lean document.
  // .select(): findDeliveredAt walks statusHistory, and order.viewmodel.js's
  // serializeReturnableOrder reads orderNumber/warehouseId/finalPrice.
  // pharmacyId/status/updatedAt are the filter.
  const candidates = await Order.find({
    pharmacyId,
    status: 'delivered',
    updatedAt: { $gte: cutoff },
  })
    .select('orderNumber warehouseId finalPrice statusHistory')
    .sort({ _id: -1 })
    .lean();
  if (candidates.length === 0) return [];

  const existingReturns = await Return.find(
    { orderId: { $in: candidates.map((o) => o._id) } },
    'orderId'
  ).lean();
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
    // serializeReturnableOrder's item shape: productId/productNameAr/
    // productNameEn/quantity/discountPrice, keyed back to its order by orderId.
    OrderItem.find({ orderId: { $in: eligible.map((e) => e.order._id) } })
      .select('orderId productId productNameAr productNameEn quantity discountPrice')
      .lean(),
    Warehouse.find({ _id: { $in: [...new Set(eligible.map((e) => e.order.warehouseId.toString()))] } })
      .select('nameAr nameEn')
      .lean(),
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
// from the original order. Same reasoning for `complaints`: the order-tracking
// screen shows the complaints filed about this order (complaint Section 9), and
// its "file a complaint about this order" CTA seeds the order context from here.
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
  //
  // `order` above is deliberately NOT lean: cancelOrder calls this function
  // and then mutates and saves that document. The four below are only ever
  // read - both this function's callers pass them straight to
  // order.viewmodel.js - so they skip hydration. `items` is the one that
  // matters, being the only unbounded set of the four.
  // .select() throughout: order.viewmodel.js's toOrderDetailResponse reads
  // only the warehouse's two names, the item lines' snapshot fields, the
  // linked return's status/rejectionNote/replacementOrderId, and myReview's
  // rating/comment/createdAt.
  const [warehouse, items, returnRequest, myReview, complaints] = await Promise.all([
    Warehouse.findById(order.warehouseId).select('nameAr nameEn').lean(),
    OrderItem.find({ orderId: order._id })
      .select('productId productNameAr productNameEn manufacturerAr manufacturerEn quantity unitPrice discountPrice savingsUsd')
      .lean(),
    Return.findOne({ orderId: order._id }).select('status rejectionNote replacementOrderId').lean(),
    Review.findOne({ orderId: order._id, reviewerType: 'pharmacy' })
      .select('rating comment createdAt')
      .lean(),
    // Scoped to this pharmacy too (defence in depth - the order is already
    // this pharmacy's). Newest first, covered by the { relatedOrderId, _id }
    // index. Just enough for the tracking screen's list; the full detail is
    // fetched when a row is tapped.
    Complaint.find({ relatedOrderId: order._id, pharmacyId })
      .select('complaintNumber subject status createdAt')
      .sort({ _id: -1 })
      .lean(),
  ]);
  return { order, warehouse, items, returnRequest, myReview, complaints };
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

  // .lean(): this list is read-only - the controller hands the rows straight
  // to order.viewmodel.js. (getOrderForPharmacy stays non-lean because
  // cancelOrder saves the document it returns; this path has no such caller.)
  // .select(): order.viewmodel.js's toOrderListItemSummary reads the pricing
  // fields + orderNumber/status/createdAt; warehouseId is the join key. The
  // list row carries no items and no statusHistory (that's the detail
  // response), so the statusHistory array never leaves the database here.
  const orders = await Order.find(filter)
    .select(
      'orderNumber status totalPrice discountAmount commissionAmount advertisementId advertisementDiscountAmount finalPrice createdAt warehouseId'
    )
    .sort({ orderNumber: -1 })
    .limit(limit + 1)
    .lean();
  const hasMore = orders.length > limit;
  const page = hasMore ? orders.slice(0, limit) : orders;
  // Stringified even though orderNumber is a Number - the pagination
  // contract's nextCursor is always a string, same shape regardless of
  // which field a given endpoint actually cursors on.
  const nextCursor = page.length > 0 ? String(page[page.length - 1].orderNumber) : null;

  const warehouseIds = [...new Set(page.map((o) => o.warehouseId.toString()))];
  const warehouses = await Warehouse.find({ _id: { $in: warehouseIds } }).select('nameAr nameEn').lean();
  const warehouseById = new Map(warehouses.map((w) => [w._id.toString(), w]));

  const rows = page.map((order) => ({
    order,
    warehouse: warehouseById.get(order.warehouseId.toString()) ?? null,
  }));
  return { rows, hasMore, nextCursor };
}

// Account History "Money Saved" card: the running total of everything this
// pharmacy's orders have saved via discounts, read straight from the
// OrderItem.savingsUsd figures already locked in at order time (Section 15 -
// offer + manufacturer discount, in USD). This adds no pricing or discount
// logic of its own; it only sums a field the order flow already computed and
// stored. Cancelled orders are excluded - a cancelled order saved nothing.
async function getSavingsSummaryForPharmacy(pharmacyId) {
  const orderIds = await Order.find({ pharmacyId, status: { $ne: 'cancelled' } })
    .select('_id')
    .lean()
    .then((orders) => orders.map((o) => o._id));

  if (orderIds.length === 0) {
    return { totalSavingsUsd: 0 };
  }

  const [row] = await OrderItem.aggregate([
    { $match: { orderId: { $in: orderIds } } },
    { $group: { _id: null, totalSavingsUsd: { $sum: '$savingsUsd' } } },
  ]);

  // Same 2-decimal USD rounding convention as the per-line savingsUsd itself.
  const totalSavingsUsd = row ? Math.round(row.totalSavingsUsd * 100) / 100 : 0;
  return { totalSavingsUsd };
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

// Section: optional delivery seal photo (per order - order.requiresDeliverySealPhoto).
// The pharmacy attaches a photo of the shipment seal/stamp once the order is
// out for delivery. This DELIBERATELY does not change the order status,
// notifications, realtime or balance - the warehouse still advances the order
// to 'delivered' exactly as before, but warehouseOrder.service.js's
// advanceOrderStatus now refuses that final step until this photo exists (only
// when the order requires it). `imageUrl` is already uploaded to Cloudinary
// by the controller; this just records it on the order.
//
// IDOR: getOrderForPharmacy is scoped to pharmacyId (a pharmacy can only touch
// its own order) and returns a non-lean `order` this can save - the exact same
// pattern cancelOrder above uses.
async function attachDeliverySealPhoto(orderId, pharmacyId, imageUrl) {
  const context = await getOrderForPharmacy(orderId, pharmacyId);
  const { order } = context;

  // Only meaningful while the shipment is actually in transit to the pharmacy.
  // Before that there is nothing to photograph; after 'delivered' the record
  // is closed. (When the setting is on the order also can't reach 'delivered'
  // without this photo, so 'out_for_delivery' is the only state that matters.)
  if (order.status !== 'out_for_delivery') {
    throw ApiError.badRequest(
      'This order is not awaiting a delivery confirmation.',
      undefined,
      'ORDER_NOT_AWAITING_DELIVERY'
    );
  }

  // Retake: drop the previous Cloudinary asset so a re-upload doesn't orphan
  // it. Best-effort (deleteImageByUrl never throws) - a leftover asset is not
  // worth failing the pharmacist's confirmation over.
  if (order.deliverySealPhoto && order.deliverySealPhoto !== imageUrl) {
    await deleteImageByUrl(order.deliverySealPhoto);
  }

  order.deliverySealPhoto = imageUrl;
  order.deliverySealConfirmedAt = new Date();
  await order.save();

  // The full context (warehouse, items, linkedReturn, myReview, complaints) so
  // the controller can render the same complete order-detail response the
  // tracking screen already had - nothing on the screen blinks out on confirm.
  return context;
}

// Section: "Reorder an existing order" - prepares a cart from a past order
// WITHOUT creating anything. It never touches the original order, never writes
// a document, and never trusts a client-supplied warehouse/price: the
// warehouse is the original order's own stored value and every price/
// availability figure is read live from the current catalog (the same way the
// browse endpoint reads them), so checkout stays the single authority for
// pricing and validation.
const REORDERABLE_STATUSES = ['delivered'];

async function prepareReorder(orderId, pharmacyId) {
  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    throw ApiError.notFound('Order not found.', 'ORDER_NOT_FOUND');
  }
  // IDOR: scoped to the caller's own pharmacy, exactly like getOrderForPharmacy
  // - a pharmacy can never reorder another pharmacy's order by guessing an id.
  const order = await Order.findOne({ _id: orderId, pharmacyId })
    .select('status warehouseId')
    .lean();
  if (!order) {
    throw ApiError.notFound('Order not found.', 'ORDER_NOT_FOUND');
  }
  // Section 10: only a completed (delivered) order is eligible - reorder must
  // never resurrect a pending/cancelled order or bypass any existing rule.
  if (!REORDERABLE_STATUSES.includes(order.status)) {
    throw ApiError.badRequest(
      'Only delivered orders can be reordered.',
      undefined,
      'ORDER_NOT_REORDERABLE'
    );
  }

  // Same availability gate the catalog browse uses - a warehouse that's been
  // paused or blocked can't be reordered from, just as it can't be browsed.
  const warehouseAvailable = await isWarehouseAvailable(order.warehouseId);
  if (!warehouseAvailable) {
    throw ApiError.notFound('This warehouse is no longer available.', 'WAREHOUSE_NOT_FOUND');
  }

  // The snapshotted line items - productId + quantity are all reorder needs
  // (name is kept only to describe an item that has since disappeared).
  const orderItems = await OrderItem.find({ orderId: order._id })
    .select('productId quantity productNameAr productNameEn')
    .lean();

  const quantityByProductId = new Map(
    orderItems.map((item) => [item.productId.toString(), item.quantity])
  );
  const productIds = orderItems.map((item) => item.productId);

  // Only the products this order actually needs - never the whole catalog
  // (Section 16). Same base filter + identity resolution + offer/discount
  // stacking as product.service.listWarehouseProducts, so the payload is
  // byte-compatible with the catalog browse response the cart already parses.
  const products = productIds.length
    ? await Product.find({
        _id: { $in: productIds },
        warehouseId: order.warehouseId,
        isActive: true,
      })
        .select(
          'categoryId nameAr nameEn manufacturerAr manufacturerEn image unitAr unitEn price isAvailable masterProductId'
        )
        .populate({ path: 'masterProductId', select: 'nameAr nameEn manufacturerAr manufacturerEn' })
        .lean()
    : [];
  products.forEach(applyResolvedIdentity);

  const now = new Date();
  const [offers, manufacturerDiscountByName, warehouse] = await Promise.all([
    products.length
      ? Offer.find({
          warehouseId: order.warehouseId,
          status: 'approved',
          startDate: { $lte: now },
          // A permanent offer has no endDate (isPermanent true, endDate null)
          // and stays live from its start date on.
          $or: [{ isPermanent: true }, { endDate: { $gte: now } }],
          productId: { $in: products.map((p) => p._id) },
        }).select('productId discountPercentage titleAr titleEn')
      : [],
    getDiscountMapForWarehouse(order.warehouseId),
    Warehouse.findById(order.warehouseId).select('nameAr nameEn').lean(),
  ]);
  const offerByProductId = new Map(offers.map((o) => [o.productId.toString(), o]));

  const items = products.map((product) => ({
    product,
    offer: offerByProductId.get(product._id.toString()) ?? null,
    manufacturerDiscountPercentage: manufacturerDiscountByName.get(product.manufacturerAr) ?? null,
    quantity: quantityByProductId.get(product._id.toString()),
  }));

  // Items on the original order that this warehouse no longer sells (deleted,
  // deactivated, or the product moved warehouse). Reported to the client so it
  // can tell the pharmacist - never silently dropped, never forced into the
  // cart where it would fail validation anyway.
  const availableProductIds = new Set(products.map((p) => p._id.toString()));
  const unavailableItems = orderItems
    .filter((item) => !availableProductIds.has(item.productId.toString()))
    .map((item) => ({
      productId: item.productId,
      productNameAr: item.productNameAr,
      productNameEn: item.productNameEn,
      quantity: item.quantity,
    }));

  return { warehouse, items, unavailableItems };
}

module.exports = {
  createOrder,
  getOrderForPharmacy,
  cancelOrder,
  attachDeliverySealPhoto,
  listOrdersForPharmacy,
  getSavingsSummaryForPharmacy,
  listReturnableOrders,
  prepareReorder,
  stackedDiscountSyp,
  // Shared with warehouseOrder.service.js's order-item editor, so the package
  // rule is stated once and the two paths can never drift.
  advertisementDiscountSyp,
  advertisementPackageBreak,
};
