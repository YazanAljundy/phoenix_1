const { computeDiscountedPriceUsd } = require('../services/manufacturerDiscount.service');

// The pharmacist-facing shape of a warehouse product offer, as the Offers &
// Ads tab lists it.
//
// Prices stay USD across the boundary (`*Usd`), like every other product price
// in this API - the Flutter client converts to SYP for display through its one
// existing currency formatter (core/utils/currency_formatter.dart).
//
// `discountPriceUsd` is computed by the very function the catalog listing uses
// (product.viewmodel.js -> computeDiscountedPriceUsd), with the same inputs, so
// the price shown here and the price shown on the catalog card for the same
// product are the same number by construction. Nothing new is calculated here.
function serializeActiveOffer({ offer, product, warehouse, manufacturerDiscountPercentage }) {
  return {
    id: offer._id,
    titleAr: offer.titleAr,
    titleEn: offer.titleEn,
    discountPercentage: offer.discountPercentage,
    startDate: offer.startDate,
    // null on a permanent offer - `isPermanent` is what the client checks, so
    // it never has to infer "no expiry" from a missing date.
    endDate: offer.endDate,
    isPermanent: Boolean(offer.isPermanent),
    warehouseId: offer.warehouseId,
    warehouseNameAr: warehouse.nameAr,
    warehouseNameEn: warehouse.nameEn,
    // The offer's product, flattened onto the offer: a card shows one product,
    // and a nested object would buy nothing.
    productId: product._id,
    nameAr: product.nameAr,
    nameEn: product.nameEn,
    // The client navigates into the existing warehouse -> manufacturer ->
    // catalog flow with this, exactly as a tapped banner does.
    manufacturerAr: product.manufacturerAr,
    manufacturerEn: product.manufacturerEn,
    image: product.image,
    unitAr: product.unitAr,
    unitEn: product.unitEn,
    priceUsd: product.price,
    discountPriceUsd: computeDiscountedPriceUsd(
      product.price,
      offer.discountPercentage,
      manufacturerDiscountPercentage
    ),
    isAvailable: product.isAvailable,
  };
}

function toActiveOffersResponse(rows) {
  return { offers: rows.map(serializeActiveOffer) };
}

module.exports = { toActiveOffersResponse };
