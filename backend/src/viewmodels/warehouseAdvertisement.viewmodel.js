// Allow-list serializer, same shape convention as warehouseOffer.viewmodel.js:
// prices cross the boundary spelled out as `*Usd`, never as the bare `price`
// the Mongoose field is called.
//
// A package carries no per-product price of its own: every `priceUsd` here is
// the product's CURRENT catalog price, read live. `null` means the product is
// gone (it can't be ordered in that state - createOrder rejects it).
function serializeItem(item, productById) {
  const product = productById.get(item.productId.toString()) ?? null;
  return {
    productId: item.productId,
    productNameAr: product ? product.nameAr : null,
    productNameEn: product ? product.nameEn : null,
    priceUsd: product ? product.price : null,
    quantity: item.quantity,
  };
}

// The quantity-weighted sum of the products' current catalog prices, and the
// saving % the package total represents against it. Both derived here so web,
// admin and the pharmacy app all show the same figure.
function itemsTotalUsd(items) {
  return (
    Math.round(items.reduce((sum, item) => sum + (item.priceUsd ?? 0) * (item.quantity ?? 1), 0) * 100) / 100
  );
}

function savingPercentage(sumUsd, totalPriceUsd) {
  if (!(sumUsd > 0)) return 0;
  // Clamped at 0: a total at or above the sum just means "no saving".
  return Math.max(0, Math.round(((sumUsd - totalPriceUsd) / sumUsd) * 100));
}

function serializeAdvertisement(advertisement, productById) {
  const items = advertisement.items.map((item) => serializeItem(item, productById));
  const sumUsd = itemsTotalUsd(items);
  return {
    id: advertisement._id,
    advertisementNumber: advertisement.advertisementNumber ?? null,
    titleAr: advertisement.titleAr,
    titleEn: advertisement.titleEn,
    items,
    calculatedItemsTotalUsd: sumUsd,
    totalPriceUsd: advertisement.totalPriceUsd,
    savingPercentage: savingPercentage(sumUsd, advertisement.totalPriceUsd),
    startDate: advertisement.startDate,
    endDate: advertisement.endDate,
    status: advertisement.status,
    rejectionNote: advertisement.rejectionNote,
    createdAt: advertisement.createdAt,
  };
}

function toAdvertisementResponse({ advertisement, productById }) {
  return { advertisement: serializeAdvertisement(advertisement, productById) };
}

function toAdvertisementListResponse(rows) {
  return {
    advertisements: rows.map(({ advertisement, productById }) =>
      serializeAdvertisement(advertisement, productById)
    ),
  };
}

module.exports = {
  serializeAdvertisement,
  toAdvertisementResponse,
  toAdvertisementListResponse,
  // Shared with advertisement.viewmodel.js so the pharmacy-facing shape
  // computes the same products-total and saving %.
  itemsTotalUsd,
  savingPercentage,
};
