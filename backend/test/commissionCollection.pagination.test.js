// Perf/pagination follow-up, Section 1.3: a warehouse's commission-collection
// history moves from a hardcoded limit:100/no-cursor read to the same
// limit/after cursor pattern every other "Load more" list in the app uses.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-commission-pagination';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const { startMemoryMongo, stopMemoryMongo, clearCollections } = require('./helpers/mongo');

const CommissionCollection = require('../src/models/commissionCollection.model');
const { listCollectionsForWarehouse } = require('../src/services/commissionCollection.service');

const WAREHOUSE_A = new mongoose.Types.ObjectId();
const WAREHOUSE_B = new mongoose.Types.ObjectId();
const ADMIN_USER = new mongoose.Types.ObjectId();
const DAY = 24 * 60 * 60 * 1000;

test.before(async () => {
  await startMemoryMongo({ dbName: 'feniq-commission-pagination-test' });
});

test.after(async () => {
  await stopMemoryMongo();
});

test.beforeEach(async () => {
  await clearCollections(CommissionCollection);
});

async function seedRows(warehouseId, count) {
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    rows.push(
      await CommissionCollection.create({
        warehouseId,
        periodFrom: new Date(Date.now() - 30 * DAY),
        periodTo: new Date(Date.now() - DAY),
        amountSyp: 1000 + i,
        method: 'cash',
        recordedBy: ADMIN_USER,
      })
    );
  }
  return rows;
}

test('first page returns only `limit` rows, newest first, with hasMore/nextCursor set', async () => {
  await seedRows(WAREHOUSE_A, 5);
  const page = await listCollectionsForWarehouse(WAREHOUSE_A, { limit: 2 });

  assert.strictEqual(page.rows.length, 2);
  assert.strictEqual(page.hasMore, true);
  assert.strictEqual(page.nextCursor, String(page.rows[1]._id));
  assert.strictEqual(page.rows[0].amountSyp, 1004, 'newest (last-inserted) first');
});

test('paginating with `after` walks the full set with no repeats and no gaps', async () => {
  const seeded = await seedRows(WAREHOUSE_A, 7);
  const seededIds = seeded.map((r) => String(r._id)).sort();

  const seenIds = [];
  let after = null;
  let hasMore = true;
  let pages = 0;
  while (hasMore) {
    // eslint-disable-next-line no-await-in-loop
    const page = await listCollectionsForWarehouse(WAREHOUSE_A, { limit: 3, after });
    pages += 1;
    seenIds.push(...page.rows.map((r) => String(r._id)));
    hasMore = page.hasMore;
    after = page.nextCursor;
  }

  assert.strictEqual(pages, 3, '7 rows at limit 3 is 3 pages (3, 3, 1)');
  assert.strictEqual(seenIds.length, 7);
  assert.strictEqual(new Set(seenIds).size, 7, 'no row seen twice across pages');
  assert.deepStrictEqual(seenIds.sort(), seededIds, 'every seeded row was covered');
});

test('pagination for one warehouse never leaks another warehouse\'s rows', async () => {
  await seedRows(WAREHOUSE_A, 3);
  await seedRows(WAREHOUSE_B, 3);

  const seenForA = [];
  let after = null;
  let hasMore = true;
  while (hasMore) {
    // eslint-disable-next-line no-await-in-loop
    const page = await listCollectionsForWarehouse(WAREHOUSE_A, { limit: 1, after });
    seenForA.push(...page.rows);
    hasMore = page.hasMore;
    after = page.nextCursor;
  }

  assert.strictEqual(seenForA.length, 3);
  assert.ok(seenForA.every((r) => String(r.warehouseId) === String(WAREHOUSE_A)));
});

test('an empty history returns an empty page, not an error', async () => {
  const page = await listCollectionsForWarehouse(WAREHOUSE_A, { limit: 20 });
  assert.deepStrictEqual(page, { rows: [], hasMore: false, nextCursor: null });
});

test('the default limit stays 100 when the caller does not specify one', async () => {
  await seedRows(WAREHOUSE_A, 3);
  const page = await listCollectionsForWarehouse(WAREHOUSE_A);
  assert.strictEqual(page.rows.length, 3);
  assert.strictEqual(page.hasMore, false);
});
