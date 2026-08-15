function serializePendingOffer({ offer, product, warehouse }) {
  return {
    id: offer._id,
    titleAr: offer.titleAr,
    titleEn: offer.titleEn,
    discountPercentage: offer.discountPercentage,
    startDate: offer.startDate,
    endDate: offer.endDate,
    createdAt: offer.createdAt,
    productNameAr: product ? product.nameAr : null,
    productNameEn: product ? product.nameEn : null,
    productPrice: product ? product.price : null,
    warehouseNameAr: warehouse ? warehouse.nameAr : null,
    warehouseNameEn: warehouse ? warehouse.nameEn : null,
  };
}

function toPendingOffersResponse(rows) {
  return { offers: rows.map(serializePendingOffer) };
}

module.exports = { toPendingOffersResponse };
