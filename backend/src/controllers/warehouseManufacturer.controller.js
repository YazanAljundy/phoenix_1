const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const Warehouse = require('../models/warehouse.model');
const warehouseManufacturerService = require('../services/warehouseManufacturer.service');

async function loadWarehouseOrThrow(userId) {
  const warehouse = await Warehouse.findOne({ userId });
  if (!warehouse) {
    throw ApiError.notFound('Warehouse profile not found.', 'WAREHOUSE_PROFILE_NOT_FOUND');
  }
  return warehouse;
}

// Two shapes on one endpoint, the same opt-in arrangement warehouseProduct's
// `list` uses for pagination. By default: the import registry, as a plain
// array of names - what the Discounts tab's dropdown has always read.
// With `?inCatalog=true`: only the companies this warehouse's catalog actually
// holds, each as { manufacturerAr, productCount } - what the catalog page's
// company list needs. See listCatalogManufacturersForWarehouse for why
// browsing cannot use the registry.
const list = asyncHandler(async (req, res) => {
  const warehouse = await loadWarehouseOrThrow(req.user._id);
  const manufacturers =
    req.query.inCatalog === 'true'
      ? await warehouseManufacturerService.listCatalogManufacturersForWarehouse(warehouse._id)
      : await warehouseManufacturerService.listManufacturersForWarehouse(warehouse._id);
  res.json({ success: true, manufacturers });
});

module.exports = { list };
