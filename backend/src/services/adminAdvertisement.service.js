const mongoose = require('mongoose');
const { ApiError } = require('../utils/ApiError');
const Advertisement = require('../models/advertisement.model');
const Product = require('../models/product.model');
const Pharmacy = require('../models/pharmacy.model');
const Warehouse = require('../models/warehouse.model');
const { applyResolvedIdentity } = require('./productCatalog.service');
const { buildAdvertisementFields } = require('./warehouseAdvertisement.service');
const { deleteImageByUrl } = require('./upload.service');
const notificationService = require('./notification.service');
const { emitToAdmins, emitToWarehouse, EVENTS } = require('../realtime');

const ADMIN_ADVERTISEMENTS_DEFAULT_LIMIT = 20;

// adminAdvertisement.viewmodel.js's serializePendingAdvertisement reads, off
// the advertisement: id/titleAr/titleEn/items/totalPriceUsd/imageUrl/
// startDate/endDate/status/rejectionNote/isAvailable/createdAt. warehouseId is
// the join key. isAvailable has to be listed here like any other field: left
// out of the projection, a paused package would serialize as available.
const PENDING_ADVERTISEMENT_FIELDS =
  'titleAr titleEn items totalPriceUsd imageUrl startDate endDate status rejectionNote isAvailable createdAt warehouseId';

// The three lists the management page can show. `pending` is the moderation
// queue; `approved` is where an admin finds a live package to pause or
// re-enable (setAdvertisementAvailability below) - including one only an
// admin can still reach, e.g. a package its warehouse's own edit sent back to
// `pending` while paused (see warehouseAdvertisement.service.js's
// updateAdvertisement, which never touches isAvailable). `rejected` is the
// same paginated shape as the other two - unlike Offer, a rejected
// Advertisement is kept (not deleted) along with its rejectionNote, so it can
// be listed and paged exactly like any other status.
const LISTABLE_STATUSES = ['pending', 'approved', 'rejected'];
const ADVERTISEMENT_PRODUCT_SELECT = 'nameAr nameEn manufacturerAr manufacturerEn masterProductId';
const CATALOG_IDENTITY_SELECT = 'nameAr nameEn manufacturerAr manufacturerEn';

// Joins each page's advertisements to the products they advertise and the
// warehouses that own them - two $in queries for the whole page, never one
// per advertisement or one per item.
async function attachRefs(advertisements) {
  const productIds = [
    ...new Set(advertisements.flatMap((ad) => ad.items.map((item) => item.productId.toString()))),
  ];
  const warehouseIds = [...new Set(advertisements.map((ad) => ad.warehouseId.toString()))];

  const [products, warehouses] = await Promise.all([
    productIds.length
      ? Product.find({ _id: { $in: productIds } })
          .select(ADVERTISEMENT_PRODUCT_SELECT)
          .populate({ path: 'masterProductId', select: CATALOG_IDENTITY_SELECT })
      : [],
    Warehouse.find({ _id: { $in: warehouseIds } }).select('nameAr nameEn'),
  ]);
  products.forEach(applyResolvedIdentity);
  const productById = new Map(products.map((p) => [p._id.toString(), p]));
  const warehouseById = new Map(warehouses.map((w) => [w._id.toString(), w]));

  return advertisements.map((advertisement) => ({
    advertisement,
    productById,
    warehouse: warehouseById.get(advertisement.warehouseId.toString()) ?? null,
  }));
}

// The review queue - oldest first, same FIFO reasoning as the offers and
// pending-accounts queues.
async function listPendingAdvertisements() {
  const advertisements = await Advertisement.find({ status: 'pending' })
    .select(PENDING_ADVERTISEMENT_FIELDS)
    .sort({ createdAt: 1 });
  if (advertisements.length === 0) return [];
  return attachRefs(advertisements);
}

// The Advertisements management page wants "Load more" plus a count pill that
// stays accurate regardless of pagination - an ObjectId's embedded timestamp
// makes `_id` ascending equivalent to `createdAt` ascending, so the cursor
// walks the list oldest-first. `status` picks the list (LISTABLE_STATUSES).
async function listPaginatedAdvertisements({
  status = 'pending',
  limit = ADMIN_ADVERTISEMENTS_DEFAULT_LIMIT,
  after = null,
} = {}) {
  if (!LISTABLE_STATUSES.includes(status)) {
    throw ApiError.badRequest('Invalid status.', undefined, 'INVALID_STATUS');
  }
  const filter = { status };
  if (after !== null) {
    filter._id = { $gt: after };
  }

  const [advertisements, totalCount] = await Promise.all([
    Advertisement.find(filter).select(PENDING_ADVERTISEMENT_FIELDS).sort({ _id: 1 }).limit(limit + 1),
    Advertisement.countDocuments({ status }),
  ]);
  const hasMore = advertisements.length > limit;
  const page = hasMore ? advertisements.slice(0, limit) : advertisements;
  const nextCursor = page.length > 0 ? String(page[page.length - 1]._id) : null;

  if (page.length === 0) return { rows: [], hasMore: false, nextCursor: null, totalCount };

  return { rows: await attachRefs(page), hasMore, nextCursor, totalCount };
}

