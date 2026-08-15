const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const Warehouse = require('../models/warehouse.model');
const warehouseOfferService = require('../services/warehouseOffer.service');
const warehouseOfferViewModel = require('../viewmodels/warehouseOffer.viewmodel');

async function loadWarehouseOrThrow(userId) {
  const warehouse = await Warehouse.findOne({ userId });
  if (!warehouse) {
    throw ApiError.notFound('Warehouse profile not found.', 'WAREHOUSE_PROFILE_NOT_FOUND');
  }
  return warehouse;
}

const list = asyncHandler(async (req, res) => {
  const warehouse = await loadWarehouseOrThrow(req.user._id);
  const rows = await warehouseOfferService.listOffersForWarehouse(warehouse._id);
  res.json({ success: true, ...warehouseOfferViewModel.toOfferListResponse(rows) });
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

module.exports = { list, create };
