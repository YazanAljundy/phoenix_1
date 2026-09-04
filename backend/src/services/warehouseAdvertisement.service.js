const mongoose = require('mongoose');
const { ApiError } = require('../utils/ApiError');
const Advertisement = require('../models/advertisement.model');
const Product = require('../models/product.model');
const Counter = require('../models/counter.model');
const { applyResolvedIdentity } = require('./productCatalog.service');
const { emitToAdmins, EVENTS } = require('../realtime');

// Same atomic $inc pattern as Banner's nextBannerNumber (warehouseBanner.service.js).
async function nextAdvertisementNumber() {
  const counter = await Counter.findOneAndUpdate(
    { _id: 'advertisement_number' },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );
  return counter.seq;
}

// Same three checks warehouseOffer.service.js runs on its own title/date
// fields - an advertisement is moderated content too, so it is held to the
// same shape.
function validateTitle(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw ApiError.badRequest(`Invalid ${field}.`, undefined, 'INVALID_ADVERTISEMENT_TITLE');
  }
}

function parseDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function validateDateRange(startDate, endDate) {
  if (!startDate || !endDate || endDate <= startDate) {
    throw ApiError.badRequest('Invalid advertisement date range.', undefined, 'INVALID_DATE_RANGE');
  }
}

// USD, like Product.price - mirrors validatePrice in
// warehouseProduct.service.js, including the "> 0, not just >= 0" rule (a
// zero-priced package is a giveaway, not a price, and there is no existing
// flow for one).
function validatePriceUsd(value, code) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw ApiError.badRequest('Invalid price.', undefined, code);
  }
}

// Normalizes and fully validates the incoming `items` array, and confirms in
// ONE query that every product belongs to the warehouse building the
// advertisement. Deliberately not findOwnedProductOrThrow in a loop: that is
// an N+1 that grows with the size of the package.
//
// An item is a productId + a quantity - a package carries no per-product
// price. Each product's price is always its current catalog price, read live
// wherever the package is shown or ordered.
async function validateItems(rawItems, warehouseId) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw ApiError.badRequest(
      'An advertisement needs at least one product.',
      undefined,
      'ADVERTISEMENT_ITEMS_REQUIRED'
    );
  }

  const items = rawItems.map((item) => {
    if (!item || typeof item.productId !== 'string' || !mongoose.Types.ObjectId.isValid(item.productId)) {
      throw ApiError.notFound('Product not found.', 'PRODUCT_NOT_FOUND');
    }
    const quantity = item.quantity === undefined ? 1 : item.quantity;
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw ApiError.badRequest(
        'Invalid quantity.',
        undefined,
        'INVALID_ADVERTISEMENT_QUANTITY'
      );
    }
    return { productId: item.productId, quantity };
  });

  const productIds = items.map((item) => item.productId);
  if (new Set(productIds).size !== productIds.length) {
    throw ApiError.badRequest(
      'The same product cannot be added twice.',
      undefined,
      'DUPLICATE_ADVERTISEMENT_PRODUCT'
    );
  }

  // isActive: true for the same reason listProductsForWarehouse filters on it
  // - a product an admin has deactivated is gone from the warehouse's own
  // catalog, so it can't be advertised either.
  const owned = await Product.find({ _id: { $in: productIds }, warehouseId, isActive: true }).select('_id');
  if (owned.length !== productIds.length) {
    // Same 404 (not 403) a direct product lookup gives - an id belonging to
    // someone else's warehouse must be indistinguishable from one that
    // doesn't exist.
    throw ApiError.notFound('Product not found.', 'PRODUCT_NOT_FOUND');
  }

  return items;
}

// Everything a create and an update both validate. `totalPriceUsd` is
// deliberately NOT constrained against the sum of the products' catalog prices:
// a total that isn't below that sum just means "no saving", which the panel
// warns about but is allowed to save.
async function buildAdvertisementFields(warehouseId, data) {
  validateTitle(data.titleAr, 'titleAr');
  validateTitle(data.titleEn, 'titleEn');

  const startDate = parseDate(data.startDate);
  const endDate = parseDate(data.endDate);
  validateDateRange(startDate, endDate);

  const items = await validateItems(data.items, warehouseId);
  validatePriceUsd(data.totalPriceUsd, 'INVALID_TOTAL_PRICE');

  return {
    titleAr: data.titleAr.trim(),
    titleEn: data.titleEn.trim(),
    items,
    totalPriceUsd: data.totalPriceUsd,
    startDate,
    endDate,
  };
}

