const mongoose = require('mongoose');
const { ApiError } = require('../utils/ApiError');
const Product = require('../models/product.model');
const Category = require('../models/category.model');
const ProductCatalog = require('../models/productCatalog.model');
const {
  applyResolvedIdentity,
  loadAndParseUpload,
  escapeRegex,
} = require('./productCatalog.service');
const { registerManufacturers } = require('./warehouseManufacturer.service');

const WAREHOUSE_PRODUCTS_DEFAULT_LIMIT = 20;

// Section 14 Part 2: name/manufacturer no longer come from the warehouse -
// they're resolved from the linked catalog entry (masterProductId),
// validated separately below. Only unit stays a manually-typed field on the
// create form.
const REQUIRED_STRING_FIELDS = [
  ['unitAr', 'INVALID_UNIT'],
  ['unitEn', 'INVALID_UNIT'],
];

// Section 8: isAvailable is never set directly - it's always derived from
// this, recomputed on every create/update.
// TODO(re-enable-stock): was also gated on stockQuantity > 0 - see the TODO
// on product.model.js. Restore that AND-condition when stock tracking returns.
function computeIsAvailable(manuallyDisabled) {
  return !manuallyDisabled;
}

async function validateCategoryId(categoryId) {
  if (typeof categoryId !== 'string' || !mongoose.Types.ObjectId.isValid(categoryId)) {
    throw ApiError.badRequest('Invalid category.', undefined, 'INVALID_CATEGORY');
  }
  const exists = await Category.exists({ _id: categoryId });
  if (!exists) {
    throw ApiError.badRequest('Invalid category.', undefined, 'INVALID_CATEGORY');
  }
}

// Section 14 Part 2: every new product must link to an active central-
// catalog entry - returns it (not just validates) since createProduct needs
// nothing else from it, but importProductsFromExcel below does its own
// lookup by name instead of by id.
async function validateMasterProductId(masterProductId) {
  if (typeof masterProductId !== 'string' || !mongoose.Types.ObjectId.isValid(masterProductId)) {
    throw ApiError.badRequest('Invalid catalog item.', undefined, 'INVALID_MASTER_PRODUCT');
  }
  const catalogItem = await ProductCatalog.findOne({ _id: masterProductId, isActive: true });
  if (!catalogItem) {
    throw ApiError.badRequest('Invalid catalog item.', undefined, 'INVALID_MASTER_PRODUCT');
  }
  return catalogItem;
}

// `price` on the Product doc is USD (Section: USD-first catalog pricing) -
// kept as the Mongoose field name to avoid a schema migration, but every
// request/response boundary spells it out as `priceUsd` so it's never
// mistaken for the old SYP-denominated value. See
// backend/scripts/migrate-prices-to-usd.js for the one-time conversion of
// pre-existing data, and order.service.js for how SYP is derived from this
// at order time.
function validatePrice(priceUsd) {
  if (typeof priceUsd !== 'number' || !Number.isFinite(priceUsd) || priceUsd <= 0) {
    throw ApiError.badRequest('Invalid price.', undefined, 'INVALID_PRICE');
  }
}

function validateRequiredStrings(data) {
  for (const [field, code] of REQUIRED_STRING_FIELDS) {
    if (typeof data[field] !== 'string' || !data[field].trim()) {
      throw ApiError.badRequest(`Invalid ${field}.`, undefined, code);
    }
  }
}

// isActive: true - a product an admin has deactivated (adminProduct.service.js)
// is gone from the warehouse's own catalog too, not just the pharmacist-facing
// one; there's no reactivate flow yet, so from the warehouse's side it's simply
// no longer there.
async function listProductsForWarehouse(warehouseId, { availableOnly = false } = {}) {
  const filter = { warehouseId, isActive: true };
  if (availableOnly) {
    filter.isAvailable = true;
  }
  const products = await Product.find(filter)
    .populate({ path: 'masterProductId', select: 'nameAr nameEn manufacturerAr manufacturerEn' });
  products.forEach(applyResolvedIdentity);
  products.sort((a, b) => (a.nameEn || a.nameAr || '').localeCompare(b.nameEn || b.nameAr || ''));
  return products;
}

