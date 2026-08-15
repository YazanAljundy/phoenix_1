const { asyncHandler } = require('../utils/asyncHandler');
const productService = require('../services/product.service');
const productViewModel = require('../viewmodels/product.viewmodel');

const list = asyncHandler(async (req, res) => {
  const { warehouseId } = req.params;
  const { search, categoryId } = req.query;

  const items = await productService.listWarehouseProducts(warehouseId, { search, categoryId });
  res.json({ success: true, ...productViewModel.toProductListResponse(items) });
});

module.exports = { list };
