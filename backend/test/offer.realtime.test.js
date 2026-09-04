// The realtime contract for offers, matching realtime.admin-emission.test.js's
// shape: an admin-room event is emitted only AFTER the write succeeds, exactly
// once, and never when the write or a business rule rejects.
//
// Models and collaborators are stubbed through require.cache before the
// services load, so this needs no database and no socket server.
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/phoenix-test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-realtime-tests';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const mongoose = require('mongoose');

const emitted = [];

function stubModule(relativePath, exportsValue) {
  const resolved = require.resolve(path.join(__dirname, '..', 'src', relativePath));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsValue };
}

stubModule('realtime/index.js', {
  emitToAdmins: (event, payload) => emitted.push({ room: 'admin', event, payload }),
  emitToWarehouse: (warehouseId, event, payload) =>
    emitted.push({ room: `warehouse:${warehouseId}`, event, payload }),
  EVENTS: {
    OFFER_PENDING: 'offer.pending',
    OFFER_STATUS_UPDATED: 'offer.status.updated',
  },
});
stubModule('services/notification.service.js', { sendToUser: async () => {}, sendToAll: async () => {} });

const WAREHOUSE_ID = new mongoose.Types.ObjectId();
const OFFER_ID = new mongoose.Types.ObjectId();
const PRODUCT_ID = new mongoose.Types.ObjectId();
const ADMIN_ID = new mongoose.Types.ObjectId();

// A product that passes buildOfferFields (ownership check is stubbed away, so
// this only has to survive populate() + applyResolvedIdentity).
function buildProduct() {
  return {
    _id: PRODUCT_ID,
    nameAr: 'دواء', nameEn: 'Medicine', manufacturerAr: 'ش', manufacturerEn: 'Co',
    masterProductId: null,
    price: 10,
    populate: async () => {},
  };
}
stubModule('services/warehouseProduct.service.js', {
  findOwnedProductOrThrow: async () => buildProduct(),
});

let offerSaveBehavior = async () => {};

function buildOffer(overrides = {}) {
  return {
    _id: OFFER_ID,
    warehouseId: WAREHOUSE_ID,
    productId: PRODUCT_ID,
    titleAr: 'live', titleEn: 'live',
    discountPercentage: 10,
    startDate: new Date('2026-01-01'),
    endDate: new Date('2026-12-31'),
    isPermanent: false,
    status: 'approved',
    pendingUpdate: null,
    approvedBy: null,
    approvedAt: null,
    save: () => offerSaveBehavior(),
    deleteOne: async () => {},
    ...overrides,
  };
}

const offerModelStub = {
  create: async (doc) => buildOffer({ ...doc, status: 'pending' }),
  findOne: async () => buildOffer(),
  findById: async () => buildOffer(),
};
stubModule('models/offer.model.js', offerModelStub);
stubModule('models/product.model.js', { find: async () => [], findOne: async () => null, findById: async () => null });
stubModule('models/pharmacy.model.js', { find: async () => [], findOne: async () => null });
stubModule('models/warehouse.model.js', { find: async () => [], findById: async () => null });

const warehouseOfferService = require('../src/services/warehouseOffer.service');
const adminOfferService = require('../src/services/adminOffer.service');

const CREATE_PAYLOAD = {
  productId: PRODUCT_ID.toString(),
  titleAr: 'عرض', titleEn: 'Deal',
  discountPercentage: 20,
  startDate: '2026-02-01', endDate: '2026-03-01',
};

test.beforeEach(() => {
  emitted.length = 0;
  offerSaveBehavior = async () => {};
  offerModelStub.findOne = async () => buildOffer();
  offerModelStub.findById = async () => buildOffer();
  offerModelStub.create = async (doc) => buildOffer({ ...doc, status: 'pending' });
});

test('createOffer emits exactly one offer.pending, to admins', async () => {
  await warehouseOfferService.createOffer(WAREHOUSE_ID, CREATE_PAYLOAD);
  assert.strictEqual(emitted.length, 1);
  assert.strictEqual(emitted[0].room, 'admin');
  assert.strictEqual(emitted[0].event, 'offer.pending');
  assert.strictEqual(emitted[0].payload.warehouseId, WAREHOUSE_ID.toString());
});

