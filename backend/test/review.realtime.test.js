// The realtime contract for a pharmacy rating a warehouse: review.created goes
// to the rated warehouse's own room only, exactly once, and only AFTER the
// review is written - never when a business rule or the write rejects.
//
// Same shape as offer.realtime.test.js: models and the realtime module are
// stubbed through require.cache before the service loads, so this needs no
// database and no socket server.
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/feniq-test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-realtime-tests-p';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const mongoose = require('mongoose');
const { modelQuery } = require('./helpers/model-query-stub');

const emitted = [];

function stubModule(relativePath, exportsValue) {
  const resolved = require.resolve(path.join(__dirname, '..', 'src', relativePath));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsValue };
}

stubModule('realtime/index.js', {
  emitToAdmins: (event, payload) => emitted.push({ room: 'admin', event, payload }),
  emitToWarehouse: (warehouseId, event, payload) =>
    emitted.push({ room: `warehouse:${warehouseId}`, event, payload }),
  EVENTS: { REVIEW_CREATED: 'review.created' },
});

const PHARMACY_ID = new mongoose.Types.ObjectId();
const USER_ID = new mongoose.Types.ObjectId();
const ORDER_ID = new mongoose.Types.ObjectId();
const WAREHOUSE_ID = new mongoose.Types.ObjectId();
const REVIEW_ID = new mongoose.Types.ObjectId();

let orderStatus;
let existingReview;
let createBehavior;

// Mutated in place, never reassigned - the service captured these objects at
// require time.
const orderModelStub = {
  findOne: modelQuery(() => ({ _id: ORDER_ID, status: orderStatus, warehouseId: WAREHOUSE_ID })),
};
const reviewModelStub = {
  findOne: modelQuery(() => existingReview),
  create: async (doc) => createBehavior(doc),
};
stubModule('models/order.model.js', orderModelStub);
stubModule('models/review.model.js', reviewModelStub);
stubModule('models/warehouse.model.js', { find: modelQuery(() => []) });

const reviewService = require('../src/services/review.service');

const RATE = () =>
  reviewService.createWarehouseReview(PHARMACY_ID, USER_ID, {
    orderId: ORDER_ID.toString(),
    rating: 4,
    comment: 'fast delivery',
  });

test.beforeEach(() => {
  emitted.length = 0;
  orderStatus = 'delivered';
  existingReview = null;
  createBehavior = async (doc) => ({ _id: REVIEW_ID, ...doc });
});

test('rating a delivered order emits exactly one review.created, to that warehouse only', async () => {
  await RATE();

  assert.strictEqual(emitted.length, 1);
  assert.strictEqual(emitted[0].room, `warehouse:${WAREHOUSE_ID}`);
  assert.strictEqual(emitted[0].event, 'review.created');
  assert.deepStrictEqual(emitted[0].payload, {
    reviewId: REVIEW_ID.toString(),
    orderId: ORDER_ID.toString(),
    warehouseId: WAREHOUSE_ID.toString(),
  });
});

test('an undelivered order emits nothing', async () => {
  orderStatus = 'out_for_delivery';
  await assert.rejects(RATE, (err) => {
    assert.strictEqual(err.code, 'ORDER_NOT_DELIVERED');
    return true;
  });
  assert.deepStrictEqual(emitted, []);
});

test('an order that is already rated emits nothing', async () => {
  existingReview = { _id: new mongoose.Types.ObjectId() };
  await assert.rejects(RATE, (err) => {
    assert.strictEqual(err.code, 'ALREADY_REVIEWED');
    return true;
  });
  assert.deepStrictEqual(emitted, []);
});

test('an invalid rating emits nothing', async () => {
  await assert.rejects(
    () =>
      reviewService.createWarehouseReview(PHARMACY_ID, USER_ID, {
        orderId: ORDER_ID.toString(),
        rating: 9,
      }),
    (err) => {
      assert.strictEqual(err.code, 'INVALID_RATING');
      return true;
    }
  );
  assert.deepStrictEqual(emitted, []);
});

test('a failed review write emits nothing', async () => {
  createBehavior = async () => {
    throw new Error('mongo write failed');
  };
  await assert.rejects(RATE, /mongo write failed/);
  assert.deepStrictEqual(emitted, []);
});
