const mongoose = require('mongoose');
const { ApiError } = require('../utils/ApiError');
const Offer = require('../models/offer.model');
const Product = require('../models/product.model');
const Pharmacy = require('../models/pharmacy.model');
const Warehouse = require('../models/warehouse.model');
const { applyResolvedIdentity } = require('./productCatalog.service');
const notificationService = require('./notification.service');
const { emitToAdmins, EVENTS } = require('../realtime');

// Section 13c: the admin's review queue - oldest first, same FIFO reasoning
// as the warehouse's own order queue (Section 13b).
// adminOffer.viewmodel.js's serializePendingOffer reads, off the offer:
// id/titleAr/titleEn/discountPercentage/startDate/endDate/createdAt; off the
// product: its resolved nameAr/nameEn and price; off the warehouse: nameAr/
// nameEn. productId/warehouseId are the join keys.
const PENDING_OFFER_FIELDS = 'titleAr titleEn discountPercentage startDate endDate createdAt productId warehouseId';
const OFFER_PRODUCT_SELECT = 'nameAr nameEn manufacturerAr manufacturerEn price masterProductId';
const CATALOG_IDENTITY_SELECT = 'nameAr nameEn manufacturerAr manufacturerEn';

async function listPendingOffers() {
  const offers = await Offer.find({ status: 'pending' }).select(PENDING_OFFER_FIELDS).sort({ createdAt: 1 });
  if (offers.length === 0) return [];

  const productIds = [...new Set(offers.map((o) => o.productId.toString()))];
  const warehouseIds = [...new Set(offers.map((o) => o.warehouseId.toString()))];

  const [products, warehouses] = await Promise.all([
    Product.find({ _id: { $in: productIds } })
      .select(OFFER_PRODUCT_SELECT)
      .populate({ path: 'masterProductId', select: CATALOG_IDENTITY_SELECT }),
    Warehouse.find({ _id: { $in: warehouseIds } }).select('nameAr nameEn'),
  ]);
  products.forEach(applyResolvedIdentity);
  const productById = new Map(products.map((p) => [p._id.toString(), p]));
  const warehouseById = new Map(warehouses.map((w) => [w._id.toString(), w]));

  return offers.map((offer) => ({
    offer,
    product: productById.get(offer.productId.toString()) ?? null,
    warehouse: warehouseById.get(offer.warehouseId.toString()) ?? null,
  }));
}

const ADMIN_OFFERS_DEFAULT_LIMIT = 20;

// The Offers management page (unlike listPendingOffers above - still used
// as-is by the Dashboard's stat card/recent-list, which needs every pending
// offer at once) wants "Load more" with a "Pending (N)" pill that stays
// accurate regardless of pagination - same oldest-first order as before (an
// ObjectId's embedded timestamp makes `_id` ascending equivalent to
// `createdAt` ascending).
async function listPaginatedPendingOffers({ limit = ADMIN_OFFERS_DEFAULT_LIMIT, after = null } = {}) {
  const filter = { status: 'pending' };
  if (after !== null) {
    filter._id = { $gt: after };
  }

  const [offers, totalCount] = await Promise.all([
    Offer.find(filter).select(PENDING_OFFER_FIELDS).sort({ _id: 1 }).limit(limit + 1),
    Offer.countDocuments({ status: 'pending' }),
  ]);
  const hasMore = offers.length > limit;
  const page = hasMore ? offers.slice(0, limit) : offers;
  const nextCursor = page.length > 0 ? String(page[page.length - 1]._id) : null;

  if (page.length === 0) return { rows: [], hasMore: false, nextCursor: null, totalCount };

  const productIds = [...new Set(page.map((o) => o.productId.toString()))];
  const warehouseIds = [...new Set(page.map((o) => o.warehouseId.toString()))];

  const [products, warehouses] = await Promise.all([
    Product.find({ _id: { $in: productIds } })
      .select(OFFER_PRODUCT_SELECT)
      .populate({ path: 'masterProductId', select: CATALOG_IDENTITY_SELECT }),
    Warehouse.find({ _id: { $in: warehouseIds } }).select('nameAr nameEn'),
  ]);
  products.forEach(applyResolvedIdentity);
  const productById = new Map(products.map((p) => [p._id.toString(), p]));
  const warehouseById = new Map(warehouses.map((w) => [w._id.toString(), w]));

  const rows = page.map((offer) => ({
    offer,
    product: productById.get(offer.productId.toString()) ?? null,
    warehouse: warehouseById.get(offer.warehouseId.toString()) ?? null,
  }));

  return { rows, hasMore, nextCursor, totalCount };
}

async function findPendingOfferOrThrow(offerId) {
  if (!mongoose.Types.ObjectId.isValid(offerId)) {
    throw ApiError.notFound('Offer not found.', 'OFFER_NOT_FOUND');
  }
  const offer = await Offer.findOne({ _id: offerId, status: 'pending' });
  if (!offer) {
    throw ApiError.notFound('Offer not found.', 'OFFER_NOT_FOUND');
  }
  return offer;
}

async function approveOffer(offerId, userId) {
  const offer = await findPendingOfferOrThrow(offerId);
  offer.status = 'approved';
  offer.approvedBy = userId;
  offer.approvedAt = new Date();
  await offer.save();

  // Clears this offer from every other admin's open queue. Emitted before the
  // FCM block below because that block is best-effort and slow (a fan-out to
  // every active pharmacy) - the queue shouldn't wait on it.
  emitToAdmins(EVENTS.OFFER_STATUS_UPDATED, {
    offerId: offer._id.toString(),
    warehouseId: offer.warehouseId.toString(),
    status: 'approved',
  });

  // Fan out to every active pharmacy - never lets a notification hiccup
  // undo the approval above, which already succeeded. sendToAll's own
  // per-user rate limiting (notification.service.js) caps this at one
  // 'offer' push per pharmacy per rolling 24h, so approving several offers
  // in a row doesn't spam the same pharmacy repeatedly.
  try {
    const [warehouse, pharmacies] = await Promise.all([
      Warehouse.findById(offer.warehouseId, 'nameAr nameEn'),
      Pharmacy.find({ isActive: true }, 'userId'),
    ]);
    const warehouseName = warehouse?.nameAr ?? '';
    const warehouseNameEn = warehouse?.nameEn ?? warehouseName;
    await notificationService.sendToAll(
      pharmacies.map((p) => p.userId),
      {
        titleAr: 'عرض جديد',
        titleEn: 'New Offer',
        bodyAr: `عرض جديد من ${warehouseName}`,
        bodyEn: `New offer from ${warehouseNameEn}`,
        type: 'offer',
      }
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to send offer notification.', err.message);
  }

  return offer;
}

// Section 8: the Offer schema has no "rejected" status (only pending/
// approved) - a rejection has nothing to record, so it just removes the
// pending request rather than leaving a dangling state no UI ever shows.
async function rejectOffer(offerId) {
  const offer = await findPendingOfferOrThrow(offerId);
  await offer.deleteOne();

  // 'rejected' is this event's own vocabulary, not a stored status - the Offer
  // schema has no rejected state, a rejection just removes the row (see the
  // note above this function). Either way the queue must drop it.
  emitToAdmins(EVENTS.OFFER_STATUS_UPDATED, {
    offerId: offer._id.toString(),
    warehouseId: offer.warehouseId.toString(),
    status: 'rejected',
  });
}

module.exports = { listPendingOffers, listPaginatedPendingOffers, approveOffer, rejectOffer };
