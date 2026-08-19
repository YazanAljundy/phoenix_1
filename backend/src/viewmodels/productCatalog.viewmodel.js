function serializeCatalogItem(item) {
  return {
    id: item._id,
    nameAr: item.nameAr,
    nameEn: item.nameEn,
    manufacturerAr: item.manufacturerAr,
    manufacturerEn: item.manufacturerEn,
    categoryId: item.categoryId,
    unitAr: item.unitAr,
    unitEn: item.unitEn,
    priceUsd: item.priceUsd,
    isActive: item.isActive,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function toCatalogItemResponse(item) {
  return { item: serializeCatalogItem(item) };
}

function toCatalogListResponse(items) {
  return { items: items.map(serializeCatalogItem) };
}

module.exports = { serializeCatalogItem, toCatalogItemResponse, toCatalogListResponse };