// The pending queue is just the status-scoped list above, kept under its own
// name for the callers that only ever want the queue.
function listPaginatedPendingAdvertisements(options = {}) {
  return listPaginatedAdvertisements({ ...options, status: 'pending' });
}

// The admin's cross-warehouse oversight view - EVERY advertisement, every
// warehouse, every status, unpaginated. No longer the only way to reach a
// rejected package (the Rejected tab now uses the same paginated
// listPaginatedAdvertisements as Pending/Approved); kept for any other
// caller that genuinely wants the full unfiltered set.
async function listAllAdvertisements() {
  const advertisements = await Advertisement.find({})
    .select(PENDING_ADVERTISEMENT_FIELDS)
    .sort({ createdAt: -1 });
  if (advertisements.length === 0) return [];
  return attachRefs(advertisements);
}

async function findPendingAdvertisementOrThrow(advertisementId) {
  if (!mongoose.Types.ObjectId.isValid(advertisementId)) {
    throw ApiError.notFound('Advertisement not found.', 'ADVERTISEMENT_NOT_FOUND');
  }
  const advertisement = await Advertisement.findOne({ _id: advertisementId, status: 'pending' });
  if (!advertisement) {
    throw ApiError.notFound('Advertisement not found.', 'ADVERTISEMENT_NOT_FOUND');
  }
  return advertisement;
}

// Unrestricted by status - the admin's direct edit/delete can reach a
// pending, approved, or rejected package alike, same as adminOffer.service's
// findAnyOfferOrThrow.
async function findAnyAdvertisementOrThrow(advertisementId) {
  if (!mongoose.Types.ObjectId.isValid(advertisementId)) {
    throw ApiError.notFound('Advertisement not found.', 'ADVERTISEMENT_NOT_FOUND');
  }
  const advertisement = await Advertisement.findById(advertisementId);
  if (!advertisement) {
    throw ApiError.notFound('Advertisement not found.', 'ADVERTISEMENT_NOT_FOUND');
  }
  return advertisement;
}

// An admin's decision on (or edit/delete of) a package. Every admin's queue
// needs it, and so does the one warehouse that owns the package - same two
// rooms, and the same stored-warehouseId rule, as setAdvertisementAvailability
// below.
function emitAdvertisementStatus(advertisement, status) {
  const payload = {
    advertisementId: advertisement._id.toString(),
    warehouseId: advertisement.warehouseId.toString(),
    status,
  };
  emitToAdmins(EVENTS.ADVERTISEMENT_STATUS_UPDATED, payload);
  emitToWarehouse(advertisement.warehouseId, EVENTS.ADVERTISEMENT_STATUS_UPDATED, payload);
}

async function approveAdvertisement(advertisementId, userId) {
  const advertisement = await findPendingAdvertisementOrThrow(advertisementId);
  advertisement.status = 'approved';
  advertisement.approvedBy = userId;
  advertisement.approvedAt = new Date();
  advertisement.rejectionNote = null;
  await advertisement.save();

  // Clears it from every other admin's open queue. Emitted before the
  // best-effort fan-out below for the same reason approveOffer does: the queue
  // shouldn't wait on a slow push to every pharmacy.
  emitAdvertisementStatus(advertisement, 'approved');

  // Never lets a notification hiccup undo the approval that already
  // succeeded. sendToAll's own per-user rate limiting caps the fan-out.
  try {
    const [warehouse, pharmacies] = await Promise.all([
      Warehouse.findById(advertisement.warehouseId, 'nameAr nameEn'),
      Pharmacy.find({ isActive: true }, 'userId'),
    ]);
    const warehouseName = warehouse?.nameAr ?? '';
    const warehouseNameEn = warehouse?.nameEn ?? warehouseName;
    await notificationService.sendToAll(
      pharmacies.map((p) => p.userId),
      {
        titleAr: 'إعلان جديد',
        titleEn: 'New Advertisement',
        bodyAr: `${advertisement.titleAr} من ${warehouseName}`,
        bodyEn: `${advertisement.titleEn} from ${warehouseNameEn}`,
        type: 'offer',
      }
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to send advertisement notification.', err.message);
  }

  return advertisement;
}

function requireRejectionNote(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw ApiError.badRequest('A rejection note is required.', undefined, 'REJECTION_NOTE_REQUIRED');
  }
  return value.trim();
}

