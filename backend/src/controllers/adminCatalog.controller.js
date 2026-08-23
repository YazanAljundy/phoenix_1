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

const update = asyncHandler(async (req, res) => {
  const item = await catalogService.updateCatalogItem(req.params.id, req.body);
  res.json({ success: true, ...catalogViewModel.toCatalogItemResponse(item) });
});

const deactivate = asyncHandler(async (req, res) => {
  await catalogService.deactivateCatalogItem(req.params.id);
  res.json({ success: true, message: 'Catalog item deactivated.' });
});

module.exports = { list, downloadTemplate, importExcel, update, deactivate };
