const mongoose = require('mongoose');
const { ApiError } = require('../utils/ApiError');
const Offer = require('../models/offer.model');
const Product = require('../models/product.model');
const Pharmacy = require('../models/pharmacy.model');
const Warehouse = require('../models/warehouse.model');
const { applyResolvedIdentity } = require('./productCatalog.service');
const { buildOfferFields } = require('./warehouseOffer.service');
const { buildOfferListFilter, listPaginatedOffers, OFFER_REVIEW_FILTER } = require('./offer.service');
const notificationService = require('./notification.service');
const { emitToAdmins, emitToWarehouse, EVENTS } = require('../realtime');

// adminOffer.viewmodel.js's serializers read, off the offer:
// id/titleAr/titleEn/discountPercentage/startDate/endDate/isPermanent/status/
// pendingUpdate/createdAt; off the product: its resolved nameAr/nameEn and
// price; off the warehouse: nameAr/nameEn. productId/warehouseId are the join
// keys.
const OFFER_PRODUCT_SELECT = 'nameAr nameEn manufacturerAr manufacturerEn price masterProductId';
const CATALOG_IDENTITY_SELECT = 'nameAr nameEn manufacturerAr manufacturerEn';
const OFFER_WAREHOUSE_SELECT = 'nameAr nameEn';

// The moderation queue: a brand-new offer waiting to go live, OR an approved
// offer whose warehouse has proposed an edit that is itself waiting. Both need
// an admin decision.
const MODERATION_QUEUE_FILTER = { $or: [{ status: 'pending' }, { pendingUpdate: { $ne: null } }] };

// Joins each offer to its product (and its parked-edit product, if any) and to
// the warehouse that owns it - one $in query each for the whole list, never
// one per offer.
async function attachRefs(offers) {
  if (offers.length === 0) return [];

  const productIds = [
    ...new Set(
      offers
        .flatMap((o) => [
          o.productId.toString(),
          o.pendingUpdate ? o.pendingUpdate.productId.toString() : null,
        ])
        .filter(Boolean)
    ),
  ];
  const warehouseIds = [...new Set(offers.map((o) => o.warehouseId.toString()))];

  const [products, warehouses] = await Promise.all([
    Product.find({ _id: { $in: productIds } })
      .select(OFFER_PRODUCT_SELECT)
      .populate({ path: 'masterProductId', select: CATALOG_IDENTITY_SELECT }),
    Warehouse.find({ _id: { $in: warehouseIds } }).select(OFFER_WAREHOUSE_SELECT),
  ]);
  products.forEach(applyResolvedIdentity);
  const productById = new Map(products.map((p) => [p._id.toString(), p]));
  const warehouseById = new Map(warehouses.map((w) => [w._id.toString(), w]));

  return offers.map((offer) => ({
    offer,
    product: productById.get(offer.productId.toString()) ?? null,
    pendingUpdateProduct: offer.pendingUpdate
      ? productById.get(offer.pendingUpdate.productId.toString()) ?? null
      : null,
    warehouse: warehouseById.get(offer.warehouseId.toString()) ?? null,
  }));
}

// Section 13c: the admin's review queue - oldest first, same FIFO reasoning as
// the warehouse's own order queue. Still used as-is by the Dashboard's stat
// card / recent-list.
async function listPendingOffers() {
  const offers = await Offer.find(MODERATION_QUEUE_FILTER).sort({ createdAt: 1 });
  return attachRefs(offers);
}

const ADMIN_OFFERS_DEFAULT_LIMIT = 20;

// Section 5: the admin's cross-warehouse oversight view - EVERY offer, every
// warehouse, every status, now filtered (status pill / search / discount
// range) and cursor-paginated server-side. Used to fetch every offer
// unpaginated and let the Offers page filter it in React (see
// web/src/pages/offersFilters.js, still used for display-only concerns like
// the status badge - the filtering logic itself moved to
// offer.service.js's buildOfferListFilter/buildOfferStatusFilter, and this
// function's own JSDoc-adjacent history has the field-by-field parity check).
// `reviewCount` is independent of whichever status pill is selected - the
// Review pill's own badge needs the total queue size regardless of what page
// is currently showing, same reasoning as adminComplaint.service.js's
// per-status counts.
async function listPaginatedAllOffers({
  status,
  search,
  minDiscount,
  maxDiscount,
  limit = ADMIN_OFFERS_DEFAULT_LIMIT,
  after = null,
} = {}) {
  const filter = await buildOfferListFilter({
    status,
    search,
    minDiscount,
    maxDiscount,
    includeWarehouseName: true,
  });
  const [{ rows, hasMore, nextCursor }, reviewCount] = await Promise.all([
    listPaginatedOffers(filter, { limit, after }),
    Offer.countDocuments(OFFER_REVIEW_FILTER),
  ]);
  if (rows.length === 0) return { rows: [], hasMore, nextCursor, reviewCount };
  return { rows: await attachRefs(rows), hasMore, nextCursor, reviewCount };
}

