const mongoose = require('mongoose');
const { ApiError } = require('../utils/ApiError');
const Product = require('../models/product.model');
const Warehouse = require('../models/warehouse.model');
const ProductCatalog = require('../models/productCatalog.model');
const { applyProductUpdate } = require('./warehouseProduct.service');
const { applyResolvedIdentity, escapeRegex } = require('./productCatalog.service');

// Section 13c: the admin's oversight view spans every warehouse - unlike the
// warehouse's own list, this deliberately does NOT filter isActive, so a
// deactivated product still shows up (with a visible status) as a record of
// what was removed, not just active inventory to manage.
//
// Section 14 Part 2: identity resolution only happens here, in a read-only
// listing - never in findAnyProductOrThrow below, whose result goes on to
// `.save()` in updateProduct. Resolving there would silently copy the
// catalog's name back onto the product's own (legacy) fields on every edit,
// exactly the duplication Section 14 says not to do.
async function listAllProducts() {
  const products = await Product.find({}).populate('masterProductId');
  products.forEach(applyResolvedIdentity);
  products.sort((a, b) => (a.nameEn || a.nameAr || '').localeCompare(b.nameEn || b.nameAr || ''));
  if (products.length === 0) return [];

  const warehouseIds = [...new Set(products.map((p) => p.warehouseId.toString()))];
  const warehouses = await Warehouse.find({ _id: { $in: warehouseIds } });
  const warehouseById = new Map(warehouses.map((w) => [w._id.toString(), w]));

  return products.map((product) => ({
    product,
    warehouse: warehouseById.get(product.warehouseId.toString()) ?? null,
  }));
}

const ADMIN_PRODUCTS_DEFAULT_LIMIT = 30;

// The Products management page (unlike listAllProducts above - still used
// as-is by the Dashboard's count and the Banners composer's product picker,
// both needing every product) wants "Load more" plus warehouse/search
// filters sent to the server. Cursor pagination: sorted by `_id` ascending,
// same tradeoff productCatalog.service.js's listCatalog already made for
// its own admin list (a stable, unique cursor field wins over the alphabetical
// sort listAllProducts uses, see that function's comment).
//
// A linked product's real name/manufacturer lives on its catalog entry, not
// on the Product doc itself (Section 14 Part 2) - so `search` can't just
// regex Product's own fields, it also has to catch products linked to a
// catalog entry whose name/manufacturer matches.
async function listPaginatedAllProducts({ search, warehouseId, limit = ADMIN_PRODUCTS_DEFAULT_LIMIT, after = null } = {}) {
  const filter = {};
  if (warehouseId) {
    filter.warehouseId = warehouseId;
  }
  if (search && search.trim()) {
    const pattern = new RegExp(escapeRegex(search.trim()), 'i');
    const matchingCatalogEntries = await ProductCatalog.find(
      { $or: [{ nameAr: pattern }, { nameEn: pattern }, { manufacturerAr: pattern }, { manufacturerEn: pattern }] },
      '_id'
    );
    filter.$or = [
      { nameAr: pattern },
      { nameEn: pattern },
      { manufacturerAr: pattern },
      { manufacturerEn: pattern },
      { masterProductId: { $in: matchingCatalogEntries.map((c) => c._id) } },
    ];
  }
  if (after !== null) {
    filter._id = { $gt: after };
  }

  const products = await Product.find(filter)
    .sort({ _id: 1 })
    .limit(limit + 1)
    .populate('masterProductId');
  const hasMore = products.length > limit;
  const page = hasMore ? products.slice(0, limit) : products;
  page.forEach(applyResolvedIdentity);
  const nextCursor = page.length > 0 ? String(page[page.length - 1]._id) : null;

  if (page.length === 0) return { rows: [], hasMore: false, nextCursor: null };

  const warehouseIds = [...new Set(page.map((p) => p.warehouseId.toString()))];
  const warehouses = await Warehouse.find({ _id: { $in: warehouseIds } });
  const warehouseById = new Map(warehouses.map((w) => [w._id.toString(), w]));

  const rows = page.map((product) => ({
    product,
    warehouse: warehouseById.get(product.warehouseId.toString()) ?? null,
  }));

  return { rows, hasMore, nextCursor };
}

// Distinct warehouses that currently have at least one product - backs the
// management page's warehouse filter dropdown. Fetched independently of the
// paginated rows above (a product's own page won't necessarily include
// every warehouse), and independently of listAllProducts's full fetch too.
async function listWarehousesWithProducts() {
  const warehouseIds = await Product.distinct('warehouseId');
  const warehouses = await Warehouse.find({ _id: { $in: warehouseIds } }).sort({ nameEn: 1 });
  return warehouses.map((w) => ({ id: w._id, nameEn: w.nameEn }));
}

async function findAnyProductOrThrow(productId) {
  if (!mongoose.Types.ObjectId.isValid(productId)) {
    throw ApiError.notFound('Product not found.', 'PRODUCT_NOT_FOUND');
  }
  const product = await Product.findById(productId);
  if (!product) {
    throw ApiError.notFound('Product not found.', 'PRODUCT_NOT_FOUND');
  }
  return product;
}

// Section 13c: admin can edit any warehouse's product - same validation and
// price-history/isAvailable rules as the warehouse's own edit
// (warehouseProduct.service.js), just without the ownership scoping.
async function updateProduct(productId, userId, changes) {
  const product = await findAnyProductOrThrow(productId);
  return applyProductUpdate(product, userId, changes);
}

// Section 13c: admin can deactivate (not hard-delete) any product - the
// pharmacist-facing catalog and the warehouse's own list both already filter
// isActive, so this is immediately invisible on both sides. Idempotent: no
// error if it's already inactive, since there's no meaningful "undo" state
// to protect here (no reactivate flow exists yet).
async function deactivateProduct(productId) {
  const product = await findAnyProductOrThrow(productId);
  product.isActive = false;
  await product.save();
  return product;
}

module.exports = {
  listAllProducts,
  listPaginatedAllProducts,
  listWarehousesWithProducts,
  updateProduct,
  deactivateProduct,
};
