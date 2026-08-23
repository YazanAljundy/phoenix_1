const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const Warehouse = require('../models/warehouse.model');
const warehouseProductService = require('../services/warehouseProduct.service');
const warehouseProductViewModel = require('../viewmodels/warehouseProduct.viewmodel');
const productCatalogService = require('../services/productCatalog.service');
const { parseCursorQuery, parseObjectIdCursor, paginationMeta } = require('../utils/pagination');

async function loadWarehouseOrThrow(userId) {
  const warehouse = await Warehouse.findOne({ userId });
  if (!warehouse) {
    throw ApiError.notFound('Warehouse profile not found.', 'WAREHOUSE_PROFILE_NOT_FOUND');
  }
  return warehouse;
}

// Two shapes on one endpoint: the banner/offer "linked product" pickers call
// this with no `limit` at all and need the full, alphabetical list (see
// listProductsForWarehouse) - only the Products management page opts into
// pagination by actually sending `limit`/`after`, which is when the
// `pagination` key appears on the response.
const list = asyncHandler(async (req, res) => {
  const warehouse = await loadWarehouseOrThrow(req.user._id);

  if (req.query.limit === undefined) {
    const products = await warehouseProductService.listProductsForWarehouse(warehouse._id);
    res.json({ success: true, ...warehouseProductViewModel.toProductListResponse(products) });
    return;
  }

  const { limit, after } = parseCursorQuery(req.query, 20);
  const cursor = parseObjectIdCursor(after);
  const { rows, hasMore, nextCursor } = await warehouseProductService.listPaginatedProductsForWarehouse(
    warehouse._id,
    { limit, after: cursor }
  );
  res.json({
    success: true,
    ...warehouseProductViewModel.toProductListResponse(rows),
    pagination: paginationMeta(hasMore, nextCursor),
  });
});

const create = asyncHandler(async (req, res) => {
  const warehouse = await loadWarehouseOrThrow(req.user._id);
  const product = await warehouseProductService.createProduct(warehouse._id, req.body);
  res.status(201).json({
    success: true,
    message: 'Product created.',
    ...warehouseProductViewModel.toProductResponse(product),
  });
});

const update = asyncHandler(async (req, res) => {
  const warehouse = await loadWarehouseOrThrow(req.user._id);
  const product = await warehouseProductService.updateProduct(
    req.params.id,
    warehouse._id,
    req.user._id,
    req.body
  );
  res.json({
    success: true,
    message: 'Product updated.',
    ...warehouseProductViewModel.toProductResponse(product),
  });
});

const downloadTemplate = asyncHandler(async (req, res) => {
  const buffer = await productCatalogService.generateWarehouseTemplateBuffer();
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', 'attachment; filename="my-products-template.xlsx"');
  res.send(buffer);
});

const importExcel = asyncHandler(async (req, res) => {
  const warehouse = await loadWarehouseOrThrow(req.user._id);
  const report = await warehouseProductService.importProductsFromExcel(
    warehouse._id,
    req.user._id,
    req.file
  );
  res.json({ success: true, ...report });
});

module.exports = { list, create, update, downloadTemplate, importExcel };
