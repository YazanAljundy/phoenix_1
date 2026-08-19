const { asyncHandler } = require('../utils/asyncHandler');
const catalogService = require('../services/productCatalog.service');
const catalogViewModel = require('../viewmodels/productCatalog.viewmodel');

const search = asyncHandler(async (req, res) => {
  const items = await catalogService.searchActiveForWarehouse(req.query.q);
  res.json({ success: true, ...catalogViewModel.toCatalogListResponse(items) });
});

module.exports = { search };
