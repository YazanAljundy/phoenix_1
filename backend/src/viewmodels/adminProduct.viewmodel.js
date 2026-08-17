function serializeAdminProduct({ product, warehouse }) {
  return {
    id: product._id,
    warehouseId: product.warehouseId,
    warehouseNameAr: warehouse ? warehouse.nameAr : null,
    warehouseNameEn: warehouse ? warehouse.nameEn : null,
    categoryId: product.categoryId,
    nameAr: product.nameAr,
    nameEn: product.nameEn,
    manufacturerAr: product.manufacturerAr,
    manufacturerEn: product.manufacturerEn,
    description: product.description,
    image: product.image,
    unitAr: product.unitAr,
    unitEn: product.unitEn,
    priceUsd: product.price,
    isAvailable: product.isAvailable,
    manuallyDisabled: product.manuallyDisabled,
    isActive: product.isActive,
    lastPriceUpdate: product.lastPriceUpdate,
    createdAt: product.createdAt,
  };
}

function toAdminProductListResponse(rows) {
  return { products: rows.map(serializeAdminProduct) };
}

function toAdminProductResponse(product) {
  return { product: serializeAdminProduct({ product, warehouse: null }) };
}

module.exports = { toAdminProductListResponse, toAdminProductResponse };
