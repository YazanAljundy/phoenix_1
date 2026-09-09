// Everything a product row shows. Deliberately WITHOUT priceHistory: that
// array grows one entry per price edit and one per re-import, forever, and
// including it here meant every list response - including the unpaginated
// ones the banner/offer product pickers use - shipped every price a
// warehouse had ever set on every product it owns. It belongs to the single
// product's own response, below.
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
    priceUsd: product.price,
    isAvailable: product.isAvailable,
    manuallyDisabled: product.manuallyDisabled,
    lastPriceUpdate: product.lastPriceUpdate,
    createdAt: product.createdAt,
  };
}

// The create/update response for one product, which is the only place the
// history is actually readable - and the only place the caller has already
// paid for loading the whole document anyway.
function serializeProductWithHistory(product) {
  return {
    ...serializeProduct(product),
    priceHistory: (product.priceHistory || []).map((entry) => ({
      oldPriceUsd: entry.oldPrice,
      newPriceUsd: entry.newPrice,
      changedAt: entry.changedAt,
    })),
  };
}

function toProductResponse(product) {
  return { product: serializeProductWithHistory(product) };
}

function toProductListResponse(products) {
  return { products: products.map(serializeProduct) };
}

module.exports = { toProductResponse, toProductListResponse };
