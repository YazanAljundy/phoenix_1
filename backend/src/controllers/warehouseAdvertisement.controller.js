const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const Warehouse = require('../models/warehouse.model');
const service = require('../services/warehouseAdvertisement.service');
const viewModel = require('../viewmodels/warehouseAdvertisement.viewmodel');

async function loadWarehouseOrThrow(userId) {
  const warehouse = await Warehouse.findOne({ userId });
  if (!warehouse) {
    throw ApiError.notFound('Warehouse profile not found.', 'WAREHOUSE_PROFILE_NOT_FOUND');
  }
  return warehouse;
}

const list = asyncHandler(async (req, res) => {
  const warehouse = await loadWarehouseOrThrow(req.user._id);
  const rows = await service.listAdvertisementsForWarehouse(warehouse._id);
  res.json({ success: true, ...viewModel.toAdvertisementListResponse(rows) });
});

const create = asyncHandler(async (req, res) => {
  const warehouse = await loadWarehouseOrThrow(req.user._id);
  const row = await service.createAdvertisement(warehouse._id, req.body);
  res.status(201).json({
    success: true,
    message: 'Advertisement submitted for approval.',
    ...viewModel.toAdvertisementResponse(row),
  });
});

const update = asyncHandler(async (req, res) => {
  const warehouse = await loadWarehouseOrThrow(req.user._id);
  const row = await service.updateAdvertisement(req.params.id, warehouse._id, req.body);
  res.json({
    success: true,
    message: 'Advertisement updated.',
    ...viewModel.toAdvertisementResponse(row),
  });
});

const remove = asyncHandler(async (req, res) => {
  const warehouse = await loadWarehouseOrThrow(req.user._id);
  await service.deleteAdvertisement(req.params.id, warehouse._id);
  res.json({ success: true, message: 'Advertisement deleted.' });
});

module.exports = { list, create, update, remove };
