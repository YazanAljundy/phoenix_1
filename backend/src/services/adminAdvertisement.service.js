const mongoose = require('mongoose');
const { ApiError } = require('../utils/ApiError');
const Advertisement = require('../models/advertisement.model');
const Product = require('../models/product.model');
const Pharmacy = require('../models/pharmacy.model');
const Warehouse = require('../models/warehouse.model');
const { applyResolvedIdentity } = require('./productCatalog.service');
const notificationService = require('./notification.service');
const { emitToAdmins, EVENTS } = require('../realtime');

const ADMIN_ADVERTISEMENTS_DEFAULT_LIMIT = 20;

// adminAdvertisement.viewmodel.js's serializePendingAdvertisement reads, off
// the advertisement: id/titleAr/titleEn/items/totalPriceUsd/startDate/endDate/
// status/rejectionNote/createdAt. warehouseId is the join key.
const PENDING_ADVERTISEMENT_FIELDS =
  'titleAr titleEn items totalPriceUsd startDate endDate status rejectionNote createdAt warehouseId';
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

// The Advertisements management page wants "Load more" plus a "Pending (N)"
// pill that stays accurate regardless of pagination - an ObjectId's embedded
// timestamp makes `_id` ascending equivalent to `createdAt` ascending, so the
// cursor walks the queue oldest-first.
async function listPaginatedPendingAdvertisements({
  limit = ADMIN_ADVERTISEMENTS_DEFAULT_LIMIT,
  after = null,
} = {}) {
  const filter = { status: 'pending' };
  if (after !== null) {
    filter._id = { $gt: after };
  }

  const [advertisements, totalCount] = await Promise.all([
    Advertisement.find(filter).select(PENDING_ADVERTISEMENT_FIELDS).sort({ _id: 1 }).limit(limit + 1),
    Advertisement.countDocuments({ status: 'pending' }),
  ]);
  const hasMore = advertisements.length > limit;
  const page = hasMore ? advertisements.slice(0, limit) : advertisements;
  const nextCursor = page.length > 0 ? String(page[page.length - 1]._id) : null;

  if (page.length === 0) return { rows: [], hasMore: false, nextCursor: null, totalCount };

  return { rows: await attachRefs(page), hasMore, nextCursor, totalCount };
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
  emitToAdmins(EVENTS.ADVERTISEMENT_STATUS_UPDATED, {
    advertisementId: advertisement._id.toString(),
    warehouseId: advertisement.warehouseId.toString(),
    status: 'approved',
  });

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

  emitToAdmins(EVENTS.ADVERTISEMENT_STATUS_UPDATED, {
    advertisementId: advertisement._id.toString(),
    warehouseId: advertisement.warehouseId.toString(),
    status: 'rejected',
  });

  return advertisement;
}

module.exports = {
  listPendingAdvertisements,
  listPaginatedPendingAdvertisements,
  approveAdvertisement,
  rejectAdvertisement,
};