test('a rejected create validation emits nothing', async () => {
  await assert.rejects(() =>
    warehouseOfferService.createOffer(WAREHOUSE_ID, { ...CREATE_PAYLOAD, discountPercentage: 0 })
  );
  await assert.rejects(() =>
    warehouseOfferService.createOffer(WAREHOUSE_ID, { ...CREATE_PAYLOAD, endDate: undefined })
  );
  assert.deepStrictEqual(emitted, [], 'a rejected business rule is not an event');
});

test('a failed create write emits nothing', async () => {
  offerModelStub.create = async () => {
    throw new Error('mongo write failed');
  };
  await assert.rejects(() => warehouseOfferService.createOffer(WAREHOUSE_ID, CREATE_PAYLOAD), /mongo write failed/);
  assert.deepStrictEqual(emitted, []);
});

test('editing a still-pending offer does not announce it again', async () => {
  offerModelStub.findOne = async () => buildOffer({ status: 'pending' });
  await warehouseOfferService.updateOffer(OFFER_ID.toString(), WAREHOUSE_ID, CREATE_PAYLOAD);
  assert.deepStrictEqual(emitted, [], 'it is already in the queue');
});

test('parking an edit on an approved offer emits exactly one offer.pending', async () => {
  await warehouseOfferService.updateOffer(OFFER_ID.toString(), WAREHOUSE_ID, CREATE_PAYLOAD);
  assert.strictEqual(emitted.length, 1);
  assert.strictEqual(emitted[0].event, 'offer.pending');
});

test('re-editing an offer that already has a parked edit does not re-announce', async () => {
  offerModelStub.findOne = async () => buildOffer({ pendingUpdate: { productId: PRODUCT_ID } });
  await warehouseOfferService.updateOffer(OFFER_ID.toString(), WAREHOUSE_ID, CREATE_PAYLOAD);
  assert.deepStrictEqual(emitted, [], 'already queued');
});

test('a failed edit write emits nothing', async () => {
  offerSaveBehavior = async () => {
    throw new Error('mongo write failed');
  };
  await assert.rejects(
    () => warehouseOfferService.updateOffer(OFFER_ID.toString(), WAREHOUSE_ID, CREATE_PAYLOAD),
    /mongo write failed/
  );
  assert.deepStrictEqual(emitted, []);
});

test('deleteOffer on a queued offer emits one offer.status.updated {deleted}', async () => {
  offerModelStub.findOne = async () => buildOffer({ status: 'pending' });
  await warehouseOfferService.deleteOffer(OFFER_ID.toString(), WAREHOUSE_ID);
  assert.strictEqual(emitted.length, 1);
  assert.strictEqual(emitted[0].event, 'offer.status.updated');
  assert.strictEqual(emitted[0].payload.status, 'deleted');
});

test('approveOffer (new offer) emits one offer.status.updated {approved}', async () => {
  offerModelStub.findOne = async () => buildOffer({ status: 'pending' });
  await adminOfferService.approveOffer(OFFER_ID.toString(), ADMIN_ID);
  const statusEvents = emitted.filter((e) => e.event === 'offer.status.updated');
  assert.strictEqual(statusEvents.length, 1);
  assert.strictEqual(statusEvents[0].payload.status, 'approved');
});

test('rejectOffer on a parked edit emits {update_rejected} and does not delete', async () => {
  let deleted = false;
  offerModelStub.findOne = async () =>
    buildOffer({ pendingUpdate: { productId: PRODUCT_ID }, deleteOne: async () => { deleted = true; } });
  await adminOfferService.rejectOffer(OFFER_ID.toString());
  assert.strictEqual(deleted, false, 'the live offer is kept');
  assert.strictEqual(emitted.length, 1);
  assert.strictEqual(emitted[0].payload.status, 'update_rejected');
});

test('a failed approve write emits nothing', async () => {
  offerModelStub.findOne = async () => buildOffer({ status: 'pending' });
  offerSaveBehavior = async () => {
    throw new Error('mongo write failed');
  };
  await assert.rejects(() => adminOfferService.approveOffer(OFFER_ID.toString(), ADMIN_ID), /mongo write failed/);
  assert.deepStrictEqual(emitted, []);
});

test('an unknown offer in the queue emits nothing', async () => {
  offerModelStub.findOne = async () => null;
  await assert.rejects(() => adminOfferService.approveOffer(OFFER_ID.toString(), ADMIN_ID));
  await assert.rejects(() => adminOfferService.rejectOffer(OFFER_ID.toString()));
  assert.deepStrictEqual(emitted, []);
});
