// The pharmacist-facing shape of a warehouse advertisement package.
//
// Prices stay USD across the boundary (`*Usd`), like every other product price
// in this API - the Flutter client converts to SYP for display through its one
// existing currency formatter (core/utils/currency_formatter.dart).
//
// A package carries no per-product price: every `priceUsd` is the product's
// CURRENT catalog price. The package total (`totalPriceUsd`) is what the
// pharmacy pays; the gap between the sum of the catalog prices and that total
// is the saving.
const { itemsTotalUsd, savingPercentage } = require('./warehouseAdvertisement.viewmodel');

function serializeItem(item, productById) {
  const product = productById.get(item.productId.toString()) ?? null;
  return {
    productId: item.productId,
    nameAr: product ? product.nameAr : null,
    nameEn: product ? product.nameEn : null,
    image: product ? product.image : null,
    unitAr: product ? product.unitAr : null,
    unitEn: product ? product.unitEn : null,
    // The current catalog price. Null when the product is gone.
    priceUsd: product ? product.price : null,
    quantity: item.quantity,
    isAvailable: product ? product.isAvailable : false,
  };
}

function serializeActiveAdvertisement({ advertisement, productById, warehouse }) {
  const items = advertisement.items.map((item) => serializeItem(item, productById));
  const sumUsd = itemsTotalUsd(items);
  return {
    id: advertisement._id,
    titleAr: advertisement.titleAr,
    titleEn: advertisement.titleEn,
    warehouseId: advertisement.warehouseId,
    warehouseNameAr: warehouse ? warehouse.nameAr : null,
    warehouseNameEn: warehouse ? warehouse.nameEn : null,
    items,
    // The sum of the products' current catalog prices, next to the package
    // total - the difference is the saving. Derived, never stored.
    itemsTotalUsd: sumUsd,
    totalPriceUsd: advertisement.totalPriceUsd,
    savingPercentage: savingPercentage(sumUsd, advertisement.totalPriceUsd),
    endDate: advertisement.endDate,
  };
}

function toActiveAdvertisementsResponse(rows) {
  return { advertisements: rows.map(serializeActiveAdvertisement) };
}

// Deliberately the same { warehouse, items, unavailableItems } shape
// order.viewmodel.js's toReorderResponse emits, so the Flutter cart parses a
// tapped advertisement with the code it already has for a reorder. The only
// additions are the package's own identity and its two totals - the figures
// the cart needs to show the discount before checkout. They are display-only:
// createOrder re-reads all of them from the database and never trusts what
// the client sends back.
function toAdvertisementCartResponse({ advertisement, warehouse, items, unavailableItems }) {
  return {
    advertisementCart: {
      advertisementId: advertisement._id,
      titleAr: advertisement.titleAr,
      titleEn: advertisement.titleEn,
      warehouseId: advertisement.warehouseId,
      warehouseNameAr: warehouse ? warehouse.nameAr : null,
      warehouseNameEn: warehouse ? warehouse.nameEn : null,
      totalPriceUsd: advertisement.totalPriceUsd,
      // Quantity-weighted sum of the AVAILABLE items' current catalog prices -
      // the figure the cart shows the package discount against. A gone/
      // unavailable product isn't in `items`, and can't be ordered anyway.
      itemsTotalUsd:
        Math.round(items.reduce((sum, { product, quantity }) => sum + product.price * quantity, 0) * 100) /
        100,
      items: items.map(({ product, quantity }) => ({
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
        // The cart renders this as the line price, exactly as it renders a
        // catalog product's own discountPriceUsd. For a package line that is
        // the current catalog price; the package total is the discount,
        // applied once at the order level.
        discountPriceUsd: product.price,
        isAvailable: product.isAvailable,
        offer: null,
        quantity,
      })),
      unavailableItems: unavailableItems.map((item) => ({
        productId: item.productId,
        productNameAr: item.productNameAr,
        productNameEn: item.productNameEn,
        quantity: item.quantity,
      })),
    },
  };
}

module.exports = { toActiveAdvertisementsResponse, toAdvertisementCartResponse };
