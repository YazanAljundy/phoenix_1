const crypto = require('crypto');
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
const { getRate, captureFxSnapshot } = require('./exchangeRate.service');
const { runInTransaction } = require('../utils/transaction');
const { deleteImageByUrl } = require('./upload.service');
const { applyResolvedIdentity } = require('./productCatalog.service');
const { getDiscountMapForWarehouse, computeDiscountedPriceUsd } = require('./manufacturerDiscount.service');
// advertisement.service depends on warehouse/productCatalog only - it never
// requires this file back, so there is no cycle here.
const { loadActiveAdvertisementOrThrow, isAdvertisementAvailable } = require('./advertisement.service');
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
      merged.set(item.productId, {
        productId: item.productId,
        quantity: item.quantity,
        // Two lines for the same product came from the same catalog card and
        // therefore carry the same displayed price, so the first one's is
        // kept rather than summed. `?? null` covers a caller that sends no
        // price at all (an older app build, or approveReturn's internal
        // items) - that line just skips the price check below.
        displayedUnitPriceUsd: item.displayedUnitPriceUsd ?? null,
      });
    }
  }
  return Array.from(merged.values());
}

async function nextOrderNumber(session = null) {
  const counter = await Counter.findOneAndUpdate(
    { _id: 'order_number' },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, session }
  );
  return counter.seq;
}