// Unlike rejectOffer (which deletes the row - a percentage offer has nothing
// worth recording), a rejected advertisement is kept along with the reason:
// the warehouse curated a whole package and needs to know what to fix. Same
// treatment as Banner.
async function rejectAdvertisement(advertisementId, rejectionNote) {
  const advertisement = await findPendingAdvertisementOrThrow(advertisementId);
  advertisement.status = 'rejected';
  // Validated before the write, so an empty note throws without ever emitting.
  advertisement.rejectionNote = requireRejectionNote(rejectionNote);
  advertisement.approvedBy = null;
  advertisement.approvedAt = null;
  await advertisement.save();

  emitAdvertisementStatus(advertisement, 'rejected');

  return advertisement;
}

// The admin edits any package's content directly - the admin IS the approval
// authority, so there is no buffer / re-review the way a warehouse's own
// updateAdvertisement sends the package back to `pending`. Reachable at any
// status (pending/approved/rejected), same as adminUpdateOffer. Unlike Offer,
// Advertisement has no pendingUpdate buffer to guard against, so there is no
// conflict precondition here.
//
// `status`/`rejectionNote`/`approvedBy`/`approvedAt`/`isAvailable` are
// deliberately left untouched: a content edit is not itself a moderation or
// availability decision.
async function adminUpdateAdvertisement(advertisementId, data) {
  const advertisement = await findAnyAdvertisementOrThrow(advertisementId);
  const fields = await buildAdvertisementFields(advertisement.warehouseId, data);
  const previousImageUrl = advertisement.imageUrl;

  Object.assign(advertisement, fields);
  await advertisement.save();

  // Fire-and-forget, same reasoning as Banner's own admin edit - an orphaned
  // Cloudinary asset from a replaced image is never worth failing the edit
  // that already succeeded over.
  if (fields.imageUrl !== undefined && previousImageUrl && previousImageUrl !== fields.imageUrl) {
    deleteImageByUrl(previousImageUrl);
  }

  emitAdvertisementStatus(advertisement, advertisement.status);

  return advertisement;
}

// A hard delete, from any warehouse and any status, really gone from the
// database. Same shape as adminDeleteOffer.
async function adminDeleteAdvertisement(advertisementId) {
  const advertisement = await findAnyAdvertisementOrThrow(advertisementId);
  await advertisement.deleteOne();

  if (advertisement.imageUrl) {
    deleteImageByUrl(advertisement.imageUrl);
  }

  emitAdvertisementStatus(advertisement, 'deleted');
}

// The admin side of the pause switch: either direction, at any time, on any
// package - no status precondition, unlike the warehouse's own version
// (warehouseAdvertisement.service.js's updateAdvertisementAvailability, which
// requires `status === 'approved'`). An admin can act on a package regardless
// of its moderation state; this is also still the only way to flip the flag on
// a package its own warehouse cannot yet toggle (e.g. one it paused before a
// content edit sent it back to `pending` - see updateAdvertisement).
//
// Approval and this flag never touch each other: approveAdvertisement leaves
// isAvailable exactly as it finds it, so a package its warehouse paused and then
// re-submitted comes out of moderation still paused until someone (warehouse or
// admin) explicitly turns it back on.
async function setAdvertisementAvailability(advertisementId, isAvailable) {
  if (typeof isAvailable !== 'boolean') {
    throw ApiError.badRequest('Invalid availability.', undefined, 'INVALID_AVAILABILITY');
  }
  if (!mongoose.Types.ObjectId.isValid(advertisementId)) {
    throw ApiError.notFound('Advertisement not found.', 'ADVERTISEMENT_NOT_FOUND');
  }
  const advertisement = await Advertisement.findById(advertisementId);
  if (!advertisement) {
    throw ApiError.notFound('Advertisement not found.', 'ADVERTISEMENT_NOT_FOUND');
  }

  // Setting the state it is already in writes and announces nothing.
  if ((advertisement.isAvailable !== false) !== isAvailable) {
    advertisement.isAvailable = isAvailable;
    await advertisement.save();

    const payload = {
      advertisementId: advertisement._id.toString(),
      warehouseId: advertisement.warehouseId.toString(),
      isAvailable,
    };
    // Every other admin's screen, and the owning warehouse's own list - the
    // one place a paused package shows as waiting on an admin.
    emitToAdmins(EVENTS.ADVERTISEMENT_AVAILABILITY_UPDATED, payload);
    emitToWarehouse(advertisement.warehouseId, EVENTS.ADVERTISEMENT_AVAILABILITY_UPDATED, payload);
  }

  return advertisement;
}

module.exports = {
  listPendingAdvertisements,
  listPaginatedAdvertisements,
  listPaginatedPendingAdvertisements,
  listAllAdvertisements,
  approveAdvertisement,
  rejectAdvertisement,
  adminUpdateAdvertisement,
  adminDeleteAdvertisement,
  setAdvertisementAvailability,
};
