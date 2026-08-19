const { asyncHandler } = require('../utils/asyncHandler');
const productService = require('../services/product.service');
const productViewModel = require('../viewmodels/product.viewmodel');

const list = asyncHandler(async (req, res) => {
  const { warehouseId } = req.params;
  const { search, categoryId, manufacturer } = req.query;

  const items = await productService.listWarehouseProducts(warehouseId, { search, categoryId, manufacturer });
  res.json({ success: true, ...productViewModel.toProductListResponse(items) });
});

const manufacturers = asyncHandler(async (req, res) => {
  const { warehouseId } = req.params;
  const items = await productService.listDistinctManufacturersForWarehouse(warehouseId);
  res.json({ success: true, manufacturers: items });
});

module.exports = { list, manufacturers };
