const mongoose = require('mongoose');
const { ApiError } = require('../utils/ApiError');
const Product = require('../models/product.model');
const Category = require('../models/category.model');

const REQUIRED_STRING_FIELDS = [
  ['nameAr', 'INVALID_PRODUCT_NAME'],
  ['nameEn', 'INVALID_PRODUCT_NAME'],
  ['manufacturerAr', 'INVALID_MANUFACTURER'],
  ['manufacturerEn', 'INVALID_MANUFACTURER'],
  ['unitAr', 'INVALID_UNIT'],
  ['unitEn', 'INVALID_UNIT'],
];

// Section 8: isAvailable is never set directly - it's always derived from
// these two, recomputed on every create/update (Section 7: an item is
// orderable only when it both has stock AND hasn't been manually paused).
function computeIsAvailable(manuallyDisabled, stockQuantity) {
  return !manuallyDisabled && stockQuantity > 0;
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

function validatePrice(price) {
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
    throw ApiError.badRequest('Invalid price.', undefined, 'INVALID_PRICE');
  }
}

function validateStockQuantity(stockQuantity) {
  if (!Number.isInteger(stockQuantity) || stockQuantity < 0) {
    throw ApiError.badRequest('Invalid stock quantity.', undefined, 'INVALID_STOCK_QUANTITY');
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
async function listProductsForWarehouse(warehouseId) {
  return Product.find({ warehouseId, isActive: true }).sort({ nameEn: 1 });
}

// Section 8: every field a warehouse can set at creation. image stays
// optional/null for now - no upload provider is wired up yet (same as the
// pharmacist-facing catalog), though a plain URL can be pasted in if the
// warehouse already has one hosted somewhere.
async function createProduct(warehouseId, data) {
  validateRequiredStrings(data);
  await validateCategoryId(data.categoryId);
  validatePrice(data.price);
  validateStockQuantity(data.stockQuantity);

  const manuallyDisabled = data.manuallyDisabled === true;

  return Product.create({
    warehouseId,
    categoryId: data.categoryId,
    nameAr: data.nameAr.trim(),
    nameEn: data.nameEn.trim(),
    manufacturerAr: data.manufacturerAr.trim(),
    manufacturerEn: data.manufacturerEn.trim(),
    unitAr: data.unitAr.trim(),
    unitEn: data.unitEn.trim(),
    description: typeof data.description === 'string' && data.description.trim() ? data.description.trim() : null,
    image: typeof data.image === 'string' && data.image.trim() ? data.image.trim() : null,
    price: data.price,
    stockQuantity: data.stockQuantity,
    manuallyDisabled,
    isAvailable: computeIsAvailable(manuallyDisabled, data.stockQuantity),
    lastPriceUpdate: new Date(),
  });
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

// Section 7/13c: every price change is recorded (old/new/who/when) - stock
// and manuallyDisabled changes recompute isAvailable, never written
// directly. All fields are optional here (partial update) but validated if
// present. Shared by the warehouse's own update (below) and the admin's
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

  if (changes.price !== undefined) {
    validatePrice(changes.price);
    if (changes.price !== product.price) {
      product.priceHistory.push({
        oldPrice: product.price,
        newPrice: changes.price,
        changedBy: userId,
        changedAt: new Date(),
      });
      product.price = changes.price;
      product.lastPriceUpdate = new Date();
    }
  }

  if (changes.stockQuantity !== undefined) {
    validateStockQuantity(changes.stockQuantity);
    product.stockQuantity = changes.stockQuantity;
  }

  if (changes.manuallyDisabled !== undefined) {
    product.manuallyDisabled = changes.manuallyDisabled === true;
  }

  product.isAvailable = computeIsAvailable(product.manuallyDisabled, product.stockQuantity);

  await product.save();
  return product;
}

async function updateProduct(productId, warehouseId, userId, changes) {
  const product = await findOwnedProductOrThrow(productId, warehouseId);
  return applyProductUpdate(product, userId, changes);
}

module.exports = {
  listProductsForWarehouse,
  createProduct,
  updateProduct,
  findOwnedProductOrThrow,
  applyProductUpdate,
};
