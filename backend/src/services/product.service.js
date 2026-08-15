const mongoose = require('mongoose');
const { ApiError } = require('../utils/ApiError');
const Product = require('../models/product.model');
const Offer = require('../models/offer.model');
const { isWarehouseAvailable } = require('./warehouse.service');

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Section 6.5: search by name and manufacturer, filterable by category.
// Section 7: an active, admin-approved offer on a product shows two prices
// (original struck-through + discounted) - merged in here per product.
async function listWarehouseProducts(warehouseId, { search, categoryId } = {}) {
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

  if (search && search.trim()) {
    const pattern = new RegExp(escapeRegex(search.trim()), 'i');
    filter.$or = [
      { nameAr: pattern },
      { nameEn: pattern },
      { manufacturerAr: pattern },
      { manufacturerEn: pattern },
    ];
  }

  const products = await Product.find(filter).sort({ nameEn: 1 });

  const now = new Date();
  const offers = await Offer.find({
    warehouseId,
    status: 'approved',
    startDate: { $lte: now },
    endDate: { $gte: now },
    productId: { $in: products.map((p) => p._id) },
  });
  const offerByProductId = new Map(offers.map((o) => [o.productId.toString(), o]));

  return products.map((product) => ({
    product,
    offer: offerByProductId.get(product._id.toString()) ?? null,
  }));
}

module.exports = { listWarehouseProducts };