// The Products management page (unlike the callers of the unpaginated
// listProductsForWarehouse above - banner/offer "linked product" pickers,
// which need every product, alphabetically) wants newest-first with "Load
// more". An ObjectId's embedded timestamp makes `_id` descending equivalent
// to `createdAt` descending, so no compound cursor is needed.
async function listPaginatedProductsForWarehouse(
  warehouseId,
  { limit = WAREHOUSE_PRODUCTS_DEFAULT_LIMIT, after = null } = {}
) {
  const filter = { warehouseId, isActive: true };
  if (after !== null) {
    filter._id = { $lt: after };
  }

  const rows = await Product.find(filter)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .populate({ path: 'masterProductId', select: 'nameAr nameEn manufacturerAr manufacturerEn' });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  page.forEach(applyResolvedIdentity);
  const nextCursor = page.length > 0 ? String(page[page.length - 1]._id) : null;

  return { rows: page, hasMore, nextCursor };
}

// Section 8/14 Part 2: every field a warehouse can set at creation.
// name/manufacturer are no longer among them - masterProductId (chosen via
// catalog search, see warehouseCatalog.routes.js) is what identifies the
// product now. image stays optional/null for now - no upload provider is
// wired up yet (same as the pharmacist-facing catalog), though a plain URL
// can be pasted in if the warehouse already has one hosted somewhere.
async function createProduct(warehouseId, data) {
  validateRequiredStrings(data);
  await validateMasterProductId(data.masterProductId);
  await validateCategoryId(data.categoryId);
  validatePrice(data.priceUsd);

  const manuallyDisabled = data.manuallyDisabled === true;

  let product;
  try {
    product = await Product.create({
      warehouseId,
      masterProductId: data.masterProductId,
      categoryId: data.categoryId,
      unitAr: data.unitAr.trim(),
      unitEn: data.unitEn.trim(),
      description:
        typeof data.description === 'string' && data.description.trim() ? data.description.trim() : null,
      image: typeof data.image === 'string' && data.image.trim() ? data.image.trim() : null,
      price: data.priceUsd,
      manuallyDisabled,
      isAvailable: computeIsAvailable(manuallyDisabled),
      lastPriceUpdate: new Date(),
    });
  } catch (err) {
    // The (warehouseId, masterProductId) unique index (product.model.js) -
    // a raw Mongo E11000 error would otherwise leak internal index/field
    // names straight to the client.
    if (err.code === 11000) {
      throw ApiError.conflict(
        'You already have a product linked to this medicine.',
        'PRODUCT_ALREADY_LINKED'
      );
    }
    throw err;
  }

  // Resolved strictly *after* create, purely so the response reflects the
  // linked catalog's name - this in-memory-only doc is never saved again
  // within this request, so it can't leak back into storage (see the
  // Section 14 Part 2 note on listAllProducts in adminProduct.service.js).
  await product.populate('masterProductId');
  return applyResolvedIdentity(product);
}

// IDOR guard: scoped to warehouseId, same pattern as every other
// warehouse-owned resource in this codebase.
async function findOwnedProductOrThrow(productId, warehouseId) {
  if (!mongoose.Types.ObjectId.isValid(productId)) {
    throw ApiError.notFound('Product not found.', 'PRODUCT_NOT_FOUND');
  }
  const product = await Product.findOne({ _id: productId, warehouseId, isActive: true });
  if (!product) {
    throw ApiError.notFound('Product not found.', 'PRODUCT_NOT_FOUND');
  }
  return product;
}

// Section 7/13c: every price change is recorded (old/new/who/when) -
// manuallyDisabled changes recompute isAvailable, never written directly.
// All fields are optional here (partial update) but validated if present.
// Shared by the warehouse's own update (below) and the admin's
// (adminProduct.service.js) - only how the target product is found differs
// (owned-by-me vs any product), not what happens to it once found.
async function applyProductUpdate(product, userId, changes) {
  for (const [field, code] of REQUIRED_STRING_FIELDS) {
    if (changes[field] !== undefined) {
      if (typeof changes[field] !== 'string' || !changes[field].trim()) {
        throw ApiError.badRequest(`Invalid ${field}.`, undefined, code);
      }
      product[field] = changes[field].trim();
    }
  }

  if (changes.categoryId !== undefined) {
    await validateCategoryId(changes.categoryId);
    product.categoryId = changes.categoryId;
  }

  if (changes.description !== undefined) {
    product.description = typeof changes.description === 'string' && changes.description.trim()
      ? changes.description.trim()
      : null;
  }

  if (changes.image !== undefined) {
    product.image = typeof changes.image === 'string' && changes.image.trim()
      ? changes.image.trim()
      : null;
  }

  if (changes.priceUsd !== undefined) {
    validatePrice(changes.priceUsd);
    if (changes.priceUsd !== product.price) {
      product.priceHistory.push({
        oldPrice: product.price,
        newPrice: changes.priceUsd,
        changedBy: userId,
        changedAt: new Date(),
      });
      product.price = changes.priceUsd;
      product.lastPriceUpdate = new Date();
    }
  }

  if (changes.manuallyDisabled !== undefined) {
    product.manuallyDisabled = changes.manuallyDisabled === true;
  }

  product.isAvailable = computeIsAvailable(product.manuallyDisabled);

  await product.save();

  // Same "resolve only after the write is durable" reasoning as
  // createProduct above - this response-only mutation never gets saved.
  await product.populate('masterProductId');
  return applyResolvedIdentity(product);
}

