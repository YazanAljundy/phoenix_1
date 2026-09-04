// The warehouse's proposed edit to an already-approved offer, shown next to the
// live offer so the admin can compare Current vs Proposed. null unless an edit
// is waiting.
function serializeProposedOffer(pendingUpdate, product) {
  if (!pendingUpdate) return null;
  return {
    productId: pendingUpdate.productId,
    productNameAr: product ? product.nameAr : null,
    productNameEn: product ? product.nameEn : null,
    titleAr: pendingUpdate.titleAr,
    titleEn: pendingUpdate.titleEn,
    discountPercentage: pendingUpdate.discountPercentage,
    startDate: pendingUpdate.startDate,
    endDate: pendingUpdate.endDate,
    isPermanent: pendingUpdate.isPermanent,
    requestedAt: pendingUpdate.requestedAt,
  };
}

function serializeOffer({ offer, product, pendingUpdateProduct, warehouse }) {
  return {
    id: offer._id,
    warehouseId: offer.warehouseId,
    warehouseNameAr: warehouse ? warehouse.nameAr : null,
    warehouseNameEn: warehouse ? warehouse.nameEn : null,
    productId: offer.productId,
    productNameAr: product ? product.nameAr : null,
    productNameEn: product ? product.nameEn : null,
    productPriceUsd: product ? product.price : null,
    titleAr: offer.titleAr,
    titleEn: offer.titleEn,
    discountPercentage: offer.discountPercentage,
    startDate: offer.startDate,
    endDate: offer.endDate,
    isPermanent: offer.isPermanent,
    status: offer.status,
    pendingUpdate: serializeProposedOffer(offer.pendingUpdate, pendingUpdateProduct),
    createdAt: offer.createdAt,
  };
}

// The moderation queue (Dashboard + the Offers page's "Review queue" filter).
function toPendingOffersResponse(rows) {
  return { offers: rows.map(serializeOffer) };
}

// Every offer, every warehouse, every status (Section 5).
function toOffersResponse(rows) {
  return { offers: rows.map(serializeOffer) };
}

module.exports = { toPendingOffersResponse, toOffersResponse };
