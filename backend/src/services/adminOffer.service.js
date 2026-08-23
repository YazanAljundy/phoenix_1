const mongoose = require('mongoose');
const { ApiError } = require('../utils/ApiError');
const Offer = require('../models/offer.model');
const Product = require('../models/product.model');
const Pharmacy = require('../models/pharmacy.model');
const Warehouse = require('../models/warehouse.model');
const { applyResolvedIdentity } = require('./productCatalog.service');
const notificationService = require('./notification.service');

// Section 13c: the admin's review queue - oldest first, same FIFO reasoning
// as the warehouse's own order queue (Section 13b).
async function listPendingOffers() {
  const offers = await Offer.find({ status: 'pending' }).sort({ createdAt: 1 });
  if (offers.length === 0) return [];

  const productIds = [...new Set(offers.map((o) => o.productId.toString()))];
  const warehouseIds = [...new Set(offers.map((o) => o.warehouseId.toString()))];

  const [products, warehouses] = await Promise.all([
    Product.find({ _id: { $in: productIds } }).populate('masterProductId'),
    Warehouse.find({ _id: { $in: warehouseIds } }),
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
}

module.exports = { listPendingOffers, approveOffer, rejectOffer };
