const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const Warehouse = require('../models/warehouse.model');
const settingsService = require('../services/warehouseSettings.service');
const settingsViewModel = require('../viewmodels/warehouseSettings.viewmodel');

async function loadWarehouseOrThrow(userId) {
  const warehouse = await Warehouse.findOne({ userId });
  if (!warehouse) {
    throw ApiError.notFound('Warehouse profile not found.', 'WAREHOUSE_PROFILE_NOT_FOUND');
  }
  return warehouse;
}

const get = asyncHandler(async (req, res) => {
  const warehouse = await loadWarehouseOrThrow(req.user._id);
  const settings = await settingsService.getSettings(warehouse._id);
  res.json({ success: true, ...settingsViewModel.toWarehouseSettingsResponse(settings) });
});

// Scoped to the caller's OWN warehouse (resolved from the JWT's user, never
// from a body/param id) - a warehouse can't edit another's limits.
const update = asyncHandler(async (req, res) => {
  const warehouse = await loadWarehouseOrThrow(req.user._id);
  const updated = await settingsService.updateOrderLimits(warehouse._id, {
    minOrderAmountUsd: req.body.minOrderAmountUsd,
    maxOrderAmountUsd: req.body.maxOrderAmountUsd,
    requireDeliverySealPhoto: req.body.requireDeliverySealPhoto,
  });
  res.json({
    success: true,
    message: 'Settings updated.',
    ...settingsViewModel.toWarehouseSettingsResponse(updated),
  });
});

module.exports = { get, update };
