const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const Warehouse = require('../models/warehouse.model');
const settlementService = require('../services/settlement.service');
const settlementViewModel = require('../viewmodels/settlement.viewmodel');

async function loadWarehouseOrThrow(userId) {
  const warehouse = await Warehouse.findOne({ userId });
  if (!warehouse) {
    throw ApiError.notFound('Warehouse profile not found.', 'WAREHOUSE_PROFILE_NOT_FOUND');
  }
  return warehouse;
}

// Read-only. Scoped to the caller's own warehouse, resolved from the JWT -
// a warehouse can never see another's settlement.
const get = asyncHandler(async (req, res) => {
  const warehouse = await loadWarehouseOrThrow(req.user._id);
  const settlement = await settlementService.getSettlementForWarehouse(warehouse._id, {
    from: req.query.from,
    to: req.query.to,
  });
  res.json({ success: true, ...settlementViewModel.toSettlementResponse(settlement) });
});

module.exports = { get };
