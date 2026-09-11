const { asyncHandler } = require('../utils/asyncHandler');
const catalogService = require('../services/productCatalog.service');
const catalogViewModel = require('../viewmodels/productCatalog.viewmodel');

const search = asyncHandler(async (req, res) => {
  // `search` (was `q`) - unified with every other text-search endpoint.
  const items = await catalogService.searchActiveForWarehouse(req.query.search);
  res.json({ success: true, ...catalogViewModel.toCatalogListResponse(items) });
});

module.exports = { search };