// Money-Flow V2. The one place an order's money is rolled up, shared by
// createOrder and warehouseOrder.service.js's pending-edit reprice so the two
// can never drift.
//
// What changed from V1, and why:
//
//  1. The platform discount is taken on what the pharmacy would OTHERWISE pay
//     - the subtotal after any advertisement package discount - not on the raw
//     catalog subtotal. V1 computed 4% of the catalog sum even when the
//     pharmacy was buying a package for far less, so a warehouse advertising a
//     $40 package collected $36.65 of it: a 8.4% cut off its own advertised
//     price rather than the intended ~5%. Now the package price is the base,
//     and units ordered beyond the advertised quantity are simply part of that
//     base at their normal price, discounted normally.
//
//     For an order with no advertisement this is arithmetically identical to
//     V1 (advertisementDiscountAmount is 0, so the base IS the subtotal).
//
//  2. Commission is taken on finalPrice - the revenue actually realised -
//     rather than on the pre-discount subtotal. V1 charged the warehouse
//     commission on money it had discounted away.
//
// The two together give the warehouse a predictable cut off its advertised
// price: discountRate + commissionRate x (1 - discountRate), i.e. 4.96% at the
// default 4% + 1%.
function rollUpOrderMoney({
  subtotalSyp,
  advertisementDiscountSypAmount = 0,
  discountRate = 0,
  commissionRate = 0,
}) {
  // What the pharmacy owes before the platform's own discount comes off.
  const discountBaseSyp = subtotalSyp - advertisementDiscountSypAmount;
  const discountAmount = Math.round((discountBaseSyp * discountRate) / 100);
  const finalPrice = discountBaseSyp - discountAmount;
  const commissionAmount = Math.round((finalPrice * commissionRate) / 100);

  return {
    discountAmount,
    advertisementDiscountAmount: advertisementDiscountSypAmount,
    finalPrice,
    commissionAmount,
    // What the warehouse actually receives once the platform takes its cut.
    // Not stored on the order - derived wherever it is shown, and summed by
    // the settlement report.
    warehouseNetSyp: finalPrice - commissionAmount,
  };
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
// Money-Flow V2 removed the `isReplacement` path. Approving a return now
// CREDITS the pharmacy's ledger account (warehouseReturn.service.js) instead
// of spinning up a zero-priced replacement order through here, so every order
// this function creates is a real, billable order.
// A package is bought as a UNIT: the pharmacy pays `totalPriceUsd` per copy,
// and the products inside it are along for the ride. The order still carries
// one OrderItem per package product (the warehouse picks and delivers real
// products, returns are raised against real products, and the invoice lists
// them), each billed at its catalog price - so the package's saving is the gap
// between those catalog lines and the package total.
//
// `packageLinesSyp` is Σ(line price x units ordered) for the group's own
// lines; `totalPriceUsd` and `usdToSyp` both come from the group's frozen
// snapshot, never from the live Advertisement or the live rate. That is what
// makes a `copies` edit months later land on exactly the price the pharmacy
// agreed to.
function advertisementDiscountSyp(packageLinesSyp, totalPriceUsd, usdToSyp) {
  const packageTotalSyp = Math.round(totalPriceUsd * usdToSyp);
  // Clamped at 0: a package total at or above the catalog sum is allowed
  // (warehouseAdvertisement.service.js deliberately doesn't forbid it - it just
  // means "no saving"), but it must never become a surcharge.
  return Math.max(0, packageLinesSyp - packageTotalSyp);
}

// `copies` is the one number the client gets to choose about a package, so it
// is held to the same rule as a cart quantity: a whole number, at least one.
function validateCopies(value) {
  const copies = value === undefined || value === null ? 1 : value;
  if (!Number.isInteger(copies) || copies < 1) {
    throw ApiError.badRequest('Invalid package quantity.', undefined, 'INVALID_PACKAGE_COPIES');
  }
  return copies;
}

// Accepts both shapes the API takes:
//   packages: [{ advertisementId, copies }]   - current clients
//   advertisementId: '...'                    - builds before packages existed
// and folds the legacy single id into a one-copy package, so an old app keeps
// working against the new storage with no special case anywhere below.
//
// Two entries naming the same advertisement are merged into one group with the
// copies added up - the same rule mergeDuplicateItems applies to products, and
// what keeps "one line per package" true on the order as well as in the cart.
function normalizePackageRequests({ packages, advertisementId }) {
  const raw = Array.isArray(packages) ? [...packages] : [];
  if (advertisementId) raw.push({ advertisementId, copies: 1 });

  const byAdvertisementId = new Map();
  for (const entry of raw) {
    if (!entry || typeof entry.advertisementId !== 'string') {
      throw ApiError.badRequest('Invalid advertisement.', undefined, 'INVALID_ADVERTISEMENT');
    }
    const copies = validateCopies(entry.copies);
    const existing = byAdvertisementId.get(entry.advertisementId);
    byAdvertisementId.set(entry.advertisementId, (existing ?? 0) + copies);
  }
  return [...byAdvertisementId].map(([id, copies]) => ({
    advertisementId: id,
    copies,
    // A pre-packages client also sends the package's products as ordinary cart
    // lines, because that is how the old cart worked. The package now supplies
    // those lines itself, so the duplicates have to come back out of `items` -
    // see deductLegacyPackageItems. A current client sends `packages` and no
    // such duplicates, and nothing is deducted.
    fromLegacyField: id === advertisementId,
  }));
}

// Removes what a legacy client double-sent: for each package, its advertised
// quantity of each product comes off that product's loose line. Anything the
// pharmacist ordered ON TOP of the package survives as a loose line and is
// priced normally, which is exactly what the old code did with the units
// beyond the advertised quantity.
function deductLegacyPackageItems(rawItems, advertisements) {
  const owed = new Map();
  for (const { advertisement, copies, fromLegacyField } of advertisements) {
    if (!fromLegacyField) continue;
    for (const item of advertisement.items) {
      const key = item.productId.toString();
      owed.set(key, (owed.get(key) ?? 0) + item.quantity * copies);
    }
  }
  if (owed.size === 0) return rawItems;

  const kept = [];
  for (const item of rawItems) {
    const remaining = owed.get(item.productId) ?? 0;
    if (remaining <= 0) {
      kept.push(item);
      continue;
    }
    const covered = Math.min(remaining, item.quantity);
    owed.set(item.productId, remaining - covered);
    if (item.quantity > covered) kept.push({ ...item, quantity: item.quantity - covered });
  }
  return kept;
}

function compareStrings(a, b) {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

// What an idempotency key stands for: a hash of everything in the request that
// decides which order gets placed. Two requests with the same fingerprint are
// the same order; anything else under the same key is a different order.
//
// Normalized before hashing, so a request that means the same thing hashes the
// same: duplicate product lines are merged and packages folded exactly the way
// createOrder itself does (mergeDuplicateItems / normalizePackageRequests),
// both lists are sorted, and notes are trimmed. The displayed price is kept to
// the cent - the PRICE_CHANGED check below already treats anything finer as
// JSON noise.
//
// Left out on purpose: the key itself, the pharmacy (the unique index already
// scopes a key to one pharmacy), and every price the server computes.
//
// The "order-v1:" prefix versions the format: changing what goes in here must
// change the prefix too, or orders stored under the old format would start
// refusing their own retries.
function computeOrderFingerprint({ warehouseId, items, packageRequests, notes }) {
  const lines = mergeDuplicateItems(Array.isArray(items) ? items : [])
    .map((item) => [
      String(item.productId),
      item.quantity,
      item.displayedUnitPriceUsd === null ? null : Math.round(item.displayedUnitPriceUsd * 100),
    ])
    .sort((a, b) => compareStrings(a[0], b[0]));
  const packageLines = packageRequests
    .map((request) => [String(request.advertisementId), request.copies, request.fromLegacyField])
    .sort((a, b) => compareStrings(a[0], b[0]));
  const trimmedNotes = typeof notes === 'string' && notes.trim() ? notes.trim() : null;

  const canonical = JSON.stringify({
    warehouseId: String(warehouseId),
    items: lines,
    packages: packageLines,
    notes: trimmedNotes,
  });
  return crypto.createHash('sha256').update(`order-v1:${canonical}`).digest('hex');
}

// `existing` is the order a key already produced. The same request again is a
// retry and gets that order back. A different request under the same key -
// the cart was edited after an attempt whose response never arrived - is
// refused: handing back the old order would have the client clear a cart the
// pharmacist changed, as if the changes had been ordered.
//
// An order placed before fingerprints existed has none to compare against and
// replays on its key alone, as it always did.
function replayOrRejectIdempotentOrder(existing, fingerprint) {
  if (existing.idempotencyFingerprint && existing.idempotencyFingerprint !== fingerprint) {
    // orderId/orderNumber are safe to return: the lookup that found this order
    // is scoped to the caller's own pharmacy.
    throw new ApiError(
      409,
      'This order request was already submitted with different contents. Your cart changed after the first attempt; submit again to place it as a new order.',
      { orderId: String(existing._id), orderNumber: existing.orderNumber },
      'IDEMPOTENCY_KEY_REUSED'
    );
  }
  // $locals is Mongoose's per-document scratch space - it is never persisted
  // and never serialized, so this marks the response as a replay for the
  // controller without adding a field to the schema.
  existing.$locals.idempotentReplay = true;
  return existing;
}

async function createOrder({
  userId,
  pharmacyId,
  warehouseId,
  items,
  notes,
  advertisementId = null,
  packages = null,
  idempotencyKey = null,
}) {
  // Money-Flow V2 idempotency. A retried submission (flaky network, a
  // double-tap on "Place order") must not become a second order the pharmacy
  // is later billed for. Checked here before any work, and enforced for real
  // by the unique partial index on (pharmacyId, idempotencyKey) inside the
  // transaction below - this read only makes the common case cheap.
  //
  // The packages are normalized first because the fingerprint covers them.
  const packageRequests = normalizePackageRequests({ packages, advertisementId });
  const idempotencyFingerprint = idempotencyKey
    ? computeOrderFingerprint({ warehouseId, items, packageRequests, notes })
    : null;
  if (idempotencyKey) {
    const existing = await Order.findOne({ pharmacyId, idempotencyKey });
    if (existing) return replayOrRejectIdempotentOrder(existing, idempotencyFingerprint);
  }

  // Defense in depth: order.controller.js's validateItems already rejects an
  // empty/invalid cart before this is ever called from the API, and a
  // return's own items are validated non-empty at creation time (the other
  // caller, approveReturn in warehouseReturn.service.js) - but this is the
  // one choke point every order write passes through, so it re-checks rather
  // than trusting every future caller to remember to.
  //
  // A cart holding nothing but packages has no loose items at all and is a
  // perfectly good order - the package's own products become lines below.
  const plainItems = Array.isArray(items) ? items : [];
  if (plainItems.length === 0 && packageRequests.length === 0) {
    throw ApiError.badRequest('Your cart is empty.', undefined, 'CART_EMPTY');
  }
  const invalidItem = plainItems.find(
    (item) => !Number.isInteger(item.quantity) || item.quantity <= 0
  );
  if (invalidItem) {
    throw ApiError.badRequest('Invalid quantity in cart.', undefined, 'INVALID_QUANTITY');
  }

  const available = await isWarehouseAvailable(warehouseId);
  if (!available) {
    throw ApiError.notFound('Warehouse not found.', 'WAREHOUSE_NOT_FOUND');
  }

  const warehouse = await Warehouse.findById(warehouseId);

  // Section: packages. The client names a package by id and says how many
  // copies it wants - nothing else. Every product in it, every price and the
  // package total are read here, server-side, so a tampered request can't buy
  // at its own numbers.
  //
  // Loaded BEFORE the items are merged, because a legacy client's cart holds
  // duplicates of the package's own products that have to come off first.
  const advertisements = [];
  // Collected rather than thrown on the first one, so a cart holding two
  // paused packages learns about both in a single round trip.
  const unavailableAdvertisementIds = [];
  for (const request of packageRequests) {
    // Throws ADVERTISEMENT_UNAVAILABLE unless it is approved AND inside its
    // date window right now - the same single gate the cart-prefill endpoint
    // used, so what the pharmacist saw and what checkout accepts agree.
    const advertisement = await loadActiveAdvertisementOrThrow(request.advertisementId);
    if (String(advertisement.warehouseId) !== String(warehouseId)) {
      throw ApiError.badRequest(
        'This advertisement belongs to a different warehouse.',
        undefined,
        'ADVERTISEMENT_WAREHOUSE_MISMATCH'
      );
    }
    // Paused by its warehouse or an admin since it went into the cart. It is
    // still approved and in date, so this gets its own explicit code rather
    // than the catch-all ADVERTISEMENT_UNAVAILABLE above.
    if (!isAdvertisementAvailable(advertisement)) {
      unavailableAdvertisementIds.push(String(advertisement._id));
      continue;
    }
    advertisements.push({
      advertisement,
      copies: request.copies,
      fromLegacyField: request.fromLegacyField,
    });
  }

  // Refused before any product is read or anything is priced. The ids travel
  // in `details` so the app can flag exactly those cart lines and offer to
  // remove them - the same "server sends ids, the client already knows the
  // names" contract STOCK_CHECK_FAILED follows.
  if (unavailableAdvertisementIds.length > 0) {
    throw ApiError.badRequest(
      'This package is no longer available.',
      { advertisementIds: unavailableAdvertisementIds },
      'PACKAGE_UNAVAILABLE'
    );
  }

  const merged = deductLegacyPackageItems(mergeDuplicateItems(plainItems), advertisements);
  const productIds = merged.map((item) => item.productId);

  const packageProductIds = advertisements.flatMap(({ advertisement }) =>
    advertisement.items.map((item) => item.productId.toString())
  );

  // Section 14 Part 2: resolved here (read-only - these docs are never
  // saved, only their values get snapshotted into OrderItem below) so the
  // order's own productNameAr/productNameEn are correct whether the product
  // is catalog-linked or legacy.
  const products = await Product.find({
    _id: { $in: [...new Set([...productIds, ...packageProductIds])] },
    warehouseId,
    isActive: true,
  }).populate('masterProductId');
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

  // Every advertised product must still be one of this warehouse's own live
  // products. `productById` was built from
  // { _id: {$in}, warehouseId, isActive: true }, so membership plus
  // isAvailable is the whole check - no extra query. A package is
  // all-or-nothing: one missing product and the whole thing is refused,
  // rather than quietly shipping a partial package at the package price.
  for (const { advertisement } of advertisements) {
    for (const item of advertisement.items) {
      const product = productById.get(item.productId.toString());
      if (!product || !product.isAvailable) {
        throw ApiError.badRequest(
          'A product in this advertisement is no longer available.',
          undefined,
          'ADVERTISEMENT_PRODUCT_UNAVAILABLE'
        );
      }
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
  // Frozen onto the order below. Captured ONCE for the whole order, so a
  // single order is never priced against two different rates, and never
  // re-derived afterwards.
  const fx = await captureFxSnapshot();

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

  // Section 7/8 (price half of the same guarantee the availability check
  // above gives): the cart snapshots a unit price when an item is added and
  // nothing refreshes it, so a warehouse editing a price in the meantime used
  // to mean the pharmacist saw one number and was billed another, with no
  // signal at all. Every line that told us what it was showing is compared
  // against what it would actually be charged, and the whole order is
  // rejected if any of them moved - same shape as STOCK_CHECK_FAILED, so the
  // client renders it through the same per-item path.
  //
  // Deliberately NOT a repricing: the server's number still wins, this only
  // decides whether to charge silently or ask first. Resubmitting with the
  // refreshed price is what confirms it.
  //
  // Only loose lines are checked. A package's own lines never are: the client
  // never quoted a per-unit price for them (it showed one package price, and
  // the package is named by id), so there is nothing to compare against.
  // Lines that sent no price at all (an older app build, or approveReturn's
  // internally-built items) skip it too.
  const priceProblems = [];
  const priceFallbackText = [];
  for (const item of merged) {
    if (item.displayedUnitPriceUsd === null) continue;

    const product = productById.get(item.productId);
    const offer = offerByProductId.get(item.productId);
    const manufacturerDiscountPercentage =
      manufacturerDiscountByName.get(product.manufacturerAr) ?? null;
    const currentPriceUsd = computeDiscountedPriceUsd(
      product.price,
      offer?.discountPercentage,
      manufacturerDiscountPercentage
    );

    // Half a cent: both sides are already rounded to two decimals by
    // computeDiscountedPriceUsd, so anything below this is float noise from
    // the JSON round-trip rather than a real price change.
    if (Math.abs(currentPriceUsd - item.displayedUnitPriceUsd) > 0.005) {
      priceProblems.push({
        code: 'PRICE_CHANGED',
        productId: item.productId,
        displayedPriceUsd: item.displayedUnitPriceUsd,
        currentPriceUsd,
      });
      priceFallbackText.push(
        `${product.nameEn} is now $${currentPriceUsd} (was $${item.displayedUnitPriceUsd}).`
      );
    }
  }

  if (priceProblems.length > 0) {
    throw ApiError.badRequest(
      priceFallbackText.join(' '),
      { problems: priceProblems },
      'PRICE_CHANGED'
    );
  }

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
    // total.
    //
    // Every line here is a LOOSE line. A product also sold inside a package
    // gets its own separate line below and does not affect this one, so
    // buying a package no longer costs the pharmacy the product's own offer
    // on the units it bought outside that package.
    const discountPrice = stackedDiscountSyp(
      unitPrice,
      offer?.discountPercentage,
      manufacturerDiscountPercentage
    );
    totalPrice += discountPrice * item.quantity;

    // Section 15: computed independently in USD, straight from the
    // catalog's native currency, rather than back-converted from the SYP
    // figures above - avoids compounding two separate roundings. Only the
    // amount is stored, deliberately not the percentage or which
    // manufacturer it came from (project owner's decision).
    const discountedPriceUsd = computeDiscountedPriceUsd(
      product.price,
      offer?.discountPercentage,
      manufacturerDiscountPercentage
    );
    const savingsUsd = Math.max(
      0,
      Math.round((product.price - discountedPriceUsd) * item.quantity * 100) / 100
    );
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
      // Money-Flow V2: the same saving frozen in SYP, so the pharmacy's
      // "money saved" figure stops moving with the exchange rate. Derived
      // from the two SYP line prices that were actually charged rather than
      // converted from savingsUsd, so it agrees with the invoice exactly.
      // 0 for a replacement line.
      savingsSyp: Math.max(0, (unitPrice - discountPrice) * item.quantity),
      // A loose line belongs to no package and is freely editable.
      packageGroupId: null,
    };
  });

  // Section: package groups. Each package becomes one group carrying its
  // frozen terms, plus one OrderItem per product in it at `quantity x copies`
  // units. The lines are billed at the plain catalog price and deliberately
  // SKIP the offer/manufacturer stacking - the package total IS the discount
  // for them, so stacking a percentage on top would discount them twice.
  //
  // The group's saving is booked once, at order level, into
  // advertisementDiscountAmount - never per line - so the invoice's savings
  // footer can't count it twice.
  const packageGroups = [];
  let advertisementDiscountAmount = 0;
  for (const { advertisement, copies } of advertisements) {
    const groupId = new mongoose.Types.ObjectId();
    const snapshotItems = advertisement.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
    }));

    let groupLinesSyp = 0;
    for (const item of advertisement.items) {
      const product = productById.get(item.productId.toString());
      const unitPrice = Math.round(product.price * usdToSyp);
      const units = item.quantity * copies;
      groupLinesSyp += unitPrice * units;
      totalPrice += unitPrice * units;

      orderItemsData.push({
        productId: product._id,
        productNameAr: product.nameAr,
        productNameEn: product.nameEn,
        manufacturerAr: product.manufacturerAr,
        manufacturerEn: product.manufacturerEn,
        quantity: units,
        unitPrice,
        // Billed at the catalog price; the saving lives on the group.
        discountPrice: unitPrice,
        savingsUsd: 0,
        savingsSyp: 0,
        // What locks this line: the edit path refuses to touch it.
        packageGroupId: groupId,
      });
    }

    // The whole point of the snapshot: the terms the pharmacy agreed to,
    // copied out of the live Advertisement here and never read from it again.
    const snapshot = {
      titleAr: advertisement.titleAr,
      titleEn: advertisement.titleEn,
      totalPriceUsd: advertisement.totalPriceUsd,
      items: snapshotItems,
      usdToSyp,
    };
    packageGroups.push({
      _id: groupId,
      advertisementId: advertisement._id,
      advertisementSnapshot: snapshot,
      copies,
      totalPriceUsd: Math.round(advertisement.totalPriceUsd * copies * 100) / 100,
    });

    advertisementDiscountAmount += advertisementDiscountSyp(
      groupLinesSyp,
      advertisement.totalPriceUsd * copies,
      usdToSyp
    );
    // The pharmacy pays the package price for these lines, so that - not the
    // catalog sum - is what the order-size limits below compare, and what the
    // cart shows for the same package. The two gates agree by construction.
    subtotalUsd += advertisement.totalPriceUsd * copies;
  }

  // Section: the warehouse's own order-size limits (warehouse.model.js).
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

  // advertisementDiscountAmount was accumulated per group above. It stays its
  // own subtrahend rather than being folded into discountAmount, which is
  // always re-derived from warehouse.discountRate (here and in
  // warehouseOrder.service.js's edit path) and would silently erase this.
  const { discountAmount, commissionAmount, finalPrice } = rollUpOrderMoney({
    subtotalSyp: totalPrice,
    advertisementDiscountSypAmount: advertisementDiscountAmount,
    discountRate: warehouse.discountRate,
    commissionRate: warehouse.commissionRate,
  });

  // Money-Flow V2: the order number, the order and its line items are one
  // all-or-nothing write. V1 issued the number, created the order and then
  // inserted the items as three independent steps, so a failure on the last
  // one left an order carrying a total but no lines - an invoice for nothing.
  const order = await runInTransaction(async (session) => {
    const orderNumber = await nextOrderNumber(session);

    const [created] = await Order.create(
      [
        {
          orderNumber,
          pharmacyId,
          warehouseId,
          status: 'pending',
          currency: 'SYP',
          // The rate every line above was priced through, frozen here.
          fx: fx ?? undefined,
          totalPrice,
          discountAmount,
          commissionAmount,
          orderPackageGroups: packageGroups,
          // Legacy mirror of the FIRST group only, for the reports and clients
          // that already read it - see the note on order.model.js. The groups
          // above are the real record; advertisementIds is the complete list.
          advertisementId: packageGroups.length > 0 ? packageGroups[0].advertisementId : null,
          advertisementIds: packageGroups.map((group) => group.advertisementId),
          advertisementDiscountAmount,
          finalPrice,
          // The order total in USD, frozen at this rate. Reports sum this
          // rather than dividing finalPrice by whatever the rate is later.
          finalAmountUsd: usdToSyp ? Math.round((finalPrice / usdToSyp) * 100) / 100 : null,
          notes: notes || null,
          idempotencyKey: idempotencyKey ?? null,
          idempotencyFingerprint,
          // Section: proof-of-delivery. Seeded from the warehouse's current
          // default; from here on the order owns this flag (the warehouse can
          // still flip it per order, but changing the warehouse default won't).
          // The client never sends this - it's read straight from the warehouse.
          requiresDeliverySealPhoto: warehouse.requireDeliverySealPhoto ?? false,
          statusHistory: [{ status: 'pending', changedBy: userId, changedAt: now }],
        },
      ],
      { session }
    );

    await OrderItem.insertMany(
      orderItemsData.map((item) => ({ ...item, orderId: created._id })),
      { session }
    );

    return created;
  }).catch(async (err) => {
    // The unique (pharmacyId, idempotencyKey) index is the real guard against
    // a duplicate submission: two concurrent retries both pass the pre-check
    // above, and the loser lands here. Return what the winner created - or
    // refuse, if the winner was a different request under the same key.
    if (err && err.code === 11000 && idempotencyKey) {
      const existing = await Order.findOne({ pharmacyId, idempotencyKey });
      if (existing) return replayOrRejectIdempotentOrder(existing, idempotencyFingerprint);
    }
    throw err;
  });

  // Realtime signal to this order's own warehouse dashboard - emitted only
  // now, once the transaction has committed, and never able to throw back into
  // this function (emitToWarehouse swallows its own errors). Carries ids only:
  // the dashboard re-reads the order through the same /warehouse/orders
  // endpoint it already uses.
  emitToWarehouse(order.warehouseId, EVENTS.ORDER_CREATED, {
    orderId: order._id.toString(),
    orderNumber: order.orderNumber,
    warehouseId: order.warehouseId.toString(),
  });

  return order;
}

