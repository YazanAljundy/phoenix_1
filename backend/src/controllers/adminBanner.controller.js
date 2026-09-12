const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const adminBannerService = require('../services/adminBanner.service');
const adminBannerViewModel = require('../viewmodels/adminBanner.viewmodel');
const { verifyBannerMediaMagicBytes } = require('../middlewares/upload.middleware');
const { uploadMedia, deleteImageByUrl } = require('../services/upload.service');
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
  if (!req.file) {
    throw ApiError.badRequest('A banner image is required.', undefined, 'BANNER_IMAGE_REQUIRED');
  }
  // Resolved by adminBannerMediaUpload's fileFilter (upload.middleware.js) -
  // 'image', 'gif', or 'video'.
  const mediaType = req.file.bannerMediaType;
  if (!verifyBannerMediaMagicBytes(req.file.buffer, mediaType)) {
    throw ApiError.badRequest('Banner file content does not match its declared type.', undefined, 'INVALID_MEDIA_TYPE');
  }

  // Uploaded to Cloudinary first; removed again if a later step (date
  // validation, product lookup) rejects the request, so a user error never
  // leaves an orphan behind.
  const imageUrl = await uploadMedia(req.file.buffer, 'banners', mediaType === 'video' ? 'video' : 'image');

  let banner;
  try {
    banner = await adminBannerService.createAdminBanner(req.user._id, {
      productId: req.body.productId,
      startDate: req.body.startDate,
      endDate: req.body.endDate,
      title: req.body.title,
      imageUrl,
      mediaType,
    });
  } catch (err) {
    await deleteImageByUrl(imageUrl);
    throw err;
  }

  res.status(201).json({
    success: true,
    message: 'Banner published.',
    ...adminBannerViewModel.toAdminBannerResponse(banner),
  });
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
  // Replacing the media is optional on an edit - the admin can change just
  // the title/dates, or swap the image/gif/video too, at any status
  // (including an already-approved banner).
  let imageUrl;
  let mediaType;
  if (req.file) {
    mediaType = req.file.bannerMediaType;
    if (!verifyBannerMediaMagicBytes(req.file.buffer, mediaType)) {
      throw ApiError.badRequest('Banner file content does not match its declared type.', undefined, 'INVALID_MEDIA_TYPE');
    }
    imageUrl = await uploadMedia(req.file.buffer, 'banners', mediaType === 'video' ? 'video' : 'image');
  }

  try {
    await adminBannerService.updateBanner(req.params.id, {
      startDate: req.body.startDate,
      endDate: req.body.endDate,
      title: req.body.title,
      imageUrl,
      mediaType,
    });
  } catch (err) {
    if (imageUrl) await deleteImageByUrl(imageUrl);
    throw err;
  }
  res.json({ success: true, message: 'Banner updated.' });
});

module.exports = { list, create, approve, reject, remove, update };
