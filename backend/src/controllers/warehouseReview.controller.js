const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const Warehouse = require('../models/warehouse.model');
const warehouseReviewService = require('../services/warehouseReview.service');
const warehouseReviewViewModel = require('../viewmodels/warehouseReview.viewmodel');
const { parseCursorQuery, parseObjectIdCursor, paginationMeta } = require('../utils/pagination');

async function loadWarehouseOrThrow(userId) {
  const warehouse = await Warehouse.findOne({ userId });
  if (!warehouse) {
    throw ApiError.notFound('Warehouse profile not found.', 'WAREHOUSE_PROFILE_NOT_FOUND');
  }
  return warehouse;
}

// This route only ever backs the Reviews management page, so it's always
// paginated - unlike Products/Returns, there's no other frontend caller
// here needing the full unpaginated list (getWarehouseProfile, the Flutter
// app's own consumer of listReviewsForWarehouse, is a separate service call
// on a separate route, not this one).
const list = asyncHandler(async (req, res) => {
  const warehouse = await loadWarehouseOrThrow(req.user._id);
  const { limit, after } = parseCursorQuery(req.query, 15);
  const cursor = parseObjectIdCursor(after);
  const { rows, hasMore, nextCursor, averageRating, totalCount, distribution } =
    await warehouseReviewService.listPaginatedReviewsForWarehouse(warehouse._id, { limit, after: cursor });
  res.json({
    success: true,
    ...warehouseReviewViewModel.toWarehouseReviewsResponse({ reviews: rows, averageRating }),
    pagination: paginationMeta(hasMore, nextCursor),
    totalCount,
    distribution,
  });
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
