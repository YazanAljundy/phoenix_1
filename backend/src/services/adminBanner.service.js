const mongoose = require('mongoose');
const { ApiError } = require('../utils/ApiError');
const Banner = require('../models/banner.model');
const Warehouse = require('../models/warehouse.model');
const Product = require('../models/product.model');
const Counter = require('../models/counter.model');
const { applyResolvedIdentity } = require('./productCatalog.service');
const { deleteImageByUrl } = require('./upload.service');
const { emitToAdmins, EVENTS } = require('../realtime');

// Same atomic $inc pattern as Order's nextOrderNumber (order.service.js) -
// shares the same 'banner_number' sequence as warehouseBanner.service.js's
// own copy, so numbers stay unique across both creation paths.
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

// The moderation queue by default (`status` omitted), oldest first - same
// FIFO reasoning as the admin's other review queues (offers, pending
// accounts). Pass `status: 'all'` for the unfiltered management view, or a
// specific status to see just that bucket.
async function listBanners(status) {
  const filter = !status || status === 'pending' ? { status: 'pending' } : status === 'all' ? {} : { status };
  const newestFirst = Boolean(status) && status !== 'pending';

  const banners = await Banner.find(filter).sort({ createdAt: newestFirst ? -1 : 1 });
  if (banners.length === 0) return [];

  const warehouseIds = [...new Set(banners.filter((b) => b.warehouseId).map((b) => b.warehouseId.toString()))];
  const productIds = [...new Set(banners.filter((b) => b.productId).map((b) => b.productId.toString()))];
  const [warehouses, products] = await Promise.all([
    Warehouse.find({ _id: { $in: warehouseIds } }),
    Product.find({ _id: { $in: productIds } }).populate('masterProductId'),
  ]);
  products.forEach(applyResolvedIdentity);
  const warehouseById = new Map(warehouses.map((w) => [w._id.toString(), w]));
  const productById = new Map(products.map((p) => [p._id.toString(), p]));

  return banners.map((banner) => ({
    banner,
    warehouse: banner.warehouseId ? (warehouseById.get(banner.warehouseId.toString()) ?? null) : null,
    product: banner.productId ? (productById.get(banner.productId.toString()) ?? null) : null,
  }));
}

const ADMIN_BANNERS_DEFAULT_LIMIT = 20;

// The Banners management page (unlike listBanners above - still used as-is
// by the Dashboard's pending-count and by this same function's own
// unpaginated default) wants "Load more" over the unfiltered ('all') view.
// Same status/sort rules as listBanners, just with a cursor - an ObjectId's
// embedded timestamp makes `_id` ascending/descending equivalent to the
// `createdAt` ascending/descending choice above.
async function listPaginatedBanners(status, { limit = ADMIN_BANNERS_DEFAULT_LIMIT, after = null } = {}) {
  const filter = !status || status === 'pending' ? { status: 'pending' } : status === 'all' ? {} : { status };
  const newestFirst = Boolean(status) && status !== 'pending';

  if (after !== null) {
    filter._id = newestFirst ? { $lt: after } : { $gt: after };
  }

  const banners = await Banner.find(filter)
    .sort({ _id: newestFirst ? -1 : 1 })
    .limit(limit + 1);
  const hasMore = banners.length > limit;
  const page = hasMore ? banners.slice(0, limit) : banners;
  const nextCursor = page.length > 0 ? String(page[page.length - 1]._id) : null;

  if (page.length === 0) return { rows: [], hasMore: false, nextCursor: null };

  const warehouseIds = [...new Set(page.filter((b) => b.warehouseId).map((b) => b.warehouseId.toString()))];
  const productIds = [...new Set(page.filter((b) => b.productId).map((b) => b.productId.toString()))];
  const [warehouses, products] = await Promise.all([
    Warehouse.find({ _id: { $in: warehouseIds } }),
    Product.find({ _id: { $in: productIds } }).populate('masterProductId'),
  ]);
  products.forEach(applyResolvedIdentity);
  const warehouseById = new Map(warehouses.map((w) => [w._id.toString(), w]));
  const productById = new Map(products.map((p) => [p._id.toString(), p]));

  const rows = page.map((banner) => ({
    banner,
    warehouse: banner.warehouseId ? (warehouseById.get(banner.warehouseId.toString()) ?? null) : null,
    product: banner.productId ? (productById.get(banner.productId.toString()) ?? null) : null,
  }));

  return { rows, hasMore, nextCursor };
}

