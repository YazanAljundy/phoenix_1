const Offer = require('../models/offer.model');
const Product = require('../models/product.model');
const Warehouse = require('../models/warehouse.model');
const { applyResolvedIdentity } = require('./productCatalog.service');
const { getDiscountMapForWarehouse } = require('./manufacturerDiscount.service');

// The pharmacist-facing side of warehouse product offers - the "what is on
// promotion right now, everywhere" read behind the app's Offers & Ads tab.
//
// An offer is "live" only while it is approved AND inside its own date window;
// a permanent offer (isPermanent, endDate null) stays live from its start date
// on. No cron job flips an expired one off - this filter is the only thing
// that ever hides one, on every read (same reasoning as
// advertisement.service.activeFilter / banner.service.listActiveBanners).
//
// Exported because product.service.js's per-warehouse catalog read applies the
// exact same predicate: the two must never disagree about whether an offer is
// running, or the catalog and the offers tab would show different prices.
function activeOfferFilter(now = new Date()) {
  return {
    status: 'approved',
    startDate: { $lte: now },
    $or: [{ isPermanent: true }, { endDate: { $gte: now } }],
  };
}

// Only what an offer card actually needs off a product, plus warehouseId (the
// ownership check below) and masterProductId (the populate key for the
// resolved identity - Section 14 Part 2).
const OFFER_PRODUCT_SELECT =
  'warehouseId nameAr nameEn manufacturerAr manufacturerEn image unitAr unitEn price isAvailable masterProductId';
const CATALOG_IDENTITY_SELECT = 'nameAr nameEn manufacturerAr manufacturerEn';

// Every offer a pharmacy may currently see, across every warehouse. Pending,
// expired and not-yet-started ones are all excluded by the one filter above,
// which the {status, startDate, endDate} index backs directly.
//
// `pendingUpdate` is deliberately never read: a warehouse's proposed edit to
// an already-approved offer is not what pharmacies see until an admin
// approves it (see offer.model.js).
async function listActiveOffers() {
  // .lean(): read-only, straight into offer.viewmodel.js.
  const offers = await Offer.find(activeOfferFilter())
    .select('titleAr titleEn discountPercentage startDate endDate isPermanent warehouseId productId')
    .sort({ createdAt: -1 })
    .lean();
  if (offers.length === 0) return [];

  const productIds = [...new Set(offers.map((offer) => offer.productId.toString()))];
  const warehouseIds = [...new Set(offers.map((offer) => offer.warehouseId.toString()))];

  // One $in per collection for the whole list, never a query per offer.
  const [products, warehouses] = await Promise.all([
    Product.find({ _id: { $in: productIds }, isActive: true })
      .select(OFFER_PRODUCT_SELECT)
      .populate({ path: 'masterProductId', select: CATALOG_IDENTITY_SELECT })
      .lean(),
    Warehouse.find({ _id: { $in: warehouseIds }, isActive: true }).select('nameAr nameEn').lean(),
  ]);
  products.forEach(applyResolvedIdentity);
  const productById = new Map(products.map((p) => [p._id.toString(), p]));
  const warehouseById = new Map(warehouses.map((w) => [w._id.toString(), w]));

  // Section 15: the warehouse's standing manufacturer discount stacks with the
  // offer, exactly as it does in the catalog - fetched once per warehouse that
  // actually has a live offer, not once per offer.
  const discountMapEntries = await Promise.all(
    warehouseIds
      .filter((id) => warehouseById.has(id))
      .map(async (id) => [id, await getDiscountMapForWarehouse(id)])
  );
  const discountMapByWarehouseId = new Map(discountMapEntries);

  return offers
    .map((offer) => {
      const warehouseId = offer.warehouseId.toString();
      const product = productById.get(offer.productId.toString()) ?? null;
      return {
        offer,
        product,
        warehouse: warehouseById.get(warehouseId) ?? null,
        manufacturerDiscountPercentage: product
          ? discountMapByWarehouseId.get(warehouseId)?.get(product.manufacturerAr) ?? null
          : null,
      };
    })
    .filter(
      (row) =>
        // A paused/blocked warehouse has nowhere to sell from, a deleted or
        // deactivated product has nothing to discount, and a product that has
        // since moved to another warehouse is not this warehouse's to promote
        // - all hidden for the same reasons the catalog hides them.
        row.warehouse !== null &&
        row.product !== null &&
        row.product.warehouseId.toString() === row.offer.warehouseId.toString()
    );
}

module.exports = { activeOfferFilter, listActiveOffers };
