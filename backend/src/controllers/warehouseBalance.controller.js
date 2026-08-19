const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const Warehouse = require('../models/warehouse.model');
const balanceService = require('../services/pharmacyBalance.service');
const balanceViewModel = require('../viewmodels/pharmacyBalance.viewmodel');

async function loadWarehouseOrThrow(userId) {
  const warehouse = await Warehouse.findOne({ userId });
  if (!warehouse) {
    throw ApiError.notFound('Warehouse profile not found.', 'WAREHOUSE_PROFILE_NOT_FOUND');
  }
  return warehouse;
}

const list = asyncHandler(async (req, res) => {
  const warehouse = await loadWarehouseOrThrow(req.user._id);
  const rows = await balanceService.listDebtorsForWarehouse(warehouse._id);
  res.json({ success: true, ...balanceViewModel.toDebtorListResponse(rows) });
});

const getOne = asyncHandler(async (req, res) => {
  const warehouse = await loadWarehouseOrThrow(req.user._id);
  const detail = await balanceService.getBalanceDetail(req.params.pharmacyId, warehouse._id);
  res.json({ success: true, ...balanceViewModel.toBalanceDetailResponse(detail, 'warehouse') });
});

module.exports = { list, getOne };
