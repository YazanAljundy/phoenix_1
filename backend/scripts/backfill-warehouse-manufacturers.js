// One-time backfill (Section 15 follow-up): warehouse_manufacturers is now
// populated going forward by Excel imports (see
// warehouseProduct.service.js's importProductsFromExcel), but any warehouse
// that already had products before this change would otherwise show an
// empty Discounts dropdown - manufacturerDiscount.service.js's validation
// switched from deriving the list live from current products to this
// sticky registry, and nothing else ever populates it retroactively.
//
// Usage: npm run backfill-warehouse-manufacturers
require('dotenv').config();
const mongoose = require('mongoose');
const env = require('../src/config/env');
const Product = require('../src/models/product.model');
const WarehouseManufacturer = require('../src/models/warehouseManufacturer.model');
const { applyResolvedIdentity } = require('../src/services/productCatalog.service');

async function main() {
  await mongoose.connect(env.mongodbUri);

  const products = await Product.find({}).populate('masterProductId');
  products.forEach(applyResolvedIdentity);

  const pairs = new Map(); // `${warehouseId}:${manufacturerAr}` -> { warehouseId, manufacturerAr }
  for (const product of products) {
    if (!product.manufacturerAr) continue;
    const key = `${product.warehouseId}:${product.manufacturerAr}`;
    pairs.set(key, { warehouseId: product.warehouseId, manufacturerAr: product.manufacturerAr });
  }

  let registered = 0;
  for (const { warehouseId, manufacturerAr } of pairs.values()) {
    await WarehouseManufacturer.findOneAndUpdate(
      { warehouseId, manufacturerAr },
      { $setOnInsert: { warehouseId, manufacturerAr } },
      { upsert: true }
    );
    registered += 1;
  }

  console.log(`Backfilled ${registered} (warehouse, manufacturer) pair(s) from ${products.length} product(s).`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
