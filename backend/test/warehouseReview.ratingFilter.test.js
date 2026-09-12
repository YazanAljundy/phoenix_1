// Perf/pagination follow-up, Section 2: a `rating` (1-5, or 'all'/omitted)
// exact-match filter on the warehouse's received-reviews list.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-review-rating-filter';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const { startMemoryMongo, stopMemoryMongo, clearCollections } = require('./helpers/mongo');

const Review = require('../src/models/review.model');
const { listPaginatedReviewsForWarehouse } = require('../src/services/warehouseReview.service');

const WAREHOUSE_ID = new mongoose.Types.ObjectId();
const PHARMACY_ID = new mongoose.Types.ObjectId();

test.before(async () => {
  await startMemoryMongo({ dbName: 'feniq-review-rating-filter-test' });
});

test.after(async () => {
  await stopMemoryMongo();
});

test.beforeEach(async () => {
  await clearCollections(Review);
});

// One review per rating value 1-5, plus a second 5-star and an invisible
// (moderated-away) 5-star that must never surface regardless of filter.
async function seedFixtures() {
  const ratings = [1, 2, 3, 4, 5, 5];
  for (const rating of ratings) {
    // eslint-disable-next-line no-await-in-loop
    await Review.create({
      orderId: new mongoose.Types.ObjectId(),
      pharmacyId: PHARMACY_ID,
      warehouseId: WAREHOUSE_ID,
      reviewerType: 'pharmacy',
      rating,
      isVisible: true,
    });
  }
  await Review.create({
    orderId: new mongoose.Types.ObjectId(),
    pharmacyId: PHARMACY_ID,
    warehouseId: WAREHOUSE_ID,
    reviewerType: 'pharmacy',
    rating: 5,
    isVisible: false,
  });
}

test('no rating filter (omitted or "all") returns every visible review', async () => {
  await seedFixtures();
  const omitted = await listPaginatedReviewsForWarehouse(WAREHOUSE_ID, { limit: 20 });
  const explicitAll = await listPaginatedReviewsForWarehouse(WAREHOUSE_ID, { limit: 20, rating: 'all' });
  assert.strictEqual(omitted.rows.length, 6);
  assert.strictEqual(explicitAll.rows.length, 6);
});

test('rating=5 returns only the two 5-star VISIBLE reviews, never the hidden one', async () => {
  await seedFixtures();
  const page = await listPaginatedReviewsForWarehouse(WAREHOUSE_ID, { limit: 20, rating: '5' });
  assert.strictEqual(page.rows.length, 2);
  assert.ok(page.rows.every((r) => r.review.rating === 5));
});

test('rating=3 returns exactly the one 3-star review', async () => {
  await seedFixtures();
  const page = await listPaginatedReviewsForWarehouse(WAREHOUSE_ID, { limit: 20, rating: '3' });
  assert.strictEqual(page.rows.length, 1);
  assert.strictEqual(page.rows[0].review.rating, 3);
});

test('the rating filter never changes averageRating/totalCount/distribution - those stay global', async () => {
  await seedFixtures();
  const unfiltered = await listPaginatedReviewsForWarehouse(WAREHOUSE_ID, { limit: 20 });
  const filtered = await listPaginatedReviewsForWarehouse(WAREHOUSE_ID, { limit: 20, rating: '1' });

  assert.strictEqual(filtered.rows.length, 1, 'the row list itself IS narrowed');
  assert.strictEqual(filtered.totalCount, unfiltered.totalCount, 'totalCount ignores the filter');
  assert.strictEqual(filtered.averageRating, unfiltered.averageRating, 'averageRating ignores the filter');
  assert.deepStrictEqual(filtered.distribution, unfiltered.distribution, 'distribution ignores the filter');
});

test('an out-of-range or non-numeric rating is rejected as a bad request', async () => {
  await seedFixtures();
  await assert.rejects(
    () => listPaginatedReviewsForWarehouse(WAREHOUSE_ID, { limit: 20, rating: '0' }),
    (err) => {
      assert.strictEqual(err.code, 'INVALID_RATING_FILTER');
      return true;
    }
  );
  await assert.rejects(
    () => listPaginatedReviewsForWarehouse(WAREHOUSE_ID, { limit: 20, rating: '6' }),
    (err) => {
      assert.strictEqual(err.code, 'INVALID_RATING_FILTER');
      return true;
    }
  );
  await assert.rejects(
    () => listPaginatedReviewsForWarehouse(WAREHOUSE_ID, { limit: 20, rating: 'five' }),
    (err) => {
      assert.strictEqual(err.code, 'INVALID_RATING_FILTER');
      return true;
    }
  );
});

test('the rating filter combines correctly with cursor pagination', async () => {
  // Three more 5-star reviews so rating=5 alone spans two pages.
  await seedFixtures();
  for (let i = 0; i < 3; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await Review.create({
      orderId: new mongoose.Types.ObjectId(),
      pharmacyId: PHARMACY_ID,
      warehouseId: WAREHOUSE_ID,
      reviewerType: 'pharmacy',
      rating: 5,
      isVisible: true,
    });
  }
  // 5 visible 5-star reviews total now.
  const seenIds = [];
  let after = null;
  let hasMore = true;
  let pages = 0;
  while (hasMore) {
    // eslint-disable-next-line no-await-in-loop
    const page = await listPaginatedReviewsForWarehouse(WAREHOUSE_ID, { limit: 2, after, rating: '5' });
    pages += 1;
    assert.ok(page.rows.every((r) => r.review.rating === 5));
    seenIds.push(...page.rows.map((r) => String(r.review._id)));
    hasMore = page.hasMore;
    after = page.nextCursor;
  }
  assert.strictEqual(pages, 3, '5 rows at limit 2 is 3 pages (2, 2, 1)');
  assert.strictEqual(seenIds.length, 5);
  assert.strictEqual(new Set(seenIds).size, 5, 'no row seen twice across pages');
});
