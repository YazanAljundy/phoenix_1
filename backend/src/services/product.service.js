const mongoose = require('mongoose');
const { ApiError } = require('../utils/ApiError');
const Product = require('../models/product.model');
const ProductCatalog = require('../models/productCatalog.model');
const Offer = require('../models/offer.model');
const { isWarehouseAvailable } = require('./warehouse.service');
const { applyResolvedIdentity, escapeRegex } = require('./productCatalog.service');
const { getDiscountMapForWarehouse } = require('./manufacturerDiscount.service');

// The four fields a product's identity is made of (Section 14 Part 2). Both
// the search below and the manufacturer list resolve them the same way:
// from the linked ProductCatalog entry when there is one, from the product's
// own legacy fields when there isn't.
const IDENTITY_FIELDS = ['nameAr', 'nameEn', 'manufacturerAr', 'manufacturerEn'];

function identityMatches(pattern) {
  return IDENTITY_FIELDS.map((field) => ({ [field]: pattern }));
}

// Everything the pharmacist-facing catalog actually consumes off a product
// row: product.viewmodel.js's serializeProductWithOffer needs categoryId /
// image / unitAr / unitEn / price / isAvailable plus the resolved identity
// (applyResolvedIdentity overwrites nameAr/nameEn/manufacturerAr/
// manufacturerEn from the linked catalog entry or the product's own legacy
// fields - both must be selectable). masterProductId is the populate key;
// manufacturerAr is also the manufacturer filter and the discount-map key.
// Dropped: description, barcode, manuallyDisabled, lastPriceUpdate, the
// unbounded priceHistory array, warehouseId/isActive (the filter), timestamps.
const CATALOG_PRODUCT_SELECT =
  'categoryId nameAr nameEn manufacturerAr manufacturerEn image unitAr unitEn price isAvailable masterProductId';
const CATALOG_IDENTITY_SELECT = 'nameAr nameEn manufacturerAr manufacturerEn';

const DEFAULT_PRODUCTS_LIMIT = 20;

// Cursor pagination over a filter that can't be fully expressed as a Mongo
// query: `manufacturer` is matched against each product's *resolved* identity
// (Section 14 Part 2 - a catalog-linked product's manufacturerAr lives on the
// populated masterProductId, not the product doc itself), so it can only be
// checked after fetching and resolving each candidate. This pulls batches
// (sorted/cursored by `_id` at the DB level, so still index-backed and never
// re-scanning already-seen rows) and keeps resolving+filtering them until
// either `limit + 1` matches are found (so hasMore is known) or the
// collection is exhausted. Without a manufacturer filter every doc in a
// batch matches, so this degenerates to a single plain query - same
// function, no separate code path needed.
async function fetchMatchingPage(baseFilter, after, limit, manufacturer) {
  const matched = [];
  let cursor = after;
  let exhausted = false;
  const batchSize = manufacturer ? Math.max(limit * 4, 50) : limit + 1;

  while (matched.length <= limit && !exhausted) {
    const filter = { ...baseFilter };
    if (cursor) filter._id = { $gt: cursor };

    // .lean(): these documents are only read - resolved, filtered, then handed
    // to product.viewmodel.js - and never saved. Skipping Mongoose hydration
    // is the single largest CPU saving on this path (a load-test CPU profile
    // attributed ~55% of backend CPU to document construction).
    // applyResolvedIdentity assigns plain properties, which works the same on
    // a lean object as on a document.
    const batch = await Product.find(filter)
      .select(CATALOG_PRODUCT_SELECT)
      .sort({ _id: 1 })
      .limit(batchSize)
      .populate({ path: 'masterProductId', select: CATALOG_IDENTITY_SELECT })
      .lean();
    if (batch.length === 0) break;

    batch.forEach(applyResolvedIdentity);
    for (const product of batch) {
      cursor = product._id;
      if (!manufacturer || product.manufacturerAr === manufacturer) {
        matched.push(product);
        if (matched.length > limit) break;
      }
    }
    if (batch.length < batchSize) exhausted = true;
  }

  const hasMore = matched.length > limit;
  const page = hasMore ? matched.slice(0, limit) : matched;
  const nextCursor = page.length > 0 ? page[page.length - 1]._id.toString() : null;
  return { page, hasMore, nextCursor };
}

