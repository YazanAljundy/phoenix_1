const mongoose = require('mongoose');
const { ApiError } = require('../utils/ApiError');
const Product = require('../models/product.model');
const Offer = require('../models/offer.model');
const { isWarehouseAvailable } = require('./warehouse.service');
const { applyResolvedIdentity, escapeRegex } = require('./productCatalog.service');
const { getDiscountMapForWarehouse } = require('./manufacturerDiscount.service');

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

    const batch = await Product.find(filter)
      .sort({ _id: 1 })
      .limit(batchSize)
      .populate('masterProductId');
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
    products = await Product.find(baseFilter).populate('masterProductId');
    products.forEach(applyResolvedIdentity);

    if (manufacturer) {
      products = products.filter((p) => p.manufacturerAr === manufacturer);
    }

    const pattern = new RegExp(escapeRegex(search.trim()), 'i');
    products = products.filter(
      (p) =>
        pattern.test(p.nameAr || '') ||
        pattern.test(p.nameEn || '') ||
        pattern.test(p.manufacturerAr || '') ||
        pattern.test(p.manufacturerEn || '')
    );
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
      endDate: { $gte: now },
      productId: { $in: products.map((p) => p._id) },
    }),
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

  const products = await Product.find({ warehouseId, isActive: true }).populate('masterProductId');
  products.forEach(applyResolvedIdentity);

  const manufacturers = [...new Set(products.map((p) => p.manufacturerAr).filter(Boolean))];
  manufacturers.sort((a, b) => a.localeCompare(b));
  return manufacturers;
}

module.exports = { listWarehouseProducts, listDistinctManufacturersForWarehouse };
