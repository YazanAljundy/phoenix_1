const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const Warehouse = require('../models/warehouse.model');
const warehouseOfferService = require('../services/warehouseOffer.service');
const warehouseOfferViewModel = require('../viewmodels/warehouseOffer.viewmodel');
const { parseCursorQuery, parseObjectIdCursor, paginationMeta } = require('../utils/pagination');

async function loadWarehouseOrThrow(userId) {
  const warehouse = await Warehouse.findOne({ userId });
  if (!warehouse) {
    throw ApiError.notFound('Warehouse profile not found.', 'WAREHOUSE_PROFILE_NOT_FOUND');
  }
  return warehouse;
}

// Filtered (status pill / search / discount range) and always cursor-
// paginated - `limit` always gets a default (parseCursorQuery), never
// unbounded.
const list = asyncHandler(async (req, res) => {
  const warehouse = await loadWarehouseOrThrow(req.user._id);
  const { limit, after } = parseCursorQuery(req.query, 20);
  const cursor = parseObjectIdCursor(after);
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const search = typeof req.query.search === 'string' ? req.query.search : undefined;
  const minDiscount = typeof req.query.minDiscount === 'string' ? req.query.minDiscount : undefined;
  const maxDiscount = typeof req.query.maxDiscount === 'string' ? req.query.maxDiscount : undefined;

  const { rows, hasMore, nextCursor, reviewCount } = await warehouseOfferService.listPaginatedOffersForWarehouse(
    warehouse._id,
    { status, search, minDiscount, maxDiscount, limit, after: cursor }
  );
  res.json({
    success: true,
    ...warehouseOfferViewModel.toOfferListResponse(rows),
    pagination: paginationMeta(hasMore, nextCursor),
    reviewCount,
  });
});

const create = asyncHandler(async (req, res) => {
  const warehouse = await loadWarehouseOrThrow(req.user._id);
  const { offer, product } = await warehouseOfferService.createOffer(warehouse._id, req.body);
  res.status(201).json({
    success: true,
    message: 'Offer submitted for approval.',
    ...warehouseOfferViewModel.toOfferResponse(offer, product),
  });
});

// A still-pending offer is edited in place; an approved offer's edit is parked
// for admin review (warehouseOffer.service.updateOffer) - either way the page
// reloads the list afterwards, so only a status message is returned here.
const update = asyncHandler(async (req, res) => {
  const warehouse = await loadWarehouseOrThrow(req.user._id);
  await warehouseOfferService.updateOffer(req.params.id, warehouse._id, req.body);
  res.json({ success: true, message: 'Offer update submitted.' });
});

const remove = asyncHandler(async (req, res) => {
  const warehouse = await loadWarehouseOrThrow(req.user._id);
  await warehouseOfferService.deleteOffer(req.params.id, warehouse._id);
  res.json({ success: true, message: 'Offer deleted.' });
});

module.exports = { list, create, update, remove };