async function updateProduct(productId, warehouseId, userId, changes) {
  const product = await findOwnedProductOrThrow(productId, warehouseId);
  return applyProductUpdate(product, userId, changes);
}

// Section 14 Part 2: bulk-adds/updates this warehouse's own products from an
// Excel file shaped like generateWarehouseTemplateBuffer's output. Reuses
// the exact same row-parsing as the admin's catalog import
// (productCatalog.service.js) - the three-column (name / price / currency)
// company-row shape is identical, only what happens with each parsed row
// differs. `candidates` come back already priced in USD (SYP rows converted
// at the current rate; a missing rate has already aborted the whole import
// by this point).
async function importProductsFromExcel(warehouseId, userId, file) {
  const { candidates, errors, manufacturers, exchangeRateUsed, convertedFromSyp } = await loadAndParseUpload(file);

  // Registers every manufacturer row recognized in the file - regardless of
  // whether any of its medicines matched the central catalog, so a
  // warehouse's manufacturer registry (the Discounts tab's dropdown, see
  // warehouseManufacturer.service.js) grows the moment a company appears in
  // an import, not only once one of its products is actually linked.
  if (manufacturers.length > 0) {
    await registerManufacturers(warehouseId, manufacturers);
  }

  let added = 0;
  let updated = 0;

  for (const candidate of candidates) {
    // Matched on both name and manufacturer (not name alone) - the central
    // catalog allows the same drug name under different manufacturers
    // (Section 14 Part 1's own upsert key), so name-only would risk linking
    // to the wrong one.
    const catalogItem = await ProductCatalog.findOne({
      nameAr: new RegExp(`^${escapeRegex(candidate.nameAr)}$`, 'i'),
      manufacturerAr: new RegExp(`^${escapeRegex(candidate.manufacturerAr)}$`, 'i'),
      isActive: true,
    });

    if (!catalogItem) {
      errors.push({ row: candidate.rowNumber, reason: 'Medicine not found in the central catalog.' });
      continue;
    }

    try {
      const existing = await Product.findOne({ warehouseId, masterProductId: catalogItem._id });
      if (existing) {
        if (candidate.priceUsd !== existing.price) {
          existing.priceHistory.push({
            oldPrice: existing.price,
            newPrice: candidate.priceUsd,
            changedBy: userId,
            changedAt: new Date(),
          });
          existing.price = candidate.priceUsd;
          existing.lastPriceUpdate = new Date();
        }
        await existing.save();
        updated += 1;
      } else {
        // categoryId/unitAr/unitEn are left null (Section 14 Part 2's schema
        // note on product.model.js) - the import format carries no columns
        // for them, same reasoning as the catalog's own import.
        await Product.create({
          warehouseId,
          masterProductId: catalogItem._id,
          price: candidate.priceUsd,
          manuallyDisabled: false,
          isAvailable: true,
          lastPriceUpdate: new Date(),
        });
        added += 1;
      }
    } catch (err) {
      errors.push({ row: candidate.rowNumber, reason: 'Failed to save this row.' });
    }
  }

  return { added, updated, errors, exchangeRateUsed, convertedFromSyp };
}

module.exports = {
  listProductsForWarehouse,
  listPaginatedProductsForWarehouse,
  createProduct,
  updateProduct,
  findOwnedProductOrThrow,
  applyProductUpdate,
  importProductsFromExcel,
};