// Section 6.5: search by name and manufacturer, filterable by category.
// Section 7: an active, admin-approved offer on a product shows two prices
// (original struck-through + discounted) - merged in here per product.
// Section 14 Part 2: name/manufacturer search runs in memory, after
// resolving each product's identity (populated masterProductId or its own
// legacy fields) - a catalog-linked product no longer carries its own copy
// of these fields for Mongo to match against directly.
//
// Cursor pagination (`limit`/`after`) only applies when there's no text
// search - a name/manufacturer search's result set is small by nature and
// returned in full, same as before (project owner's call).
async function listWarehouseProducts(
  warehouseId,
  { search, categoryId, manufacturer, limit = DEFAULT_PRODUCTS_LIMIT, after = null } = {}
) {
  const available = await isWarehouseAvailable(warehouseId);
  if (!available) {
    throw ApiError.notFound('Warehouse not found.');
  }

  const baseFilter = { warehouseId, isActive: true };

  if (categoryId) {
    if (!mongoose.Types.ObjectId.isValid(categoryId)) {
      throw ApiError.badRequest('Invalid category id.');
    }
    baseFilter.categoryId = categoryId;
  }

  let products;
  let hasMore = false;
  let nextCursor = null;

  if (search && search.trim()) {
    const pattern = new RegExp(escapeRegex(search.trim()), 'i');

    // The match is pushed into MongoDB rather than run over the whole
    // warehouse catalog in Node. It used to load and hydrate every product a
    // warehouse owns and filter the resolved identities in memory, so a search
    // matching a single row still cost time proportional to the entire
    // catalog (measured: ~537 ms for one match in a 5,000-product catalog).
    //
    // A product's searchable identity lives in one of two places, and the two
    // sets are disjoint by construction:
    //   - masterProductId set   -> the linked ProductCatalog entry's fields
    //   - masterProductId null  -> the product's own legacy fields
    // so the catalog is matched first (one query over the shared master list),
    // and products are then selected by link or by their own fields.
    //
    // Deliberately no isActive filter on the catalog lookup: deactivating a
    // catalog entry is a soft flag (productCatalog.service.js
    // deactivateCatalogItem) and populate still resolves it today, so
    // excluding it here would silently change which products a search finds.
    // There is no hard-delete path for a catalog entry, which is what makes
    // "linked" and "legacy" exhaustive - a dangling masterProductId cannot
    // occur, so nothing falls between the two branches.
    const matchingCatalogIds = await ProductCatalog.find(
      { $or: identityMatches(pattern) },
      '_id'
    ).lean();

    const searchFilter = {
      ...baseFilter,
      $or: [
        { masterProductId: { $in: matchingCatalogIds.map((entry) => entry._id) } },
        { masterProductId: null, $or: identityMatches(pattern) },
      ],
    };

    products = await Product.find(searchFilter)
      .select(CATALOG_PRODUCT_SELECT)
      .populate({ path: 'masterProductId', select: CATALOG_IDENTITY_SELECT })
      .lean();
    products.forEach(applyResolvedIdentity);

    if (manufacturer) {
      products = products.filter((p) => p.manufacturerAr === manufacturer);
    }

    // Sorting stays in Node, on the matched rows only. localeCompare is
    // locale-aware and MongoDB's default sort is not, so moving it would
    // change the order results come back in.
    products.sort((a, b) => (a.nameEn || a.nameAr || '').localeCompare(b.nameEn || b.nameAr || ''));
  } else {
    const result = await fetchMatchingPage(baseFilter, after, limit, manufacturer);
    products = result.page;
    hasMore = result.hasMore;
    nextCursor = result.nextCursor;
  }

  const now = new Date();
  const [offers, manufacturerDiscountByName] = await Promise.all([
    Offer.find({
      warehouseId,
      status: 'approved',
      startDate: { $lte: now },
      // A permanent offer has no endDate (isPermanent true, endDate null) and
      // stays live from its start date on.
      $or: [{ isPermanent: true }, { endDate: { $gte: now } }],
      productId: { $in: products.map((p) => p._id) },
    }).select('productId discountPercentage titleAr titleEn'),
    getDiscountMapForWarehouse(warehouseId),
  ]);
  const offerByProductId = new Map(offers.map((o) => [o.productId.toString(), o]));

  // Section 15: the manufacturer discount (if any) stacks with an active
  // Offer - see product.viewmodel.js for where the two combine into one
  // discountPriceUsd.
  const items = products.map((product) => ({
    product,
    offer: offerByProductId.get(product._id.toString()) ?? null,
    manufacturerDiscountPercentage: manufacturerDiscountByName.get(product.manufacturerAr) ?? null,
  }));
  return { items, hasMore, nextCursor };
}

