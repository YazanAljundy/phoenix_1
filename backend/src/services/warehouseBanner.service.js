const mongoose = require('mongoose');
const { ApiError } = require('../utils/ApiError');
const Banner = require('../models/banner.model');
const Counter = require('../models/counter.model');
const { findOwnedProductOrThrow } = require('./warehouseProduct.service');
const { applyResolvedIdentity } = require('./productCatalog.service');
const { deleteImageByUrl } = require('./upload.service');
const { emitToAdmins, EVENTS } = require('../realtime');

// Same atomic $inc pattern as Order's nextOrderNumber (order.service.js).
async function nextBannerNumber() {
  const counter = await Counter.findOneAndUpdate(
    { _id: 'banner_number' },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );
  return counter.seq;
}

function parseDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function validateTitle(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw ApiError.badRequest('Invalid title.', undefined, 'INVALID_BANNER_TITLE');
  }
  return value.trim();
}

// Fire-and-forget Cloudinary cleanup for a deleted banner's image -
// deleteImageByUrl swallows its own errors, an orphaned asset never blocks
// the delete.
function deleteBannerImage(url) {
  if (!url) return;
  deleteImageByUrl(url);
}

// Section: a banner always starts 'pending' - only an admin can move it to
// 'approved'/'rejected' (adminBanner.service.js). The warehouse never
// publishes its own banner live. `productId` is optional; when given it's
// scoped to this warehouse's own catalog (same IDOR guard offers use) and
// manufacturerAr is resolved and snapshotted from it right here.
async function createBanner(warehouseId, userId, { productId, startDate, endDate, title, imageUrl }) {
  const trimmedTitle = validateTitle(title);

  const parsedStart = parseDate(startDate);
  const parsedEnd = parseDate(endDate);
  if (!parsedStart || !parsedEnd || parsedEnd <= parsedStart) {
    throw ApiError.badRequest('Invalid banner date range.', undefined, 'INVALID_DATE_RANGE');
  }

  let manufacturerAr = null;
  let resolvedProductId = null;
  if (productId) {
    const product = await findOwnedProductOrThrow(productId, warehouseId);
    await product.populate('masterProductId');
    applyResolvedIdentity(product);
    manufacturerAr = product.manufacturerAr;
    resolvedProductId = product._id;
  }

  const bannerNumber = await nextBannerNumber();

  const banner = await Banner.create({
    bannerNumber,
    warehouseId,
    imageUrl,
    productId: resolvedProductId,
    manufacturerAr,
    title: trimmedTitle,
    status: 'pending',
    startDate: parsedStart,
    endDate: parsedEnd,
    createdBy: userId,
  });

  // Into the admin moderation queue - same as offers, a warehouse banner never
  // goes live on its own. Emitted after Banner.create resolves, so a failed
  // insert announces nothing.
  emitToAdmins(EVENTS.BANNER_PENDING, {
    bannerId: banner._id.toString(),
    bannerNumber: banner.bannerNumber,
    warehouseId: String(warehouseId),
  });

  return banner;
}

const WAREHOUSE_BANNERS_DEFAULT_LIMIT = 15;

// An ObjectId's embedded timestamp makes `_id` descending equivalent to the
// `createdAt` descending sort above, so no compound cursor is needed.
async function listPaginatedBannersForWarehouse(
  warehouseId,
  { limit = WAREHOUSE_BANNERS_DEFAULT_LIMIT, after = null } = {}
) {
  const filter = { warehouseId };
  if (after !== null) {
    filter._id = { $lt: after };
  }

  // warehouseBanner.viewmodel.js's serializeWarehouseBanner reads id/
  // bannerNumber/imageUrl/productId/manufacturerAr/title/status/rejectionNote/
  // startDate/endDate/createdAt. warehouseId is the filter.
  const rows = await Banner.find(filter)
    .select('bannerNumber imageUrl productId manufacturerAr title status rejectionNote startDate endDate createdAt')
    .sort({ _id: -1 })
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = page.length > 0 ? String(page[page.length - 1]._id) : null;

  return { rows: page, hasMore, nextCursor };
}

async function findOwnBannerOrThrow(bannerId, warehouseId) {
  if (!mongoose.Types.ObjectId.isValid(bannerId)) {
    throw ApiError.notFound('Banner not found.', 'BANNER_NOT_FOUND');
  }
  const banner = await Banner.findOne({ _id: bannerId, warehouseId });
  if (!banner) {
    throw ApiError.notFound('Banner not found.', 'BANNER_NOT_FOUND');
  }
  return banner;
}

// Section: only deletable while pending or rejected - an approved (live)
// banner can't be pulled by the warehouse itself, same "final once decided/
// live" principle as offers/returns elsewhere.
async function deleteBanner(bannerId, warehouseId) {
  const banner = await findOwnBannerOrThrow(bannerId, warehouseId);
  if (banner.status === 'approved') {
    throw ApiError.badRequest(
      'An approved banner cannot be deleted directly - contact the admin.',
      undefined,
      'BANNER_NOT_DELETABLE'
    );
  }
  deleteBannerImage(banner.imageUrl);
  await banner.deleteOne();
}

// Section: editable while pending or rejected only - once an admin has
// approved it (live), the warehouse can no longer change it, same "final
// once decided/live" principle as deleteBanner above. Dates/title/product
// only - the image can't be swapped without re-review, so it stays whatever
// was originally submitted.
async function updateBanner(bannerId, warehouseId, { productId, startDate, endDate, title }) {
  const banner = await findOwnBannerOrThrow(bannerId, warehouseId);
  if (banner.status === 'approved') {
    throw ApiError.forbidden(
      'An approved banner cannot be edited - contact the admin.',
      'BANNER_ALREADY_PUBLISHED'
    );
  }

  if (title !== undefined) {
    banner.title = validateTitle(title);
  }

  if (productId !== undefined) {
    if (productId) {
      const product = await findOwnedProductOrThrow(productId, warehouseId);
      await product.populate('masterProductId');
      applyResolvedIdentity(product);
      banner.productId = product._id;
      banner.manufacturerAr = product.manufacturerAr;
    } else {
      banner.productId = null;
      banner.manufacturerAr = null;
    }
  }

  if (startDate !== undefined || endDate !== undefined) {
    const parsedStart = startDate !== undefined ? parseDate(startDate) : banner.startDate;
    const parsedEnd = endDate !== undefined ? parseDate(endDate) : banner.endDate;
    if (!parsedStart || !parsedEnd || parsedEnd <= parsedStart) {
      throw ApiError.badRequest('Invalid banner date range.', undefined, 'INVALID_DATE_RANGE');
    }
    banner.startDate = parsedStart;
    banner.endDate = parsedEnd;
  }

  await banner.save();
  return banner;
}

module.exports = { createBanner, listPaginatedBannersForWarehouse, deleteBanner, updateBanner };
