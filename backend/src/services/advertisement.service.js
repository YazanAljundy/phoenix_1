const mongoose = require('mongoose');
const { ApiError } = require('../utils/ApiError');
const Advertisement = require('../models/advertisement.model');
const Product = require('../models/product.model');
const Warehouse = require('../models/warehouse.model');
const { applyResolvedIdentity } = require('./productCatalog.service');
const { isWarehouseAvailable } = require('./warehouse.service');

// The pharmacist-facing side of warehouse advertisements. An advertisement is
// "live" only while it is approved AND inside its own date window - no cron
// job flips an expired one off, this same live filter is the only thing that
// ever hides one, on every read (identical reasoning to
// banner.service.listActiveBanners).
//
// Everything here is the server's word: the client only ever names an
// advertisement by id, and every price comes back out of the database.
function activeFilter(now = new Date()) {
  return { status: 'approved', startDate: { $lte: now }, endDate: { $gte: now } };
}

// Only what a card and a cart line actually need off a product.
const ADVERTISEMENT_PRODUCT_SELECT =
  'categoryId nameAr nameEn manufacturerAr manufacturerEn image unitAr unitEn price isAvailable masterProductId';
const CATALOG_IDENTITY_SELECT = 'nameAr nameEn manufacturerAr manufacturerEn';

// One $in for every advertisement in the list, however many items each holds -
// never a query per advertisement or per item.
async function loadProductsFor(advertisements) {
  const productIds = [
    ...new Set(advertisements.flatMap((ad) => ad.items.map((item) => item.productId.toString()))),
  ];
  if (productIds.length === 0) return new Map();

  const products = await Product.find({ _id: { $in: productIds }, isActive: true })
    .select(ADVERTISEMENT_PRODUCT_SELECT)
    .populate({ path: 'masterProductId', select: CATALOG_IDENTITY_SELECT });
  products.forEach(applyResolvedIdentity);
  return new Map(products.map((p) => [p._id.toString(), p]));
}

// Every advertisement a pharmacy may currently see. Pending, rejected, expired
// and not-yet-started ones are all excluded by the one filter above, which the
// {status, startDate, endDate} index backs directly.
async function listActiveAdvertisements() {
  const advertisements = await Advertisement.find(activeFilter()).sort({ createdAt: -1 });
  if (advertisements.length === 0) return [];

  const warehouseIds = [...new Set(advertisements.map((ad) => ad.warehouseId.toString()))];
  const [productById, warehouses] = await Promise.all([
    loadProductsFor(advertisements),
    Warehouse.find({ _id: { $in: warehouseIds }, isActive: true }).select('nameAr nameEn'),
  ]);
  const warehouseById = new Map(warehouses.map((w) => [w._id.toString(), w]));

  return (
    advertisements
      .map((advertisement) => ({
        advertisement,
        productById,
        warehouse: warehouseById.get(advertisement.warehouseId.toString()) ?? null,
      }))
      // A package whose warehouse has been paused or blocked has nowhere to be
      // ordered from - hidden for the same reason the catalog hides it.
      .filter((row) => row.warehouse !== null)
  );
}

// The single gate for "is this advertisement orderable right now". Both the
// cart-prefill endpoint and createOrder go through this, so the screen the
// pharmacist saw and the order the server accepts can never disagree about
// whether a package is still live.
async function loadActiveAdvertisementOrThrow(advertisementId) {
  if (!mongoose.Types.ObjectId.isValid(advertisementId)) {
    throw ApiError.notFound('This advertisement is no longer available.', 'ADVERTISEMENT_UNAVAILABLE');
  }
  const advertisement = await Advertisement.findOne({ _id: advertisementId, ...activeFilter() });
  if (!advertisement) {
    // One code for "never existed", "still pending", "rejected", "expired" and
    // "not started yet" alike - the pharmacist's next step is the same in
    // every case, and it leaks nothing about other warehouses' drafts.
    throw ApiError.notFound('This advertisement is no longer available.', 'ADVERTISEMENT_UNAVAILABLE');
  }
  return advertisement;
}

// Builds the cart payload for a tapped advertisement. Creates nothing.
//
// The response is deliberately shaped like order.service.prepareReorder's -
// { warehouse, items, unavailableItems } - so the Flutter cart reuses the
// parsing and the "some of these are gone" handling it already has, instead of
// growing a second cart-loading path.
async function prepareAdvertisementCart(advertisementId) {
  const advertisement = await loadActiveAdvertisementOrThrow(advertisementId);

  const warehouseAvailable = await isWarehouseAvailable(advertisement.warehouseId);
  if (!warehouseAvailable) {
    throw ApiError.notFound('This warehouse is no longer available.', 'WAREHOUSE_NOT_FOUND');
  }

  const productIds = advertisement.items.map((item) => item.productId);
  // Scoped to the advertisement's own warehouse: a product that has since
  // moved (or was never really there) can't be smuggled into the cart.
  const products = await Product.find({
    _id: { $in: productIds },
    warehouseId: advertisement.warehouseId,
    isActive: true,
  })
    .select(ADVERTISEMENT_PRODUCT_SELECT)
    .populate({ path: 'masterProductId', select: CATALOG_IDENTITY_SELECT });
  products.forEach(applyResolvedIdentity);
  const productById = new Map(products.map((p) => [p._id.toString(), p]));

  const warehouse = await Warehouse.findById(advertisement.warehouseId).select('nameAr nameEn');

  const items = [];
  const unavailableItems = [];
  for (const item of advertisement.items) {
    const product = productById.get(item.productId.toString());
    // Deactivated or currently-unavailable products are reported, never
    // silently dropped and never forced into a cart that would fail at
    // checkout anyway - same treatment reorder gives them.
    if (!product || !product.isAvailable) {
      unavailableItems.push({
        productId: item.productId,
        productNameAr: product ? product.nameAr : null,
        productNameEn: product ? product.nameEn : null,
        quantity: item.quantity,
      });
      continue;
    }
    // Each product at its advertised quantity, priced at the current catalog
    // price. The package total is the discount, applied once at the order
    // level.
    items.push({ product, quantity: item.quantity });
  }

  return { advertisement, warehouse, items, unavailableItems };
}

module.exports = {
  activeFilter,
  listActiveAdvertisements,
  loadActiveAdvertisementOrThrow,
  prepareAdvertisementCart,
};
