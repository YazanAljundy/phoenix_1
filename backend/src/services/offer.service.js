const Offer = require('../models/offer.model');
const Product = require('../models/product.model');
const ProductCatalog = require('../models/productCatalog.model');
const Warehouse = require('../models/warehouse.model');
const { ApiError } = require('../utils/ApiError');
const { applyResolvedIdentity, escapeRegex } = require('./productCatalog.service');
const { getDiscountMapForWarehouse } = require('./manufacturerDiscount.service');

// The pharmacist-facing side of warehouse product offers - the "what is on
// promotion right now, everywhere" read behind the app's Offers & Ads tab.
//
// An offer is "live" only while it is approved AND inside its own date window;
// a permanent offer (isPermanent, endDate null) stays live from its start date
// on. No cron job flips an expired one off - this filter is the only thing
// that ever hides one, on every read (same reasoning as
// advertisement.service.activeFilter / banner.service.listActiveBanners).
//
// Exported because product.service.js's per-warehouse catalog read applies the
// exact same predicate: the two must never disagree about whether an offer is
// running, or the catalog and the offers tab would show different prices.
function activeOfferFilter(now = new Date()) {
  return {
    status: 'approved',
    startDate: { $lte: now },
    $or: [{ isPermanent: true }, { endDate: { $gte: now } }],
  };
}

// Only what an offer card actually needs off a product, plus warehouseId (the
// ownership check below) and masterProductId (the populate key for the
// resolved identity - Section 14 Part 2).
const OFFER_PRODUCT_SELECT =
  'warehouseId nameAr nameEn manufacturerAr manufacturerEn image unitAr unitEn price isAvailable masterProductId';
const CATALOG_IDENTITY_SELECT = 'nameAr nameEn manufacturerAr manufacturerEn';

// Every offer a pharmacy may currently see, across every warehouse. Pending,
// expired and not-yet-started ones are all excluded by the one filter above,
// which the {status, startDate, endDate} index backs directly.
//
// `pendingUpdate` is deliberately never read: a warehouse's proposed edit to
// an already-approved offer is not what pharmacies see until an admin
// approves it (see offer.model.js).
async function listActiveOffers() {
  // .lean(): read-only, straight into offer.viewmodel.js.
  const offers = await Offer.find(activeOfferFilter())
    .select('titleAr titleEn discountPercentage startDate endDate isPermanent warehouseId productId')
    .sort({ createdAt: -1 })
    .lean();
  if (offers.length === 0) return [];

  const productIds = [...new Set(offers.map((offer) => offer.productId.toString()))];
  const warehouseIds = [...new Set(offers.map((offer) => offer.warehouseId.toString()))];

  // One $in per collection for the whole list, never a query per offer.
  const [products, warehouses] = await Promise.all([
    Product.find({ _id: { $in: productIds }, isActive: true })
      .select(OFFER_PRODUCT_SELECT)
      .populate({ path: 'masterProductId', select: CATALOG_IDENTITY_SELECT })
      .lean(),
    Warehouse.find({ _id: { $in: warehouseIds }, isActive: true }).select('nameAr nameEn').lean(),
  ]);
  products.forEach(applyResolvedIdentity);
  const productById = new Map(products.map((p) => [p._id.toString(), p]));
  const warehouseById = new Map(warehouses.map((w) => [w._id.toString(), w]));

  // Section 15: the warehouse's standing manufacturer discount stacks with the
  // offer, exactly as it does in the catalog - fetched once per warehouse that
  // actually has a live offer, not once per offer.
  const discountMapEntries = await Promise.all(
    warehouseIds
      .filter((id) => warehouseById.has(id))
      .map(async (id) => [id, await getDiscountMapForWarehouse(id)])
  );
  const discountMapByWarehouseId = new Map(discountMapEntries);

  return offers
    .map((offer) => {
      const warehouseId = offer.warehouseId.toString();
      const product = productById.get(offer.productId.toString()) ?? null;
      return {
        offer,
        product,
        warehouse: warehouseById.get(warehouseId) ?? null,
        manufacturerDiscountPercentage: product
          ? discountMapByWarehouseId.get(warehouseId)?.get(product.manufacturerAr) ?? null
          : null,
      };
    })
    .filter(
      (row) =>
        // A paused/blocked warehouse has nowhere to sell from, a deleted or
        // deactivated product has nothing to discount, and a product that has
        // since moved to another warehouse is not this warehouse's to promote
        // - all hidden for the same reasons the catalog hides them.
        row.warehouse !== null &&
        row.product !== null &&
        row.product.warehouseId.toString() === row.offer.warehouseId.toString()
    );
}