async function findOwnedAdvertisementOrThrow(advertisementId, warehouseId) {
  if (!mongoose.Types.ObjectId.isValid(advertisementId)) {
    throw ApiError.notFound('Advertisement not found.', 'ADVERTISEMENT_NOT_FOUND');
  }
  // IDOR guard: scoped to warehouseId, same pattern as findOwnedProductOrThrow.
  const advertisement = await Advertisement.findOne({ _id: advertisementId, warehouseId });
  if (!advertisement) {
    throw ApiError.notFound('Advertisement not found.', 'ADVERTISEMENT_NOT_FOUND');
  }
  return advertisement;
}

// Resolves each item's product name for the response. One $in query for the
// whole list, however many advertisements and items it holds.
async function attachProducts(advertisements) {
  const productIds = [
    ...new Set(advertisements.flatMap((ad) => ad.items.map((item) => item.productId.toString()))),
  ];
  if (productIds.length === 0) return advertisements.map((advertisement) => ({ advertisement, productById: new Map() }));

  // `price` is the current catalog price shown next to each line and summed
  // into the package's products-total; the four identity fields feed
  // applyResolvedIdentity (resolved off the product or its linked catalog
  // entry).
  const products = await Product.find({ _id: { $in: productIds } })
    .select('nameAr nameEn manufacturerAr manufacturerEn price masterProductId')
    .populate({ path: 'masterProductId', select: 'nameAr nameEn manufacturerAr manufacturerEn' });
  products.forEach(applyResolvedIdentity);
  const productById = new Map(products.map((p) => [p._id.toString(), p]));

  return advertisements.map((advertisement) => ({ advertisement, productById }));
}

// An advertisement always starts 'pending' - only an admin can move it to
// 'approved' (adminAdvertisement.service.js). The warehouse never puts its own
// package live, same rule Offers and Banners follow.
async function createAdvertisement(warehouseId, data) {
  const fields = await buildAdvertisementFields(warehouseId, data);

  const advertisement = await Advertisement.create({
    warehouseId,
    advertisementNumber: await nextAdvertisementNumber(),
    ...fields,
    status: 'pending',
  });

  emitToAdmins(EVENTS.ADVERTISEMENT_PENDING, {
    advertisementId: advertisement._id.toString(),
    warehouseId: String(warehouseId),
  });

  const [row] = await attachProducts([advertisement]);
  return row;
}

// Editable at any status - the request calls out that the total price in
// particular must stay editable after the fact. An edit to an advertisement
// that is already live (or was rejected) sends it back through moderation:
// its content has changed, so the previous decision no longer applies to it.
async function updateAdvertisement(advertisementId, warehouseId, data) {
  const advertisement = await findOwnedAdvertisementOrThrow(advertisementId, warehouseId);
  const fields = await buildAdvertisementFields(warehouseId, data);

  Object.assign(advertisement, fields);

  // Lazy backfill for a row created before advertisementNumber existed - so an
  // edit doesn't have to migrate the whole collection first, and the row has a
  // number the moment anyone touches it.
  if (advertisement.advertisementNumber == null) {
    advertisement.advertisementNumber = await nextAdvertisementNumber();
  }

  const wasModerated = advertisement.status !== 'pending';
  if (wasModerated) {
    advertisement.status = 'pending';
    advertisement.rejectionNote = null;
    advertisement.approvedBy = null;
    advertisement.approvedAt = null;
  }

  await advertisement.save();

  // Only re-queued content is announced - an edit to something already
  // sitting in the queue doesn't need a second signal.
  if (wasModerated) {
    emitToAdmins(EVENTS.ADVERTISEMENT_PENDING, {
      advertisementId: advertisement._id.toString(),
      warehouseId: String(warehouseId),
    });
  }

  const [row] = await attachProducts([advertisement]);
  return row;
}

async function deleteAdvertisement(advertisementId, warehouseId) {
  const advertisement = await findOwnedAdvertisementOrThrow(advertisementId, warehouseId);
  await advertisement.deleteOne();

  // A pending advertisement was occupying the admin queue - tell the panel to
  // drop it, the same way rejectOffer does when it removes a row.
  if (advertisement.status === 'pending') {
    emitToAdmins(EVENTS.ADVERTISEMENT_STATUS_UPDATED, {
      advertisementId: advertisement._id.toString(),
      warehouseId: String(warehouseId),
      status: 'deleted',
    });
  }
}

async function listAdvertisementsForWarehouse(warehouseId) {
  const advertisements = await Advertisement.find({ warehouseId }).sort({ createdAt: -1 });
  if (advertisements.length === 0) return [];
  return attachProducts(advertisements);
}

module.exports = {
  createAdvertisement,
  updateAdvertisement,
  deleteAdvertisement,
  listAdvertisementsForWarehouse,
  findOwnedAdvertisementOrThrow,
};
