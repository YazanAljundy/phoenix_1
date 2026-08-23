const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const Warehouse = require('../models/warehouse.model');
const balanceService = require('../services/pharmacyBalance.service');
const balanceViewModel = require('../viewmodels/pharmacyBalance.viewmodel');
const { parseCursorQuery, paginationMeta } = require('../utils/pagination');
const mongoose = require('mongoose');

async function loadWarehouseOrThrow(userId) {
  const warehouse = await Warehouse.findOne({ userId });
  if (!warehouse) {
    throw ApiError.notFound('Warehouse profile not found.', 'WAREHOUSE_PROFILE_NOT_FOUND');
  }
  return warehouse;
}

// The cursor here is a JSON-encoded { balanceUsd, id } pair (see
// listPaginatedDebtorsForWarehouse's comment on why balanceUsd alone isn't a
// safe cursor field), so it needs its own parsing rather than the shared
// parseObjectIdCursor/parseNumericCursor helpers.
function parseDebtorCursor(after) {
  if (after === null) return null;
  let parsed;
  try {
    parsed = JSON.parse(after);
  } catch {
    throw ApiError.badRequest('Invalid cursor.', undefined, 'INVALID_CURSOR');
  }
  if (
    !parsed ||
    typeof parsed.balanceUsd !== 'number' ||
    typeof parsed.id !== 'string' ||
    !mongoose.Types.ObjectId.isValid(parsed.id)
  ) {
    throw ApiError.badRequest('Invalid cursor.', undefined, 'INVALID_CURSOR');
  }
  return parsed;
}

const list = asyncHandler(async (req, res) => {
  const warehouse = await loadWarehouseOrThrow(req.user._id);
  const { limit, after } = parseCursorQuery(req.query, 20);
  const cursor = parseDebtorCursor(after);
  const { rows, hasMore, nextCursor } = await balanceService.listPaginatedDebtorsForWarehouse(warehouse._id, {
    limit,
    after: cursor,
  });
  res.json({
    success: true,
    ...balanceViewModel.toDebtorListResponse(rows),
    pagination: paginationMeta(hasMore, nextCursor),
  });
});

const getOne = asyncHandler(async (req, res) => {
  const warehouse = await loadWarehouseOrThrow(req.user._id);
  const detail = await balanceService.getBalanceDetail(req.params.pharmacyId, warehouse._id);
  res.json({ success: true, ...balanceViewModel.toBalanceDetailResponse(detail, 'warehouse') });
});

module.exports = { list, getOne };
