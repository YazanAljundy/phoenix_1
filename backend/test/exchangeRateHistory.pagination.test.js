// Perf/pagination follow-up, Section 1.2: exchange-rate history moves from a
// hardcoded limit:20/no-cursor read to the same limit/after cursor pattern
// every other "Load more" list in the app uses.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-fx-history-pagination';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const { startMemoryMongo, stopMemoryMongo, clearCollections } = require('./helpers/mongo');

const ExchangeRateHistory = require('../src/models/exchangeRateHistory.model');
const { listRateHistory } = require('../src/services/exchangeRate.service');

test.before(async () => {
  await startMemoryMongo({ dbName: 'feniq-fx-history-pagination-test' });
});

test.after(async () => {
  await stopMemoryMongo();
});

test.beforeEach(async () => {
  await clearCollections(ExchangeRateHistory);
});

// Inserted sequentially so ObjectId order == insertion order == effectiveFrom
// order, exactly the guarantee the service's cursor relies on.
async function seedRows(count) {
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    rows.push(await ExchangeRateHistory.create({ usdToSyp: 10000 + i, source: 'manual' }));
  }
  return rows;
}

test('first page returns only `limit` rows, newest first, with hasMore/nextCursor set', async () => {
  const rows = await seedRows(5);
  const page = await listRateHistory({ limit: 2 });

  assert.strictEqual(page.rows.length, 2);
  assert.strictEqual(page.hasMore, true);
  assert.strictEqual(page.nextCursor, String(page.rows[1]._id));
  // Newest first: the last-created row (highest usdToSyp) comes first.
  assert.strictEqual(page.rows[0].usdToSyp, 10000 + 4);
  assert.strictEqual(page.rows[1].usdToSyp, 10000 + 3);
  void rows;
});

test('the last page reports hasMore: false (nextCursor is only nulled by the controller\'s paginationMeta)', async () => {
  await seedRows(3);
  const page = await listRateHistory({ limit: 20 });

  assert.strictEqual(page.rows.length, 3);
  assert.strictEqual(page.hasMore, false);
  // Matches listPaginatedOffers's own convention: the service always reports
  // the last row's id as nextCursor when there are rows: it's paginationMeta
  // at the controller layer that nulls it out once hasMore is false.
  assert.strictEqual(page.nextCursor, String(page.rows[2]._id));
});

test('paginating with `after` walks the full set with no repeats and no gaps', async () => {
  const seeded = await seedRows(7);
  const seededIds = seeded.map((r) => String(r._id)).sort();

  const seenIds = [];
  let after = null;
  let hasMore = true;
  let pages = 0;
  while (hasMore) {
    // eslint-disable-next-line no-await-in-loop
    const page = await listRateHistory({ limit: 3, after });
    pages += 1;
    assert.ok(page.rows.length > 0 && page.rows.length <= 3);
    seenIds.push(...page.rows.map((r) => String(r._id)));
    hasMore = page.hasMore;
    after = page.nextCursor;
  }

  assert.strictEqual(pages, 3, '7 rows at limit 3 is 3 pages (3, 3, 1)');
  assert.strictEqual(seenIds.length, 7);
  assert.strictEqual(new Set(seenIds).size, 7, 'no row seen twice across pages');
  assert.deepStrictEqual(seenIds.sort(), seededIds, 'every seeded row was covered');
});

test('an empty history returns an empty page, not an error', async () => {
  const page = await listRateHistory({ limit: 20 });
  assert.deepStrictEqual(page, { rows: [], hasMore: false, nextCursor: null });
});
