const { asyncHandler } = require('../utils/asyncHandler');
const productService = require('../services/product.service');
const productViewModel = require('../viewmodels/product.viewmodel');
const { parseCursorQuery, parseObjectIdCursor, paginationMeta } = require('../utils/pagination');

const PRODUCTS_DEFAULT_LIMIT = 20;

const list = asyncHandler(async (req, res) => {
  const { warehouseId } = req.params;
  const { search, categoryId, manufacturer } = req.query;
  const { limit, after } = parseCursorQuery(req.query, PRODUCTS_DEFAULT_LIMIT);
  const cursor = parseObjectIdCursor(after);

  const { items, hasMore, nextCursor } = await productService.listWarehouseProducts(warehouseId, {
    search,
    categoryId,
    manufacturer,
    limit,
    after: cursor,
  });
  res.json({
    success: true,
    ...productViewModel.toProductListResponse(items),
    pagination: paginationMeta(hasMore, nextCursor),
  });
});

const manufacturers = asyncHandler(async (req, res) => {
  const { warehouseId } = req.params;
  const items = await productService.listManufacturersWithDiscountsForWarehouse(warehouseId);
  res.json({ success: true, manufacturers: items });
});

module.exports = { list, manufacturers };
