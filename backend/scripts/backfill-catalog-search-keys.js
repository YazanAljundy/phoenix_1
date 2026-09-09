// One-time backfill: ProductCatalog gained nameKey/manufacturerKey, the
// normalized (lowercased, whitespace-collapsed) copies of nameAr/
// manufacturerAr that warehouseProduct.service.js's import now looks rows up
// by. The pre-validate hook in productCatalog.model.js keeps them current for
// everything written from now on, but existing documents have both fields
// null until this runs - and an import cannot match a row whose catalog entry
// has no key, so this must run before the new import path is used against a
// database that predates it.
//
// The matching index is created by Mongoose's autoIndex on boot, same as
// every other index in this codebase; this script only fills the values.
//
// Safe to re-run: every document is simply rewritten with the keys its
// current names produce.
//
// Usage: npm run backfill-catalog-search-keys
require('dotenv').config();
const mongoose = require('mongoose');
const env = require('../src/config/env');
const ProductCatalog = require('../src/models/productCatalog.model');
const { searchKey } = require('../src/models/productCatalog.model');

const BATCH_SIZE = 500;

async function main() {
  await mongoose.connect(env.mongodbUri);

  // Only the two source fields are needed to derive the keys, and the
  // documents are never hydrated - the writes below are built by hand.
  const items = await ProductCatalog.find({}).select('nameAr manufacturerAr').lean();

  let updated = 0;
  for (let start = 0; start < items.length; start += BATCH_SIZE) {
    const batch = items.slice(start, start + BATCH_SIZE);
    const operations = batch.map((item) => ({
      updateOne: {
        filter: { _id: item._id },
        update: {
          $set: {
            nameKey: searchKey(item.nameAr),
            manufacturerKey: searchKey(item.manufacturerAr),
          },
        },
      },
    }));
    if (operations.length === 0) continue;
    const result = await ProductCatalog.bulkWrite(operations, { ordered: false });
    updated += result.modifiedCount ?? 0;
  }

  // A collision here means two entries normalize to the same pair - legal
  // (the unique index is on the display names, not these keys), but worth
  // surfacing: the import will match whichever one it finds first.
  const collisions = await ProductCatalog.aggregate([
    { $group: { _id: { nameKey: '$nameKey', manufacturerKey: '$manufacturerKey' }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
  ]);

  console.log(`Backfilled search keys on ${updated} of ${items.length} catalog item(s).`);
  if (collisions.length > 0) {
    console.warn(
      `${collisions.length} name/manufacturer pair(s) differ only by case or spacing - imports will match one of each arbitrarily:`
    );
    for (const collision of collisions) {
      console.warn(`  ${collision._id.nameKey} / ${collision._id.manufacturerKey} (x${collision.count})`);
    }
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