// Section: the admin publishes straight to 'approved' - no self-moderation
// step, unlike a warehouse's banner. warehouseId stays null (the model's own
// marker for "the admin's own banner, not tied to any one warehouse").
// `productId` isn't ownership-scoped here (unlike the warehouse's own
// createBanner) since the admin can reference any warehouse's product.
async function createAdminBanner(userId, { productId, startDate, endDate, title, imageUrl }) {
  const trimmedTitle = validateTitle(title);

  const parsedStart = parseDate(startDate);
  const parsedEnd = parseDate(endDate);
  if (!parsedStart || !parsedEnd || parsedEnd <= parsedStart) {
    throw ApiError.badRequest('Invalid banner date range.', undefined, 'INVALID_DATE_RANGE');
  }

  let manufacturerAr = null;
  let resolvedProductId = null;
  if (productId) {
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      throw ApiError.notFound('Product not found.', 'PRODUCT_NOT_FOUND');
    }
    const product = await Product.findOne({ _id: productId, isActive: true }).populate('masterProductId');
    if (!product) {
      throw ApiError.notFound('Product not found.', 'PRODUCT_NOT_FOUND');
    }
    applyResolvedIdentity(product);
    manufacturerAr = product.manufacturerAr;
    resolvedProductId = product._id;
  }

  const bannerNumber = await nextBannerNumber();

  return Banner.create({
    bannerNumber,
    warehouseId: null,
    imageUrl,
    productId: resolvedProductId,
    manufacturerAr,
    title: trimmedTitle,
    status: 'approved',
    approvedBy: userId,
    startDate: parsedStart,
    endDate: parsedEnd,
    createdBy: userId,
  });
}

async function findBannerOrThrow(bannerId) {
  if (!mongoose.Types.ObjectId.isValid(bannerId)) {
    throw ApiError.notFound('Banner not found.', 'BANNER_NOT_FOUND');
  }
  const banner = await Banner.findById(bannerId);
  if (!banner) {
    throw ApiError.notFound('Banner not found.', 'BANNER_NOT_FOUND');
  }
  return banner;
}

async function approveBanner(bannerId, userId) {
  const banner = await findBannerOrThrow(bannerId);
  banner.status = 'approved';
  banner.approvedBy = userId;
  banner.rejectionNote = null;
  await banner.save();

  // Same multi-admin reasoning as the account/offer decisions.
  emitToAdmins(EVENTS.BANNER_STATUS_UPDATED, {
    bannerId: banner._id.toString(),
    bannerNumber: banner.bannerNumber,
    status: banner.status,
  });

  return banner;
}

function requireRejectionNote(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw ApiError.badRequest('A rejection note is required.', undefined, 'REJECTION_NOTE_REQUIRED');
  }
  return value.trim();
}

async function rejectBanner(bannerId, rejectionNote) {
  const banner = await findBannerOrThrow(bannerId);
  banner.status = 'rejected';
  // Validated before the write, so an empty note throws without ever emitting.
  banner.rejectionNote = requireRejectionNote(rejectionNote);
  banner.approvedBy = null;
  await banner.save();

  emitToAdmins(EVENTS.BANNER_STATUS_UPDATED, {
    bannerId: banner._id.toString(),
    bannerNumber: banner.bannerNumber,
    status: banner.status,
  });

  return banner;
}

async function deleteBanner(bannerId) {
  const banner = await findBannerOrThrow(bannerId);
  deleteBannerImage(banner.imageUrl);
  await banner.deleteOne();
}

// Dates/title only - the image can't be swapped without re-review, so a
// warehouse-submitted banner's image stays whatever was originally approved.
async function updateBanner(bannerId, { startDate, endDate, title }) {
  const banner = await findBannerOrThrow(bannerId);

  if (title !== undefined) {
    banner.title = validateTitle(title);
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

module.exports = {
  listBanners,
  listPaginatedBanners,
  createAdminBanner,
  approveBanner,
  rejectBanner,
  deleteBanner,
  updateBanner,
};
