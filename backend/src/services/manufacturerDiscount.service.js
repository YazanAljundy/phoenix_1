const mongoose = require('mongoose');
const { ApiError } = require('../utils/ApiError');
const ManufacturerDiscount = require('../models/manufacturerDiscount.model');
const { listManufacturersForWarehouse } = require('./warehouseManufacturer.service');

async function listDiscountsForWarehouse(warehouseId) {
  return ManufacturerDiscount.find({ warehouseId }).sort({ manufacturerAr: 1 });
}

function validatePercentage(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 100) {
    throw ApiError.badRequest(
      'Discount percentage must be between 1 and 100.',
      undefined,
      'INVALID_DISCOUNT_PERCENTAGE'
    );
  }
}

// Section 15 (follow-up): validated against the warehouse's manufacturer
// registry (populated by Excel imports, see warehouseManufacturer.service.js)
// rather than derived live from current products - sticky, so a discount
// stays creatable/editable for a manufacturer even if its products are
// temporarily all removed. Never free text either way.
async function validateManufacturer(warehouseId, manufacturerAr) {
  if (typeof manufacturerAr !== 'string' || !manufacturerAr.trim()) {
    throw ApiError.badRequest('Invalid manufacturer.', undefined, 'INVALID_MANUFACTURER');
  }
  const available = await listManufacturersForWarehouse(warehouseId);
  if (!available.includes(manufacturerAr)) {
    throw ApiError.badRequest(
      'This manufacturer is not in your catalog.',
      undefined,
      'INVALID_MANUFACTURER'
    );
  }
}

async function createDiscount(warehouseId, data) {
  await validateManufacturer(warehouseId, data.manufacturerAr);
  validatePercentage(data.discountPercentage);

  try {
    return await ManufacturerDiscount.create({
      warehouseId,
      manufacturerAr: data.manufacturerAr,
      discountPercentage: data.discountPercentage,
    });
  } catch (err) {
    if (err.code === 11000) {
      throw ApiError.conflict(
        'You already have a discount set for this manufacturer.',
        'DISCOUNT_ALREADY_EXISTS'
      );
    }
    throw err;
  }
}

async function findOwnedDiscountOrThrow(id, warehouseId) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw ApiError.notFound('Discount not found.', 'DISCOUNT_NOT_FOUND');
  }
  const discount = await ManufacturerDiscount.findOne({ _id: id, warehouseId });
  if (!discount) {
    throw ApiError.notFound('Discount not found.', 'DISCOUNT_NOT_FOUND');
  }
  return discount;
}

// Percentage only - the manufacturer a discount applies to isn't editable
// (delete and re-create with a different one instead), matching the
// backend's own "no free text" rule at creation.
async function updateDiscount(id, warehouseId, changes) {
  const discount = await findOwnedDiscountOrThrow(id, warehouseId);
  validatePercentage(changes.discountPercentage);
  discount.discountPercentage = changes.discountPercentage;
  await discount.save();
  return discount;
}

async function deleteDiscount(id, warehouseId) {
  const discount = await findOwnedDiscountOrThrow(id, warehouseId);
  await discount.deleteOne();
}

// Section 15: Map<manufacturerAr, discountPercentage> for this warehouse -
// fetched once and reused across every product in a catalog listing or
// order, rather than one query per product.
async function getDiscountMapForWarehouse(warehouseId) {
  const discounts = await ManufacturerDiscount.find({ warehouseId });
  return new Map(discounts.map((d) => [d.manufacturerAr, d.discountPercentage]));
}

// Section 15: stacks with an active product-level Offer (project owner's
// decision) - the Offer's percentage is applied first, then the
// manufacturer's, both against the same base price. Multiplicative
// percentage discounts commute, so "which one first" doesn't change the
// result; this order just matches how the two are usually reasoned about
// (product-specific promotion, then a standing catalog-wide rule).
function computeDiscountedPriceUsd(priceUsd, offerDiscountPercentage, manufacturerDiscountPercentage) {
  let price = priceUsd;
  if (offerDiscountPercentage) {
    price *= 1 - offerDiscountPercentage / 100;
  }
  if (manufacturerDiscountPercentage) {
    price *= 1 - manufacturerDiscountPercentage / 100;
  }
  return Math.round(price * 100) / 100;
}

module.exports = {
  listDiscountsForWarehouse,
  createDiscount,
  updateDiscount,
  deleteDiscount,
  getDiscountMapForWarehouse,
  computeDiscountedPriceUsd,
};
