function serializeOffer(offer, product) {
  return {
    id: offer._id,
    productId: offer.productId,
    productNameAr: product ? product.nameAr : null,
    productNameEn: product ? product.nameEn : null,
    titleAr: offer.titleAr,
    titleEn: offer.titleEn,
    discountPercentage: offer.discountPercentage,
    startDate: offer.startDate,
    endDate: offer.endDate,
    status: offer.status,
    createdAt: offer.createdAt,
  };
}

function toOfferResponse(offer, product) {
  return { offer: serializeOffer(offer, product) };
}

function toOfferListResponse(rows) {
  return { offers: rows.map(({ offer, product }) => serializeOffer(offer, product)) };
}

module.exports = { toOfferResponse, toOfferListResponse };