// ---------------------------------------------------------------------------
// Admin/Warehouse Offers pages' status pill - moved server-side from
// web/src/pages/offersFilters.js's matchesOfferFilter (Offers-fix plan,
// Section 1: pinned down field-by-field before this was written; see
// offer.status-filter.test.js for the line-by-line parity check against that
// original function).
// ---------------------------------------------------------------------------

const OFFER_STATUS_VALUES = ['all', 'review', 'active', 'upcoming', 'expired', 'permanent'];

// Same review-queue predicate as adminOffer.service.js's MODERATION_QUEUE_FILTER
// (a brand-new offer awaiting approval, OR an approved offer with a parked
// edit) - defined once here so the status-pill filter and that queue can
// never drift apart.
const OFFER_REVIEW_FILTER = { $or: [{ status: 'pending' }, { pendingUpdate: { $ne: null } }] };

// One Mongo filter per status pill, matching offersFilters.js's
// matchesOfferFilter exactly - including its one quirk: `review` and
// `permanent` are NOT gated on status==='approved' the way `active`/
// `upcoming`/`expired` are (an offer can be both `pending` AND `isPermanent`,
// and would show under both pills in the old code - this preserves that).
//
// `active` deliberately does NOT reuse activeOfferFilter() above: that is the
// pharmacist-facing "should this offer be visible" rule, which never needs an
// `endDate: null` fallback because a non-permanent offer always has an
// endDate (buildOfferFields enforces it - see warehouseOffer.service.js). The
// OLD client-side matchesOfferFilter had that fallback anyway
// (`!offer.endDate`, defensively); kept here so a document in that
// theoretically-unreachable shape still behaves exactly as it did before this
// filter moved server-side. Revisit only if the two predicates are ever
// deliberately unified.
function buildOfferStatusFilter(status, now = new Date()) {
  switch (status) {
    case 'all':
      return {};
    case 'review':
      return OFFER_REVIEW_FILTER;
    case 'permanent':
      return { isPermanent: true };
    case 'active':
      return {
        status: 'approved',
        startDate: { $lte: now },
        $or: [{ isPermanent: true }, { endDate: null }, { endDate: { $gte: now } }],
      };
    case 'upcoming':
      return { status: 'approved', startDate: { $gt: now } };
    case 'expired':
      return { status: 'approved', isPermanent: false, endDate: { $ne: null, $lt: now } };
    default:
      return null;
  }
}

