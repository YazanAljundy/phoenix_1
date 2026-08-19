const { asyncHandler } = require('../utils/asyncHandler');
const warehouseService = require('../services/warehouse.service');
const warehouseViewModel = require('../viewmodels/warehouse.viewmodel');

const list = asyncHandler(async (req, res) => {
  const warehouses = await warehouseService.listAvailableWarehouses();
  res.json({ success: true, ...warehouseViewModel.toWarehouseListResponse(warehouses) });
});

const profile = asyncHandler(async (req, res) => {
  const data = await warehouseService.getWarehouseProfile(req.params.warehouseId);
  res.json({ success: true, ...warehouseViewModel.toWarehouseProfileResponse(data) });
});

module.exports = { list, profile };
