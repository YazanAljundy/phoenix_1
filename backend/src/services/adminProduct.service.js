const mongoose = require('mongoose');
const { ApiError } = require('../utils/ApiError');
const Product = require('../models/product.model');
const Warehouse = require('../models/warehouse.model');
const { applyProductUpdate } = require('./warehouseProduct.service');

// Section 13c: the admin's oversight view spans every warehouse - unlike the
// warehouse's own list, this deliberately does NOT filter isActive, so a
// deactivated product still shows up (with a visible status) as a record of
// what was removed, not just active inventory to manage.
async function listAllProducts() {
  const products = await Product.find({}).sort({ nameEn: 1 });
  if (products.length === 0) return [];

  const warehouseIds = [...new Set(products.map((p) => p.warehouseId.toString()))];
  const warehouses = await Warehouse.find({ _id: { $in: warehouseIds } });
  const warehouseById = new Map(warehouses.map((w) => [w._id.toString(), w]));

  return products.map((product) => ({
    product,
    warehouse: warehouseById.get(product.warehouseId.toString()) ?? null,
  }));
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

module.exports = { listAllProducts, updateProduct, deactivateProduct };
