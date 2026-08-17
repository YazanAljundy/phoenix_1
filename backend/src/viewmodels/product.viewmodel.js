// TODO(seed-images): `image` is null for all current products - seeded
// without a real image API per the project owner's instruction (Unsplash key
// not chosen yet, Section 14). Once a provider is picked, backfill this field
// via the seed script; no shape change needed here, the client already
// handles a null image with a placeholder.
function serializeProductWithOffer({ product, offer }) {
  const base = {
    id: product._id,
    categoryId: product.categoryId,
    nameAr: product.nameAr,
    nameEn: product.nameEn,
    manufacturerAr: product.manufacturerAr,
    manufacturerEn: product.manufacturerEn,
    image: product.image,
    unitAr: product.unitAr,
    unitEn: product.unitEn,
    priceUsd: product.price,
    isAvailable: product.isAvailable,
    offer: null,
  };

  if (offer) {
    base.offer = {
      titleAr: offer.titleAr,
      titleEn: offer.titleEn,
      discountPercentage: offer.discountPercentage,
      discountPriceUsd: Math.round(product.price * (1 - offer.discountPercentage / 100) * 100) / 100,
    };
  }

  return base;
}

function toProductListResponse(items) {
  return { products: items.map(serializeProductWithOffer) };
}

module.exports = { toProductListResponse };