// Section: the orders this pharmacy could still raise a return against -
// delivered, not already returned, and still inside the 24-hour window
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
  // linked return's status/rejectionNote/credit, and myReview's
  // rating/comment/createdAt.
  const [warehouse, items, returnRequest, myReview, complaints] = await Promise.all([
    Warehouse.findById(order.warehouseId).select('nameAr nameEn').lean(),
    OrderItem.find({ orderId: order._id })
      .select('productId productNameAr productNameEn manufacturerAr manufacturerEn quantity unitPrice discountPrice savingsUsd')
      .lean(),
    Return.findOne({ orderId: order._id }).select('status rejectionNote creditSyp creditUsd').lean(),
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
  // Money-Flow V2. V1 counted only the offer + manufacturer savings held on
  // the line items, so a pharmacy that bought nothing but advertisement
  // packages - the deepest discounts in the product - was told it had saved
  // nothing at all. It also read the USD figure and converted it at the LIVE
  // rate, so a pharmacy's lifetime savings drifted every time the lira did.
  //
  // Now every component is summed in frozen SYP, and the total is what the
  // pharmacy actually did not pay:
  //
  //   offer + manufacturer  ->  OrderItem.savingsSyp   (frozen per line)
  //   advertisement package ->  Order.advertisementDiscountAmount
  //   platform subsidy      ->  Order.discountAmount
  //
  // Cancelled orders are excluded - a cancelled order saved nothing.
  const orders = await Order.find({ pharmacyId, status: { $ne: 'cancelled' } })
    .select('_id discountAmount advertisementDiscountAmount fx')
    .lean();

  if (orders.length === 0) {
    return {
      offerAndManufacturerSyp: 0,
      advertisementSyp: 0,
      platformDiscountSyp: 0,
      totalSavingsSyp: 0,
      totalSavingsUsd: 0,
    };
  }

  const [lineRow] = await OrderItem.aggregate([
    { $match: { orderId: { $in: orders.map((o) => o._id) } } },
    {
      $group: {
        _id: null,
        savingsSyp: { $sum: { $ifNull: ['$savingsSyp', 0] } },
        savingsUsd: { $sum: { $ifNull: ['$savingsUsd', 0] } },
      },
    },
  ]);

  const offerAndManufacturerSyp = Math.round(lineRow?.savingsSyp ?? 0);
  let advertisementSyp = 0;
  let platformDiscountSyp = 0;
  // Each order's own frozen rate, so the USD total is a sum of historically
  // correct conversions rather than one live division at the end.
  let totalSavingsUsd = lineRow?.savingsUsd ?? 0;

  for (const order of orders) {
    const orderSideSyp = (order.advertisementDiscountAmount ?? 0) + (order.discountAmount ?? 0);
    advertisementSyp += order.advertisementDiscountAmount ?? 0;
    platformDiscountSyp += order.discountAmount ?? 0;
    if (order.fx?.rate) totalSavingsUsd += orderSideSyp / order.fx.rate;
  }

  const totalSavingsSyp = offerAndManufacturerSyp + advertisementSyp + platformDiscountSyp;

  return {
    offerAndManufacturerSyp,
    advertisementSyp,
    platformDiscountSyp,
    totalSavingsSyp,
    // Kept for the clients that still render a USD hint. Same 2-decimal
    // convention as the per-line savingsUsd itself.
    totalSavingsUsd: Math.round(totalSavingsUsd * 100) / 100,
  };
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
  rollUpOrderMoney,
  normalizePackageRequests,
  computeOrderFingerprint,
};
