const fs = require('fs');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const adminBannerService = require('../services/adminBanner.service');
const adminBannerViewModel = require('../viewmodels/adminBanner.viewmodel');
const { verifyImageMagicBytes } = require('../middlewares/upload.middleware');
const { parseCursorQuery, parseObjectIdCursor, paginationMeta } = require('../utils/pagination');

// Two shapes on one endpoint: the Dashboard's pending-count calls this with
// no `limit` (status='pending') and needs the full bucket - only the
// Banners management page opts into pagination (status='all' + limit/after).
const list = asyncHandler(async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;

  if (req.query.limit === undefined) {
    const rows = await adminBannerService.listBanners(status);
    res.json({ success: true, ...adminBannerViewModel.toAdminBannersResponse(rows) });
    return;
  }

  const { limit, after } = parseCursorQuery(req.query, 20);
  const cursor = parseObjectIdCursor(after);
  const { rows, hasMore, nextCursor } = await adminBannerService.listPaginatedBanners(status, {
    limit,
    after: cursor,
  });
  res.json({
    success: true,
    ...adminBannerViewModel.toAdminBannersResponse(rows),
    pagination: paginationMeta(hasMore, nextCursor),
  });
});

const create = asyncHandler(async (req, res) => {
  const cleanupUploadedFile = () => {
    if (req.file) fs.unlink(req.file.path, () => {});
  };

  try {
    if (!req.file) {
      throw ApiError.badRequest('A banner image is required.', undefined, 'BANNER_IMAGE_REQUIRED');
    }
    if (!verifyImageMagicBytes(req.file.path)) {
      throw ApiError.badRequest('Banner image file content is not a valid image.');
    }
    const imageUrl = `${req.protocol}://${req.get('host')}/uploads/banners/${req.file.filename}`;

    const banner = await adminBannerService.createAdminBanner(req.user._id, {
      productId: req.body.productId,
      startDate: req.body.startDate,
      endDate: req.body.endDate,
      title: req.body.title,
      imageUrl,
    });

    res.status(201).json({
      success: true,
      message: 'Banner published.',
      ...adminBannerViewModel.toAdminBannerResponse(banner),
    });
  } catch (err) {
    cleanupUploadedFile();
    throw err;
  }
});

const approve = asyncHandler(async (req, res) => {
  await adminBannerService.approveBanner(req.params.id, req.user._id);
  res.json({ success: true, message: 'Banner approved.' });
});

const reject = asyncHandler(async (req, res) => {
  await adminBannerService.rejectBanner(req.params.id, req.body.rejectionNote);
  res.json({ success: true, message: 'Banner rejected.' });
});

const remove = asyncHandler(async (req, res) => {
  await adminBannerService.deleteBanner(req.params.id);
  res.json({ success: true, message: 'Banner deleted.' });
});

const update = asyncHandler(async (req, res) => {
  await adminBannerService.updateBanner(req.params.id, {
    startDate: req.body.startDate,
    endDate: req.body.endDate,
    title: req.body.title,
  });
  res.json({ success: true, message: 'Banner updated.' });
});

module.exports = { list, create, approve, reject, remove, update };
