const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const Warehouse = require('../models/warehouse.model');
const warehouseOrderService = require('../services/warehouseOrder.service');
const warehouseOrderViewModel = require('../viewmodels/warehouseOrder.viewmodel');

async function loadWarehouseOrThrow(userId) {
  const warehouse = await Warehouse.findOne({ userId });
  if (!warehouse) {
    throw ApiError.notFound('Warehouse profile not found.', 'WAREHOUSE_PROFILE_NOT_FOUND');
  }
  return warehouse;
}

const list = asyncHandler(async (req, res) => {
  const warehouse = await loadWarehouseOrThrow(req.user._id);
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const rows = await warehouseOrderService.listOrdersForWarehouse(warehouse._id, status);
  res.json({ success: true, ...warehouseOrderViewModel.toWarehouseOrdersResponse(rows) });
});

const advance = asyncHandler(async (req, res) => {
  const warehouse = await loadWarehouseOrThrow(req.user._id);
  const order = await warehouseOrderService.advanceOrderStatus(
    req.params.id,
    warehouse._id,
    req.user._id
  );
  res.json({
    success: true,
    message: 'Order status updated.',
    ...warehouseOrderViewModel.toWarehouseOrderStatusResponse(order),
  });
});

module.exports = { list, advance };