// The pharmacist's new entry point into a warehouse's catalog (warehouse ->
// manufacturers -> medicines, replacing the old warehouse -> medicines flow
// directly): distinct manufacturers derived live from this warehouse's own
// products, not the sticky warehouse_manufacturers registry
// (warehouseManufacturer.service.js) - that registry is for the warehouse's
// own Discounts dropdown and deliberately keeps manufacturers around after
// their products are gone, which would leave a pharmacist tapping into an
// empty catalog. isAvailable is NOT filtered here (only isActive, same base
// filter as listWarehouseProducts above) - a manufacturer stays listed even
// if every one of its medicines is temporarily unavailable, since that
// filtering happens at the medicine level once inside the catalog.
async function listDistinctManufacturersForWarehouse(warehouseId) {
  const available = await isWarehouseAvailable(warehouseId);
  if (!available) {
    throw ApiError.notFound('Warehouse not found.');
  }

  // Resolved the same way as everywhere else (linked -> catalog entry, legacy
  // -> own field), but as two `distinct` queries instead of loading and
  // hydrating the warehouse's entire product collection to reduce it to about
  // ten strings. MongoDB returns only the distinct values, so the work here is
  // proportional to the number of manufacturers rather than to catalog size.
  //
  // Same reasoning as the search above: no isActive filter on the catalog
  // read, because populate resolves a deactivated entry today too.
  const [legacyManufacturers, linkedCatalogIds] = await Promise.all([
    Product.distinct('manufacturerAr', { warehouseId, isActive: true, masterProductId: null }),
    Product.distinct('masterProductId', { warehouseId, isActive: true, masterProductId: { $ne: null } }),
  ]);

  const linkedManufacturers = linkedCatalogIds.length
    ? await ProductCatalog.distinct('manufacturerAr', { _id: { $in: linkedCatalogIds } })
    : [];

  const manufacturers = [
    ...new Set([...legacyManufacturers, ...linkedManufacturers].filter(Boolean)),
  ];
  manufacturers.sort((a, b) => a.localeCompare(b));
  return manufacturers;
}

// Section 15 (pharmacist-facing): the same distinct list as above, each entry
// paired with the warehouse's standing manufacturer discount so the
// pharmacy's company cards can show it. Purely a read/serialisation join of
// two values that already exist - the discount map is the very one every
// catalog listing and order already builds (manufacturerDiscount.service.js),
// no price is computed here. A manufacturer with no discount rule reports 0,
// which the card shows as "0%" rather than hiding.
async function listManufacturersWithDiscountsForWarehouse(warehouseId) {
  const [names, discountByName] = await Promise.all([
    listDistinctManufacturersForWarehouse(warehouseId),
    getDiscountMapForWarehouse(warehouseId),
  ]);
  return names.map((manufacturerAr) => ({
    manufacturerAr,
    discountPercentage: discountByName.get(manufacturerAr) ?? 0,
  }));
}

module.exports = {
  listWarehouseProducts,
  listDistinctManufacturersForWarehouse,
  listManufacturersWithDiscountsForWarehouse,
};
