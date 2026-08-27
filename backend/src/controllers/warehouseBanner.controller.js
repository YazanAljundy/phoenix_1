const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const Warehouse = require('../models/warehouse.model');
const warehouseBannerService = require('../services/warehouseBanner.service');
const warehouseBannerViewModel = require('../viewmodels/warehouseBanner.viewmodel');
const { verifyImageMagicBytes } = require('../middlewares/upload.middleware');
const { uploadImage, deleteImageByUrl } = require('../services/upload.service');
const { parseCursorQuery, parseObjectIdCursor, paginationMeta } = require('../utils/pagination');

async function loadWarehouseOrThrow(userId) {
  const warehouse = await Warehouse.findOne({ userId });
  if (!warehouse) {
    throw ApiError.notFound('Warehouse profile not found.', 'WAREHOUSE_PROFILE_NOT_FOUND');
  }
  return warehouse;
}

const list = asyncHandler(async (req, res) => {
  const warehouse = await loadWarehouseOrThrow(req.user._id);
  const { limit, after } = parseCursorQuery(req.query, 15);
  const cursor = parseObjectIdCursor(after);
  const { rows, hasMore, nextCursor } = await warehouseBannerService.listPaginatedBannersForWarehouse(
    warehouse._id,
    { limit, after: cursor }
  );
  res.json({
    success: true,
    ...warehouseBannerViewModel.toWarehouseBannersResponse(rows),
    pagination: paginationMeta(hasMore, nextCursor),
  });
});

const create = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw ApiError.badRequest('A banner image is required.', undefined, 'BANNER_IMAGE_REQUIRED');
  }
  if (!verifyImageMagicBytes(req.file.buffer)) {
    throw ApiError.badRequest('Banner image file content is not a valid image.');
  }

  // Uploaded to Cloudinary first; if a later step (date validation, etc.)
  // rejects the request, the just-uploaded image is removed so a user error
  // doesn't leave an orphan behind.
  const imageUrl = await uploadImage(req.file.buffer, 'banners');

  let banner;
  try {
    const warehouse = await loadWarehouseOrThrow(req.user._id);
    banner = await warehouseBannerService.createBanner(warehouse._id, req.user._id, {
      productId: req.body.productId,
      startDate: req.body.startDate,
      endDate: req.body.endDate,
      title: req.body.title,
      imageUrl,
    });
  } catch (err) {
    await deleteImageByUrl(imageUrl);
    throw err;
  }

  res.status(201).json({
    success: true,
    message: 'Banner submitted for approval.',
    ...warehouseBannerViewModel.toWarehouseBannerResponse(banner),
  });
});

const remove = asyncHandler(async (req, res) => {
  const warehouse = await loadWarehouseOrThrow(req.user._id);
  await warehouseBannerService.deleteBanner(req.params.id, warehouse._id);
  res.json({ success: true, message: 'Banner deleted.' });
});

const update = asyncHandler(async (req, res) => {
  const warehouse = await loadWarehouseOrThrow(req.user._id);
  const banner = await warehouseBannerService.updateBanner(req.params.id, warehouse._id, {
    productId: req.body.productId,
    startDate: req.body.startDate,
    endDate: req.body.endDate,
    title: req.body.title,
  });
  res.json({ success: true, message: 'Banner updated.', ...warehouseBannerViewModel.toWarehouseBannerResponse(banner) });
});

module.exports = { list, create, remove, update };
