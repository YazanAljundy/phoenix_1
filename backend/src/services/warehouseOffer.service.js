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

// Section 7/13c: an offer always starts 'pending' - only an admin can move it
// to 'approved' (adminOffer.service.js). The warehouse never sets its own
// offer live.
async function createOffer(warehouseId, data) {
  const product = await findOwnedProductOrThrow(data.productId, warehouseId);
  // Read-only from here on (never saved) - safe to resolve for the response,
  // see the Section 14 Part 2 note in adminProduct.service.js.
  await product.populate('masterProductId');
  applyResolvedIdentity(product);

  validateTitle(data.titleAr, 'titleAr');
  validateTitle(data.titleEn, 'titleEn');
  validateDiscountPercentage(data.discountPercentage);

  const startDate = parseDate(data.startDate);
  const endDate = parseDate(data.endDate);
  if (!startDate || !endDate || endDate <= startDate) {
    throw ApiError.badRequest('Invalid offer date range.', undefined, 'INVALID_DATE_RANGE');
  }

  const offer = await Offer.create({
    warehouseId,
    productId: product._id,
    titleAr: data.titleAr.trim(),
    titleEn: data.titleEn.trim(),
    discountPercentage: data.discountPercentage,
    startDate,
    endDate,
    status: 'pending',
  });

  // Straight into the admin moderation queue - an offer cannot go live until
  // an admin approves it, so the warehouse is blocked on that decision.
  emitToAdmins(EVENTS.OFFER_PENDING, {
    offerId: offer._id.toString(),
    warehouseId: String(warehouseId),
  });

  return { offer, product };
}

async function listOffersForWarehouse(warehouseId) {
  // warehouseOffer.viewmodel.js's serializeOffer reads id/productId/titleAr/
  // titleEn/discountPercentage/startDate/endDate/status/createdAt.
  const offers = await Offer.find({ warehouseId })
    .select('productId titleAr titleEn discountPercentage startDate endDate status createdAt')
    .sort({ createdAt: -1 });
  if (offers.length === 0) return [];

  const productIds = [...new Set(offers.map((o) => o.productId.toString()))];
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
  }));
}

module.exports = { createOffer, listOffersForWarehouse };
