const WarehouseManufacturer = require('../models/warehouseManufacturer.model');
const Product = require('../models/product.model');
const ProductCatalog = require('../models/productCatalog.model');

// Registers every manufacturer discovered in an Excel import (Section 15
// follow-up) - upsert only, so a manufacturer that stops appearing in a
// later import is never removed. Safe to call with duplicates in the list.
async function registerManufacturers(warehouseId, manufacturerNames) {
  await Promise.all(
    manufacturerNames.map((manufacturerAr) =>
      WarehouseManufacturer.findOneAndUpdate(
        { warehouseId, manufacturerAr },
        { $setOnInsert: { warehouseId, manufacturerAr } },
        { upsert: true }
      )
    )
  );
}

async function listManufacturersForWarehouse(warehouseId) {
  // Only the manufacturer name is read out of each row.
  const rows = await WarehouseManufacturer.find({ warehouseId })
    .select('manufacturerAr')
    .sort({ manufacturerAr: 1 });
  return rows.map((row) => row.manufacturerAr);
}

// The companies actually represented in this warehouse's catalog, each with
// how many products it has there. Backs the catalog page's company list.
//
// Deliberately NOT listManufacturersForWarehouse above: that reads the import
// registry, which only ever grows from Excel uploads (registerManufacturers)
// - it lists companies whose products have all since been removed, and misses
// every product added through the "Add product" form, whose manufacturer comes
// from the central catalog and is never registered here. Browsing a catalog by
// company needs the companies the catalog actually has, or a warehouse would
// be unable to reach some of its own products. The Discounts tab keeps using
// the registry: picking a company to discount ahead of importing its price
// list is a legitimate thing to do there.
//
// One aggregation rather than the two `distinct` calls + a count each: the
// resolution ($lookup for catalog-linked rows, the row's own field for legacy
// ones) mirrors resolveProductIdentity in productCatalog.service.js.
async function listCatalogManufacturersForWarehouse(warehouseId) {
  const rows = await Product.aggregate([
    { $match: { warehouseId, isActive: true } },
    {
      $lookup: {
        from: ProductCatalog.collection.name,
        localField: 'masterProductId',
        foreignField: '_id',
        as: 'catalogEntry',
      },
    },
    {
      $addFields: {
        resolvedManufacturerAr: {
          $ifNull: [{ $arrayElemAt: ['$catalogEntry.manufacturerAr', 0] }, '$manufacturerAr'],
        },
        resolvedManufacturerEn: {
          $ifNull: [{ $arrayElemAt: ['$catalogEntry.manufacturerEn', 0] }, '$manufacturerEn'],
        },
      },
    },
    // A legacy row with no manufacturer of its own resolves to null - grouping
    // on it would produce a nameless card that opens an empty list.
    { $match: { resolvedManufacturerAr: { $nin: [null, ''] } } },
    // Grouped by the Arabic name because that is the identity the rest of the
    // system keys on (manufacturer discounts, the import registry, the product
    // filter). The English name rides along purely so the panel can label the
    // card in whichever language it is showing.
    {
      $group: {
        _id: '$resolvedManufacturerAr',
        manufacturerEn: { $first: '$resolvedManufacturerEn' },
        productCount: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return rows.map((row) => ({
    manufacturerAr: row._id,
    manufacturerEn: row.manufacturerEn ?? null,
    productCount: row.productCount,
  }));
}

module.exports = {
  registerManufacturers,
  listManufacturersForWarehouse,
  listCatalogManufacturersForWarehouse,
};
