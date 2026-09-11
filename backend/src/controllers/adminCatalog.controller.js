const { asyncHandler } = require('../utils/asyncHandler');
const catalogService = require('../services/productCatalog.service');
const catalogViewModel = require('../viewmodels/productCatalog.viewmodel');
const { parseCursorQuery, parseObjectIdCursor, paginationMeta } = require('../utils/pagination');

const CATALOG_DEFAULT_LIMIT = 30;

const list = asyncHandler(async (req, res) => {
  const { limit, after } = parseCursorQuery(req.query, CATALOG_DEFAULT_LIMIT);
  const cursor = parseObjectIdCursor(after);

  const { items, hasMore, nextCursor } = await catalogService.listCatalog({
    search: req.query.q,
    categoryId: typeof req.query.categoryId === 'string' ? req.query.categoryId : undefined,
    limit,
    after: cursor,
  });
  res.json({
    success: true,
    ...catalogViewModel.toCatalogListResponse(items),
    pagination: paginationMeta(hasMore, nextCursor),
  });
});

const downloadTemplate = asyncHandler(async (req, res) => {
  const buffer = await catalogService.generateTemplateBuffer();
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', 'attachment; filename="product-catalog-template.xlsx"');
  res.send(buffer);
});

const importExcel = asyncHandler(async (req, res) => {
  const report = await catalogService.importFromExcel(req.file);
  res.json({ success: true, ...report });
});

// `confirm=true` acknowledges the CATALOG_RENAME_NEEDS_CONFIRMATION the
// first attempt returns - a query param rather than a body field so the
// retry is the identical PATCH body, just re-sent.
const update = asyncHandler(async (req, res) => {
  const item = await catalogService.updateCatalogItem(req.params.id, req.body, {
    userId: req.user._id,
    confirmed: req.query.confirm === 'true',
  });
  res.json({ success: true, ...catalogViewModel.toCatalogItemResponse(item) });
});

// Reports how many warehouse products went with it - deactivating a master
// entry now cascades to every product linked to it, and that is a large
// enough consequence that the panel should be able to say so rather than
// leave the admin to discover it.
const deactivate = asyncHandler(async (req, res) => {
  const { deactivatedProductCount } = await catalogService.deactivateCatalogItem(req.params.id);
  res.json({
    success: true,
    message: 'Catalog item deactivated.',
    deactivatedProductCount,
  });
});

module.exports = { list, downloadTemplate, importExcel, update, deactivate };
