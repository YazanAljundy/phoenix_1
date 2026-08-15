const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const Warehouse = require('../models/warehouse.model');
const warehouseReturnService = require('../services/warehouseReturn.service');
const warehouseReturnViewModel = require('../viewmodels/warehouseReturn.viewmodel');

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
  const rows = await warehouseReturnService.listReturnsForWarehouse(warehouse._id, status);
  res.json({ success: true, ...warehouseReturnViewModel.toWarehouseReturnsResponse(rows) });
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

module.exports = { list, approve, reject };