// Resolves a free-text search term into the $or clauses the Admin/Warehouse
// Offers pages' paginated list needs - the offer's own title, and its
// product's name/manufacturer through the same catalog-linked-or-legacy
// two-step every other product search in the app uses (see
// adminProduct.service.js's listPaginatedAllProducts). `includeWarehouseName`
// is admin-only: a warehouse searching its own offers has nothing to gain
// from matching its own name.
//
// Matches offersFilters.js's old haystack fields exactly: productName*,
// title*, warehouseName* (admin only), pendingUpdate's productName* - never
// pendingUpdate's own title (the old haystack never included it either), and
// never discountPercentage (that's the separate min/max range filter).
async function buildOfferSearchOr(searchTerm, { includeWarehouseName = false } = {}) {
  const pattern = new RegExp(escapeRegex(searchTerm), 'i');

  const matchingCatalogEntries = await ProductCatalog.find(
    { $or: [{ nameAr: pattern }, { nameEn: pattern }, { manufacturerAr: pattern }, { manufacturerEn: pattern }] },
    '_id'
  );
  const matchingProducts = await Product.find(
    {
      $or: [
        { nameAr: pattern },
        { nameEn: pattern },
        { manufacturerAr: pattern },
        { manufacturerEn: pattern },
        { masterProductId: { $in: matchingCatalogEntries.map((c) => c._id) } },
      ],
    },
    '_id'
  );
  const productIds = matchingProducts.map((p) => p._id);

  const or = [
    { titleAr: pattern },
    { titleEn: pattern },
    { productId: { $in: productIds } },
    { 'pendingUpdate.productId': { $in: productIds } },
  ];

  if (includeWarehouseName) {
    const matchingWarehouses = await Warehouse.find(
      { $or: [{ nameAr: pattern }, { nameEn: pattern }] },
      '_id'
    );
    or.push({ warehouseId: { $in: matchingWarehouses.map((w) => w._id) } });
  }

  return or;
}

// Combines an optional base scope (e.g. { warehouseId } for the warehouse's
// own list, {} for the admin's cross-warehouse one) with the status pill,
// free-text search and discount range - each pushed as its own clause and
// $and-ed together, since `status` and `search` can each carry their own
// top-level $or that would otherwise collide in one plain object.
async function buildOfferListFilter({
  scopeFilter = {},
  status,
  search,
  minDiscount,
  maxDiscount,
  includeWarehouseName = false,
} = {}) {
  const clauses = [scopeFilter];

  if (status && status !== 'all') {
    const statusFilter = buildOfferStatusFilter(status);
    if (!statusFilter) {
      throw ApiError.badRequest('Invalid status filter.', undefined, 'INVALID_STATUS_FILTER');
    }
    clauses.push(statusFilter);
  }

  if (typeof search === 'string' && search.trim()) {
    const or = await buildOfferSearchOr(search.trim(), { includeWarehouseName });
    clauses.push({ $or: or });
  }

  const discountRange = {};
  if (minDiscount !== undefined && minDiscount !== null && minDiscount !== '') {
    const min = Number(minDiscount);
    if (Number.isFinite(min)) discountRange.$gte = min;
  }
  if (maxDiscount !== undefined && maxDiscount !== null && maxDiscount !== '') {
    const max = Number(maxDiscount);
    if (Number.isFinite(max)) discountRange.$lte = max;
  }
  if (Object.keys(discountRange).length > 0) {
    clauses.push({ discountPercentage: discountRange });
  }

  const nonEmpty = clauses.filter((clause) => Object.keys(clause).length > 0);
  if (nonEmpty.length === 0) return {};
  if (nonEmpty.length === 1) return nonEmpty[0];
  return { $and: nonEmpty };
}

// Cursor pagination shared by adminOffer.service.js and
// warehouseOffer.service.js's own paginated lists - newest-first (`_id`
// descending, same ObjectId-embeds-timestamp trick as every other
// newest-first list in the app), matching the order listAllOffers /
// listOffersForWarehouse already sorted by before this filter existed.
async function listPaginatedOffers(filter, { limit, after = null } = {}) {
  const cursorFilter = after !== null ? { $and: [filter, { _id: { $lt: after } }] } : filter;
  const rows = await Offer.find(cursorFilter)
    .sort({ _id: -1 })
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = page.length > 0 ? String(page[page.length - 1]._id) : null;
  return { rows: page, hasMore, nextCursor };
}

module.exports = {
  activeOfferFilter,
  listActiveOffers,
  OFFER_STATUS_VALUES,
  OFFER_REVIEW_FILTER,
  buildOfferStatusFilter,
  buildOfferSearchOr,
  buildOfferListFilter,
  listPaginatedOffers,
};