async function findModerableOfferOrThrow(offerId) {
  if (!mongoose.Types.ObjectId.isValid(offerId)) {
    throw ApiError.notFound('Offer not found.', 'OFFER_NOT_FOUND');
  }
  const offer = await Offer.findOne({ _id: offerId, ...MODERATION_QUEUE_FILTER });
  if (!offer) {
    throw ApiError.notFound('Offer not found.', 'OFFER_NOT_FOUND');
  }
  return offer;
}

async function findAnyOfferOrThrow(offerId) {
  if (!mongoose.Types.ObjectId.isValid(offerId)) {
    throw ApiError.notFound('Offer not found.', 'OFFER_NOT_FOUND');
  }
  const offer = await Offer.findById(offerId);
  if (!offer) {
    throw ApiError.notFound('Offer not found.', 'OFFER_NOT_FOUND');
  }
  return offer;
}

function applyPendingUpdate(offer) {
  const u = offer.pendingUpdate;
  offer.productId = u.productId;
  offer.titleAr = u.titleAr;
  offer.titleEn = u.titleEn;
  offer.discountPercentage = u.discountPercentage;
  offer.startDate = u.startDate;
  offer.endDate = u.isPermanent ? null : u.endDate;
  offer.isPermanent = u.isPermanent;
  offer.pendingUpdate = null;
}

// An admin's decision on (or edit/delete of) an offer. Every admin's queue
// needs it, and so does the one warehouse that owns the offer - it is the
// party waiting on the decision. Same payload to both rooms; the warehouse
// room is taken from the stored offer, never from the request.
function emitOfferStatus(offer, status) {
  const payload = {
    offerId: offer._id.toString(),
    warehouseId: offer.warehouseId.toString(),
    status,
  };
  emitToAdmins(EVENTS.OFFER_STATUS_UPDATED, payload);
  emitToWarehouse(offer.warehouseId, EVENTS.OFFER_STATUS_UPDATED, payload);
}

async function notifyPharmaciesOfNewOffer(offer) {
  // Never lets a notification hiccup undo the approval that already succeeded.
  // sendToAll's own per-user rate limiting caps this at one 'offer' push per
  // pharmacy per rolling 24h.
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
}

async function approveOffer(offerId, userId) {
  const offer = await findModerableOfferOrThrow(offerId);
  // A parked edit means the offer is already approved and live - approving it
  // applies the edit and keeps the offer live. Otherwise this is a brand-new
  // offer going live for the first time.
  const isEditApproval = offer.pendingUpdate != null;

  if (isEditApproval) {
    applyPendingUpdate(offer);
  } else {
    offer.status = 'approved';
  }
  offer.approvedBy = userId;
  offer.approvedAt = new Date();
  await offer.save();

  // Clears this offer from every other admin's open queue. Emitted before the
  // best-effort FCM block below - the queue shouldn't wait on a slow fan-out.
  emitOfferStatus(offer, 'approved');

  // Only a brand-new offer is a new deal to announce - re-approving an edit to
  // an already-live offer would just burn the pharmacy's one daily 'offer'
  // push on noise.
  if (!isEditApproval) {
    await notifyPharmaciesOfNewOffer(offer);
  }

  return offer;
}

// Section 8: the Offer schema has no "rejected" status. For a brand-new offer a
// rejection has nothing to record, so it just removes the pending row. For a
// parked edit, rejecting discards the proposed change and the live offer is
// left exactly as pharmacies already see it.
async function rejectOffer(offerId) {
  const offer = await findModerableOfferOrThrow(offerId);

  if (offer.pendingUpdate != null) {
    offer.pendingUpdate = null;
    await offer.save();
    emitOfferStatus(offer, 'update_rejected');
    return;
  }

  await offer.deleteOne();
  emitOfferStatus(offer, 'rejected');
}

// Section 6: the admin edits any offer directly - the admin IS the approval
// authority, so there is no buffer / re-review (unlike the warehouse's own
// updateOffer). The product must still belong to the offer's own warehouse,
// resolved from the stored offer, never from the client.
//
// A direct edit is refused while the warehouse has an edit parked on this
// offer: that proposal must be decided through the moderation flow
// (approve/reject) first, so the admin never silently overwrites it.
async function adminUpdateOffer(offerId, data) {
  const offer = await findAnyOfferOrThrow(offerId);
  if (offer.pendingUpdate != null) {
    throw ApiError.conflict(
      'This offer has a pending edit awaiting review.',
      'OFFER_HAS_PENDING_UPDATE'
    );
  }
  const { fields } = await buildOfferFields(offer.warehouseId, data);

  Object.assign(offer, fields);
  await offer.save();

  emitOfferStatus(offer, offer.status);

  return offer;
}

// Section 6: a hard delete, from any warehouse, really gone from the database.
async function adminDeleteOffer(offerId) {
  const offer = await findAnyOfferOrThrow(offerId);
  await offer.deleteOne();

  emitOfferStatus(offer, 'deleted');
}

module.exports = {
  listPendingOffers,
  listPaginatedAllOffers,
  approveOffer,
  rejectOffer,
  adminUpdateOffer,
  adminDeleteOffer,
};
