const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const Warehouse = require('../models/warehouse.model');
const warehouseComplaintService = require('../services/warehouseComplaint.service');
const complaintViewModel = require('../viewmodels/complaint.viewmodel');
const { parseCursorQuery, parseObjectIdCursor, paginationMeta } = require('../utils/pagination');

const COMPLAINTS_DEFAULT_LIMIT = 15;

async function loadWarehouseOrThrow(userId) {
  const warehouse = await Warehouse.findOne({ userId }).select('_id').lean();
  if (!warehouse) {
    throw ApiError.notFound('Warehouse profile not found.', 'WAREHOUSE_PROFILE_NOT_FOUND');
  }
  return warehouse;
}

const list = asyncHandler(async (req, res) => {
  const warehouse = await loadWarehouseOrThrow(req.user._id);
  const { limit, after } = parseCursorQuery(req.query, COMPLAINTS_DEFAULT_LIMIT);
  const cursor = parseObjectIdCursor(after);

  const { rows, hasMore, nextCursor } = await warehouseComplaintService.listComplaintsForWarehouse(
    warehouse._id,
    { limit, after: cursor }
  );
  res.json({
    success: true,
    ...complaintViewModel.toWarehouseComplaintListResponse(rows),
    pagination: paginationMeta(hasMore, nextCursor),
  });
});

const getOne = asyncHandler(async (req, res) => {
  const warehouse = await loadWarehouseOrThrow(req.user._id);
  const row = await warehouseComplaintService.getComplaintForWarehouse(req.params.id, warehouse._id);
  res.json({
    success: true,
    ...complaintViewModel.toWarehouseComplaintResponse(row),
  });
});

module.exports = { list, getOne };
