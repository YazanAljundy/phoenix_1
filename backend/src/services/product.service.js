const mongoose = require('mongoose');
const { ApiError } = require('../utils/ApiError');
const Product = require('../models/product.model');
const Offer = require('../models/offer.model');
const { isWarehouseAvailable } = require('./warehouse.service');
const { applyResolvedIdentity, escapeRegex } = require('./productCatalog.service');
const { getDiscountMapForWarehouse } = require('./manufacturerDiscount.service');

// Section 6.5: search by name and manufacturer, filterable by category.
// Section 7: an active, admin-approved offer on a product shows two prices
// (original struck-through + discounted) - merged in here per product.
// Section 14 Part 2: name/manufacturer search runs in memory, after
// resolving each product's identity (populated masterProductId or its own
// legacy fields) - a catalog-linked product no longer carries its own copy
// of these fields for Mongo to match against directly.
async function listWarehouseProducts(warehouseId, { search, categoryId, manufacturer } = {}) {
  const available = await isWarehouseAvailable(warehouseId);
  if (!available) {
    throw ApiError.notFound('Warehouse not found.');
  }

  const filter = { warehouseId, isActive: true };

  if (categoryId) {
    if (!mongoose.Types.ObjectId.isValid(categoryId)) {
      throw ApiError.badRequest('Invalid category id.');
    }
    filter.categoryId = categoryId;
  }

  let products = await Product.find(filter).populate('masterProductId');
  products.forEach(applyResolvedIdentity);

  // Manufacturers browsing flow: a warehouse's catalog is now reached via
  // its manufacturers list (see listDistinctManufacturersForWarehouse
  // below) - this narrows to that one manufacturer's medicines. Matched
  // in-memory against the resolved identity, same reasoning as `search`
  // just below (a catalog-linked product's manufacturerAr isn't on its own
  // Mongo document until resolved).
  if (manufacturer) {
    products = products.filter((p) => p.manufacturerAr === manufacturer);
  }

  if (search && search.trim()) {
    const pattern = new RegExp(escapeRegex(search.trim()), 'i');
    products = products.filter(
      (p) =>
        pattern.test(p.nameAr || '') ||
        pattern.test(p.nameEn || '') ||
        pattern.test(p.manufacturerAr || '') ||
        pattern.test(p.manufacturerEn || '')
    );
  }

  products.sort((a, b) => (a.nameEn || a.nameAr || '').localeCompare(b.nameEn || b.nameAr || ''));

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
  return products.map((product) => ({
    product,
    offer: offerByProductId.get(product._id.toString()) ?? null,
    manufacturerDiscountPercentage: manufacturerDiscountByName.get(product.manufacturerAr) ?? null,
  }));
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
