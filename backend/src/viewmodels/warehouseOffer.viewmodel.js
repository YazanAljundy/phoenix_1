// The warehouse's edit to an approved offer, parked until the admin decides.
// null on every offer that has no such edit waiting.
function serializePendingUpdate(pendingUpdate, product) {
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

function serializeOffer(offer, product, pendingUpdateProduct) {
  return {
    id: offer._id,
    productId: offer.productId,
    productNameAr: product ? product.nameAr : null,
    productNameEn: product ? product.nameEn : null,
    titleAr: offer.titleAr,
    titleEn: offer.titleEn,
    discountPercentage: offer.discountPercentage,
    startDate: offer.startDate,
    // null for a permanent offer - the client shows "permanent" instead of a
    // date range when isPermanent is true.
    endDate: offer.endDate,
    isPermanent: offer.isPermanent,
    status: offer.status,
    pendingUpdate: serializePendingUpdate(offer.pendingUpdate, pendingUpdateProduct),
    createdAt: offer.createdAt,
  };
}

function toOfferResponse(offer, product) {
  return { offer: serializeOffer(offer, product, null) };
}

function toOfferListResponse(rows) {
  return {
    offers: rows.map(({ offer, product, pendingUpdateProduct }) =>
      serializeOffer(offer, product, pendingUpdateProduct)
    ),
  };
}

module.exports = { toOfferResponse, toOfferListResponse };
