const mongoose = require('mongoose');
const { ApiError } = require('../utils/ApiError');
const Offer = require('../models/offer.model');
const Product = require('../models/product.model');
const { findOwnedProductOrThrow } = require('./warehouseProduct.service');
const { applyResolvedIdentity } = require('./productCatalog.service');
const { emitToAdmins, EVENTS } = require('../realtime');

function validateTitle(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw ApiError.badRequest(`Invalid ${field}.`, undefined, 'INVALID_OFFER_TITLE');
  }
}

function validateDiscountPercentage(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 100) {
    throw ApiError.badRequest(
      'Discount percentage must be between 1 and 100.',
      undefined,
      'INVALID_DISCOUNT_PERCENTAGE'
    );
  }
}

function parseDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Everything a create and an update both validate. A permanent offer keeps its
// start date (it is "live from then on") but has no end date - `endDate` is
// null and `isPermanent` true, and the two are always written together so no
// caller has to infer one from the other. Returns the resolved product too,
// since the response shows its name next to the offer.
async function buildOfferFields(warehouseId, data) {
  const product = await findOwnedProductOrThrow(data.productId, warehouseId);
  // Read-only from here on (never saved) - safe to resolve for the response,
  // see the Section 14 Part 2 note in adminProduct.service.js.
  await product.populate('masterProductId');
  applyResolvedIdentity(product);

  validateTitle(data.titleAr, 'titleAr');
  validateTitle(data.titleEn, 'titleEn');
  validateDiscountPercentage(data.discountPercentage);

  const isPermanent = data.isPermanent === true;
  const startDate = parseDate(data.startDate);
  if (!startDate) {
    throw ApiError.badRequest('Invalid offer date range.', undefined, 'INVALID_DATE_RANGE');
  }

  let endDate = null;
  if (!isPermanent) {
    endDate = parseDate(data.endDate);
    if (!endDate || endDate <= startDate) {
      throw ApiError.badRequest('Invalid offer date range.', undefined, 'INVALID_DATE_RANGE');
    }
  }

  return {
    fields: {
      productId: product._id,
      titleAr: data.titleAr.trim(),
      titleEn: data.titleEn.trim(),
      discountPercentage: data.discountPercentage,
      startDate,
      endDate,
      isPermanent,
    },
    product,
  };
}

// IDOR guard: scoped to warehouseId, same pattern as findOwnedProductOrThrow /
// findOwnedAdvertisementOrThrow. A warehouse can only ever reach its own offers.
async function findOwnedOfferOrThrow(offerId, warehouseId) {
  if (!mongoose.Types.ObjectId.isValid(offerId)) {
    throw ApiError.notFound('Offer not found.', 'OFFER_NOT_FOUND');
  }
  const offer = await Offer.findOne({ _id: offerId, warehouseId });
  if (!offer) {
    throw ApiError.notFound('Offer not found.', 'OFFER_NOT_FOUND');
  }
  return offer;
}

// Section 7/13c: an offer always starts 'pending' - only an admin can move it
// to 'approved' (adminOffer.service.js). The warehouse never sets its own
// offer live.
async function createOffer(warehouseId, data) {
  const { fields, product } = await buildOfferFields(warehouseId, data);

  const offer = await Offer.create({ warehouseId, ...fields, status: 'pending' });

  // Straight into the admin moderation queue - an offer cannot go live until
  // an admin approves it, so the warehouse is blocked on that decision.
  emitToAdmins(EVENTS.OFFER_PENDING, {
    offerId: offer._id.toString(),
    warehouseId: String(warehouseId),
  });

  return { offer, product };
}

// An edit follows the offer's own approval flow (Section 3 of the request):
// - a still-pending offer is not live yet, so the edit is applied in place and
//   just waits in the same queue it was already in;
// - an approved offer stays exactly as pharmacies see it - the proposed change
//   is parked in `pendingUpdate` and the admin decides (approveOffer applies
//   it, rejectOffer discards it).
async function updateOffer(offerId, warehouseId, data) {
  const offer = await findOwnedOfferOrThrow(offerId, warehouseId);
  const { fields, product } = await buildOfferFields(warehouseId, data);

  if (offer.status === 'pending') {
    Object.assign(offer, fields);
    await offer.save();
    // Already in the queue - no second signal (same rule as advertisements).
    return { offer, product };
  }

  const alreadyQueued = offer.pendingUpdate != null;
  offer.pendingUpdate = { ...fields, requestedAt: new Date() };
  await offer.save();

  // Only announce a change that has newly entered the queue.
  if (!alreadyQueued) {
    emitToAdmins(EVENTS.OFFER_PENDING, {
      offerId: offer._id.toString(),
      warehouseId: String(warehouseId),
    });
  }

  return { offer, product };
}

// Section 4: the warehouse deletes its own offer outright - no admin approval,
// the row is really gone. If it was occupying the admin queue (a brand-new
// offer, or one with a parked edit) the panel is told to drop it, the same way
// deleteAdvertisement does.
async function deleteOffer(offerId, warehouseId) {
  const offer = await findOwnedOfferOrThrow(offerId, warehouseId);
  const wasInQueue = offer.status === 'pending' || offer.pendingUpdate != null;
  await offer.deleteOne();

  if (wasInQueue) {
    emitToAdmins(EVENTS.OFFER_STATUS_UPDATED, {
      offerId: offer._id.toString(),
      warehouseId: String(warehouseId),
      status: 'deleted',
    });
  }
}

async function listOffersForWarehouse(warehouseId) {
  // warehouseOffer.viewmodel.js's serializeOffer reads id/productId/titleAr/
  // titleEn/discountPercentage/startDate/endDate/isPermanent/status/pendingUpdate/
  // createdAt.
  const offers = await Offer.find({ warehouseId })
    .select(
      'productId titleAr titleEn discountPercentage startDate endDate isPermanent status pendingUpdate createdAt'
    )
    .sort({ createdAt: -1 });
  if (offers.length === 0) return [];

  // A parked edit can point at a different product than the live offer - both
  // names are shown, so gather ids from both.
  const productIds = [
    ...new Set(
      offers.flatMap((o) => [
        o.productId.toString(),
        o.pendingUpdate ? o.pendingUpdate.productId.toString() : null,
      ]).filter(Boolean)
    ),
  ];
  // Only the product's resolved name is shown next to an offer -
  // applyResolvedIdentity reads the four identity fields from the product or
  // its linked catalog entry, nothing else.
  const products = await Product.find({ _id: { $in: productIds } })
    .select('nameAr nameEn manufacturerAr manufacturerEn masterProductId')
    .populate({ path: 'masterProductId', select: 'nameAr nameEn manufacturerAr manufacturerEn' });
  products.forEach(applyResolvedIdentity);
  const productById = new Map(products.map((p) => [p._id.toString(), p]));

  return offers.map((offer) => ({
    offer,
    product: productById.get(offer.productId.toString()) ?? null,
    pendingUpdateProduct: offer.pendingUpdate
      ? productById.get(offer.pendingUpdate.productId.toString()) ?? null
      : null,
  }));
}

module.exports = {
  createOffer,
  updateOffer,
  deleteOffer,
  listOffersForWarehouse,
  findOwnedOfferOrThrow,
  buildOfferFields,
};
