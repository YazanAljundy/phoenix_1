function serializeProduct(product) {
  return {
    id: product._id,
    categoryId: product.categoryId,
    nameAr: product.nameAr,
    nameEn: product.nameEn,
    manufacturerAr: product.manufacturerAr,
    manufacturerEn: product.manufacturerEn,
    description: product.description,
    image: product.image,
    unitAr: product.unitAr,
    unitEn: product.unitEn,
    price: product.price,
    stockQuantity: product.stockQuantity,
    isAvailable: product.isAvailable,
    manuallyDisabled: product.manuallyDisabled,
    lastPriceUpdate: product.lastPriceUpdate,
    priceHistory: (product.priceHistory || []).map((entry) => ({
      oldPrice: entry.oldPrice,
      newPrice: entry.newPrice,
      changedAt: entry.changedAt,
    })),
    createdAt: product.createdAt,
  };
}

function toProductResponse(product) {
  return { product: serializeProduct(product) };
}

function toProductListResponse(products) {
  return { products: products.map(serializeProduct) };
}

module.exports = { toProductResponse, toProductListResponse };
