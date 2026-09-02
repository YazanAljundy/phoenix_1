// One-time index migration for Level 2 (see docs/PERFORMANCE_OPTIMIZATION.md).
//
// The new indexes are declared on the schemas and Mongoose's autoIndex creates
// them on boot; this script is idempotent and mainly exists to DROP the indexes
// that Level 2 supersedes or found unused (Mongoose never drops an index just
// because its schema declaration was removed).
//
// Safe to run more than once, and safe to run against a database that has
// already picked up the new indexes from an app deploy - every step is
// create-if-missing / drop-if-present.
//
// Usage: npm run migrate-level2-indexes
require('dotenv').config();
const mongoose = require('mongoose');
const env = require('../src/config/env');

// Desired end state, per collection. `create` mirrors the schema declarations
// (redundant with autoIndex, listed so the script is self-contained); `drop`
// removes what Level 2 replaced.
const PLAN = [
  {
    collection: 'orders',
    create: [
      { keys: { pharmacyId: 1, orderNumber: -1 } },
      { keys: { warehouseId: 1, status: 1, orderNumber: 1 } },
      { keys: { warehouseId: 1, orderNumber: 1 } },
      { keys: { pharmacyId: 1, status: 1, updatedAt: -1 } },
    ],
    // Each is a strict prefix of a new compound above, or (status_1) unused.
    drop: ['pharmacyId_1', 'warehouseId_1', 'status_1'],
  },
  {
    collection: 'reviews',
    create: [
      { keys: { warehouseId: 1, reviewerType: 1, isVisible: 1, _id: -1 } },
      { keys: { pharmacyId: 1, reviewerType: 1, createdAt: -1 } },
    ],
    drop: [],
  },
  {
    collection: 'users',
    create: [{ keys: { role: 1, status: 1 } }],
    drop: [],
  },
  {
    collection: 'pharmacybalances',
    create: [{ keys: { warehouseId: 1, balanceUsd: -1, _id: 1 } }],
    drop: [],
  },
  {
    collection: 'returns',
    create: [
      { keys: { warehouseId: 1, status: 1, _id: -1 } },
      { keys: { warehouseId: 1, _id: -1 } },
    ],
    // {warehouseId,status} prefix is still covered by {warehouseId,status,_id:-1}.
    drop: ['warehouseId_1_status_1'],
  },
  {
    collection: 'products',
    create: [
      { keys: { warehouseId: 1, categoryId: 1, _id: 1 } },
      { keys: { warehouseId: 1, _id: 1 } },
    ],
    // {warehouseId,categoryId} prefix is covered by the new 3-field index;
    // the text index is unused (all catalog search is RegExp-based since Level 1).
    drop: ['warehouseId_1_categoryId_1', 'nameAr_text_nameEn_text_manufacturerAr_text_manufacturerEn_text'],
  },
];

async function main() {
  await mongoose.connect(env.mongodbUri);
  const db = mongoose.connection.db;

  for (const { collection, create, drop } of PLAN) {
    const coll = db.collection(collection);
    const existing = new Set((await coll.indexes()).map((i) => i.name));

    for (const spec of create) {
      // createIndex is a no-op when an identical index already exists.
      const name = await coll.createIndex(spec.keys, spec.options || {});
      console.log(`${collection}: ${existing.has(name) ? 'kept  ' : 'created'} ${name}`);
    }

    for (const name of drop) {
      if (!existing.has(name)) {
        console.log(`${collection}: absent ${name}`);
        continue;
      }
      await coll.dropIndex(name);
      console.log(`${collection}: dropped ${name}`);
    }
  }

  await mongoose.disconnect();
  console.log('Level 2 index migration complete.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
