const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const Warehouse = require('../models/warehouse.model');
const warehouseOrderService = require('../services/warehouseOrder.service');
const warehouseOrderViewModel = require('../viewmodels/warehouseOrder.viewmodel');
const { parseCursorQuery, parseNumericCursor, paginationMeta } = require('../utils/pagination');

const WAREHOUSE_ORDERS_DEFAULT_LIMIT = 20;

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
  const { limit, after } = parseCursorQuery(req.query, WAREHOUSE_ORDERS_DEFAULT_LIMIT);
  const cursor = parseNumericCursor(after);

  const { rows, hasMore, nextCursor } = await warehouseOrderService.listOrdersForWarehouse(
    warehouse._id,
    status,
    { limit, after: cursor }
  );
  res.json({
    success: true,
    ...warehouseOrderViewModel.toWarehouseOrdersResponse(rows),
    pagination: paginationMeta(hasMore, nextCursor),
  });
});

const getDetail = asyncHandler(async (req, res) => {
  const warehouse = await loadWarehouseOrThrow(req.user._id);
  const { order, items, pharmacy, hasReturn } = await warehouseOrderService.getOrderDetailForWarehouse(
    req.params.id,
    warehouse._id
  );
  res.json({
    success: true,
    ...warehouseOrderViewModel.toWarehouseOrderDetailResponse({ order, items, pharmacy, hasReturn }),
  });
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

module.exports = { list, getDetail, advance };
