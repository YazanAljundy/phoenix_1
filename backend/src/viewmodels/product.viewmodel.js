const { computeDiscountedPriceUsd } = require('../services/manufacturerDiscount.service');

// TODO(seed-images): `image` is null for all current products - seeded
// without a real image API per the project owner's instruction (Unsplash key
// not chosen yet, Section 14). Once a provider is picked, backfill this field
// via the seed script; no shape change needed here, the client already
// handles a null image with a placeholder.
//
// Section 15: `discountPriceUsd` is the one number the Flutter catalog
// actually renders - it already has the manufacturer discount (if any)
// stacked with an active product-level Offer (if any), so the client just
// compares it against `priceUsd` rather than juggling two separate discount
// mechanisms. `offer` is kept alongside for whatever still wants the raw
// Offer details (title, its own percentage).
function serializeProductWithOffer({ product, offer, manufacturerDiscountPercentage }) {
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
    discountPriceUsd: computeDiscountedPriceUsd(
      product.price,
      offer ? offer.discountPercentage : null,
      manufacturerDiscountPercentage
    ),
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

// serializeProductWithOffer is exported so the reorder endpoint
// (order.viewmodel.js) can emit the exact same product shape the catalog
// browse does - one serializer, so the cart parses both identically.
module.exports = { toProductListResponse, serializeProductWithOffer };
