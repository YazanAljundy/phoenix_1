function serializeAdminBanner({ banner, warehouse, product }) {
  return {
    id: banner._id,
    bannerNumber: banner.bannerNumber,
    imageUrl: banner.imageUrl,
    productId: banner.productId,
    productNameAr: product ? product.nameAr : null,
    productNameEn: product ? product.nameEn : null,
    manufacturerAr: banner.manufacturerAr,
    title: banner.title,
    status: banner.status,
    rejectionNote: banner.rejectionNote,
    startDate: banner.startDate,
    endDate: banner.endDate,
    warehouseId: banner.warehouseId,
    warehouseNameAr: warehouse ? warehouse.nameAr : null,
    warehouseNameEn: warehouse ? warehouse.nameEn : null,
    createdAt: banner.createdAt,
  };
}

function toAdminBannersResponse(rows) {
  return { banners: rows.map(serializeAdminBanner) };
}

function toAdminBannerResponse(banner) {
  return { banner: serializeAdminBanner({ banner, warehouse: null, product: null }) };
}

module.exports = { toAdminBannersResponse, toAdminBannerResponse };
