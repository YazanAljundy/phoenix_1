const { asyncHandler } = require('../utils/asyncHandler');
const warehouseService = require('../services/warehouse.service');
const warehouseViewModel = require('../viewmodels/warehouse.viewmodel');

const list = asyncHandler(async (req, res) => {
  const warehouses = await warehouseService.listAvailableWarehouses();
  res.json({ success: true, ...warehouseViewModel.toWarehouseListResponse(warehouses) });
});

module.exports = { list };
