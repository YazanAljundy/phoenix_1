const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const Warehouse = require('../models/warehouse.model');
const warehouseReviewService = require('../services/warehouseReview.service');
const warehouseReviewViewModel = require('../viewmodels/warehouseReview.viewmodel');

async function loadWarehouseOrThrow(userId) {
  const warehouse = await Warehouse.findOne({ userId });
  if (!warehouse) {
    throw ApiError.notFound('Warehouse profile not found.', 'WAREHOUSE_PROFILE_NOT_FOUND');
  }
  return warehouse;
}

const list = asyncHandler(async (req, res) => {
  const warehouse = await loadWarehouseOrThrow(req.user._id);
  const result = await warehouseReviewService.listReviewsForWarehouse(warehouse._id);
  res.json({ success: true, ...warehouseReviewViewModel.toWarehouseReviewsResponse(result) });
});

const create = asyncHandler(async (req, res) => {
  const warehouse = await loadWarehouseOrThrow(req.user._id);
  const review = await warehouseReviewService.createPharmacyReview(warehouse._id, req.user._id, req.body);
  res.status(201).json({
    success: true,
    message: 'Rating submitted.',
    ...warehouseReviewViewModel.toCreatedReviewResponse(review),
  });
});

module.exports = { list, create };
