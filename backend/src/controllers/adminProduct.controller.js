const { asyncHandler } = require('../utils/asyncHandler');
const adminProductService = require('../services/adminProduct.service');
const adminProductViewModel = require('../viewmodels/adminProduct.viewmodel');
const { parseCursorQuery, parseObjectIdCursor, paginationMeta } = require('../utils/pagination');

// Two shapes on one endpoint: the Dashboard's count and the Banners
// composer's product picker both call this with no `limit` and need every
// product - only the Products management page opts into pagination, with
// optional warehouseId/search filters sent to the server.
const list = asyncHandler(async (req, res) => {
  if (req.query.limit === undefined) {
    const rows = await adminProductService.listAllProducts();
    res.json({ success: true, ...adminProductViewModel.toAdminProductListResponse(rows) });
    return;
  }

  const { limit, after } = parseCursorQuery(req.query, 30);
  const cursor = parseObjectIdCursor(after);
  const warehouseId = typeof req.query.warehouseId === 'string' ? req.query.warehouseId : undefined;
  const categoryId = typeof req.query.categoryId === 'string' ? req.query.categoryId : undefined;
  const search = typeof req.query.search === 'string' ? req.query.search : undefined;
  const { rows, hasMore, nextCursor } = await adminProductService.listPaginatedAllProducts({
    search,
    warehouseId,
    categoryId,
    limit,
    after: cursor,
  });
  res.json({
    success: true,
    ...adminProductViewModel.toAdminProductListResponse(rows),
    pagination: paginationMeta(hasMore, nextCursor),
  });
});

// Backs the Dashboard's products stat card. Deliberately its own endpoint
// rather than a `total` on the paginated list: the Dashboard doesn't want a
// page of products at all, and a total there would make every page of the
// management page's list pay for a count it never shows.
const count = asyncHandler(async (req, res) => {
  const total = await adminProductService.countAllProducts();
  res.json({ success: true, count: total });
});

// Backs the management page's warehouse filter dropdown - independent of
// pagination, see listWarehousesWithProducts's own comment.
const listWarehouses = asyncHandler(async (req, res) => {
  const warehouses = await adminProductService.listWarehousesWithProducts();
  res.json({ success: true, warehouses });
});

const update = asyncHandler(async (req, res) => {
  const product = await adminProductService.updateProduct(req.params.id, req.user._id, req.body);
  res.json({
    success: true,
    message: 'Product updated.',
    ...adminProductViewModel.toAdminProductResponse(product),
  });
});

const deactivate = asyncHandler(async (req, res) => {
  await adminProductService.deactivateProduct(req.params.id);
  res.json({ success: true, message: 'Product removed.' });
});

module.exports = { list, count, listWarehouses, update, deactivate };
