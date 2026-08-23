const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const Warehouse = require('../models/warehouse.model');
const warehouseReturnService = require('../services/warehouseReturn.service');
const warehouseReturnViewModel = require('../viewmodels/warehouseReturn.viewmodel');
const { parseCursorQuery, parseObjectIdCursor, paginationMeta } = require('../utils/pagination');

async function loadWarehouseOrThrow(userId) {
  const warehouse = await Warehouse.findOne({ userId });
  if (!warehouse) {
    throw ApiError.notFound('Warehouse profile not found.', 'WAREHOUSE_PROFILE_NOT_FOUND');
  }
  return warehouse;
}

// Two shapes on one endpoint: WarehouseOrderDetailPage's "does this order
// already have a pending return" lookup calls this with no `limit` and
// needs the full list - only the Returns management page opts into
// pagination by sending `limit`/`after`, which is when `pagination` appears.
const list = asyncHandler(async (req, res) => {
  const warehouse = await loadWarehouseOrThrow(req.user._id);
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;

  if (req.query.limit === undefined) {
    const rows = await warehouseReturnService.listReturnsForWarehouse(warehouse._id, status);
    res.json({ success: true, ...warehouseReturnViewModel.toWarehouseReturnsResponse(rows) });
    return;
  }

  const { limit, after } = parseCursorQuery(req.query, 15);
  const cursor = parseObjectIdCursor(after);
  const { rows, hasMore, nextCursor } = await warehouseReturnService.listPaginatedReturnsForWarehouse(
    warehouse._id,
    status,
    { limit, after: cursor }
  );
  res.json({
    success: true,
    ...warehouseReturnViewModel.toWarehouseReturnsResponse(rows),
    pagination: paginationMeta(hasMore, nextCursor),
  });
});

const getDetail = asyncHandler(async (req, res) => {
  const warehouse = await loadWarehouseOrThrow(req.user._id);
  const data = await warehouseReturnService.getReturnDetailForWarehouse(req.params.id, warehouse._id);
  res.json({ success: true, ...warehouseReturnViewModel.toWarehouseReturnDetailResponse(data) });
});

const approve = asyncHandler(async (req, res) => {
  const warehouse = await loadWarehouseOrThrow(req.user._id);
  const { returnRequest, replacementOrder } = await warehouseReturnService.approveReturn(
    req.params.id,
    warehouse._id,
    req.user._id
  );
  res.json({
    success: true,
    message: 'Return approved. A replacement order has been created.',
    ...warehouseReturnViewModel.toResolvedReturnResponse(returnRequest, replacementOrder),
  });
});

const reject = asyncHandler(async (req, res) => {
  const warehouse = await loadWarehouseOrThrow(req.user._id);
  const returnRequest = await warehouseReturnService.rejectReturn(
    req.params.id,
    warehouse._id,
    req.user._id,
    req.body.rejectionNote
  );
  res.json({
    success: true,
    message: 'Return rejected.',
    ...warehouseReturnViewModel.toResolvedReturnResponse(returnRequest),
  });
});

module.exports = { list, getDetail, approve, reject };
