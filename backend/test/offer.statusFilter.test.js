// Oracle test - Offers-fix plan, Section 1: checks the backend's derived-
// status filter (offer.service.js's buildOfferStatusFilter, which the Admin
// and Warehouse Offers pages' status pill now runs server-side) against the
// exact predicate it replaced (web/src/pages/offersFilters.js's
// matchesOfferFilter, still kept there for isInReview/display concerns).
//
// Every fixture below is inserted once and checked BOTH ways - through a real
// Offer.find(buildOfferStatusFilter(...)) and directly through
// matchesOfferFilter(...) - on the exact same document and the exact same
// `now`, for every one of the five real status pills. A mismatch here is a
// genuine behavioural difference between old and new, not something to
// "fix" by editing the assertion - see the mismatch detail in the failure
// message before changing either implementation.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-offer-statusfilter-tests';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const { startMemoryMongo, stopMemoryMongo } = require('./helpers/mongo');

const Offer = require('../src/models/offer.model');
const { buildOfferStatusFilter, OFFER_STATUS_VALUES } = require('../src/services/offer.service');

let matchesOfferFilter;

test.before(async () => {
  await startMemoryMongo({ dbName: 'feniq-offer-statusfilter-test' });
  // offersFilters.js is an ESM file (web/ is "type": "module") - dynamic
  // import works regardless of this file's own CommonJS module system,
  // unlike require(), which would depend on Node/flag support for it.
  ({ matchesOfferFilter } = await import('../../web/src/pages/offersFilters.js'));
});

test.after(async () => {
  await stopMemoryMongo();
});

const NOW = new Date('2026-06-15T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const PRODUCT_ID = new mongoose.Types.ObjectId();
const WAREHOUSE_ID = new mongoose.Types.ObjectId();

function baseFields(overrides = {}) {
  return {
    warehouseId: WAREHOUSE_ID,
    productId: PRODUCT_ID,
    titleAr: 'ع',
    titleEn: 'Offer',
    discountPercentage: 15,
    startDate: new Date(NOW.getTime() - DAY),
    endDate: new Date(NOW.getTime() + 10 * DAY),
    isPermanent: false,
    status: 'approved',
    pendingUpdate: null,
    ...overrides,
  };
}

// One row per meaningfully distinct combination of status / isPermanent /
// pendingUpdate / start-vs-now / end-vs-now - including the exact-boundary
// cases and the "review and permanent both true at once" state the old
// code's own comments call out as real and reachable (unlike active/
// upcoming/expired, review and permanent are never gated on status
// === 'approved').
const FIXTURES = [
  { name: 'pending, no pendingUpdate', fields: baseFields({ status: 'pending' }) },
  {
    name: 'approved, pendingUpdate parked',
    fields: baseFields({
      pendingUpdate: {
        productId: PRODUCT_ID,
        titleAr: 'ع٢',
        titleEn: 'Offer 2',
        discountPercentage: 20,
        startDate: new Date(NOW.getTime() - DAY),
      },
    }),
  },
  { name: 'approved, permanent (no endDate)', fields: baseFields({ isPermanent: true, endDate: null }) },
  {
    name: 'approved, upcoming (startDate in the future)',
    fields: baseFields({ startDate: new Date(NOW.getTime() + 5 * DAY) }),
  },
  {
    name: 'approved, expired (endDate in the past)',
    fields: baseFields({
      startDate: new Date(NOW.getTime() - 10 * DAY),
      endDate: new Date(NOW.getTime() - DAY),
    }),
  },
  { name: 'approved, startDate exactly now (boundary)', fields: baseFields({ startDate: NOW }) },
  {
    name: 'approved, endDate exactly now (boundary)',
    fields: baseFields({ startDate: new Date(NOW.getTime() - 5 * DAY), endDate: NOW }),
  },
  {
    name: 'pending AND permanent - review and permanent both true',
    fields: baseFields({ status: 'pending', isPermanent: true, endDate: null }),
  },
  {
    name: 'approved, not permanent, endDate null (the defensive fallback both implementations keep)',
    fields: baseFields({ endDate: null }),
  },
];

test('buildOfferStatusFilter matches matchesOfferFilter exactly, on every status pill and every fixture', async () => {
  await Offer.deleteMany({});
  const created = await Offer.insertMany(FIXTURES.map((f) => f.fields));
  const idsByFixtureIndex = created.map((doc) => String(doc._id));
  const allIds = idsByFixtureIndex.map((id) => new mongoose.Types.ObjectId(id));

  const mismatches = [];

  for (const status of OFFER_STATUS_VALUES) {
    const statusFilter = buildOfferStatusFilter(status, NOW);
    assert.ok(statusFilter, `buildOfferStatusFilter must handle every value in OFFER_STATUS_VALUES (got null for '${status}')`);

    const matched = await Offer.find({ $and: [{ _id: { $in: allIds } }, statusFilter] }, '_id');
    const matchedIds = new Set(matched.map((row) => String(row._id)));

    FIXTURES.forEach((fixture, i) => {
      const oldResult = matchesOfferFilter(fixture.fields, status, NOW);
      const newResult = matchedIds.has(idsByFixtureIndex[i]);
      if (oldResult !== newResult) {
        mismatches.push({ status, fixture: fixture.name, matchesOfferFilter: oldResult, buildOfferStatusFilter: newResult });
      }
    });
  }

  assert.deepStrictEqual(
    mismatches,
    [],
    `buildOfferStatusFilter diverges from matchesOfferFilter:\n${JSON.stringify(mismatches, null, 2)}`
  );
});
