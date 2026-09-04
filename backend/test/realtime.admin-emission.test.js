// The admin counterpart of realtime.emission.test.js: an admin-room event is
// emitted only AFTER MongoDB accepts the write, exactly once, and never when
// the write or a business rule rejects.
//
// Models and the realtime module are stubbed through require.cache before the
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

// Records room + event + payload instead of transmitting. `room` distinguishes
// an admin emit from a warehouse one, so a test can assert an event went to
// admins and nowhere else.
stubModule('realtime/index.js', {
  emitToAdmins: (event, payload) => emitted.push({ room: 'admin', event, payload }),
  emitToWarehouse: (warehouseId, event, payload) =>
    emitted.push({ room: `warehouse:${warehouseId}`, event, payload }),
  EVENTS: {
    ACCOUNT_PENDING: 'account.pending',
    ACCOUNT_STATUS_UPDATED: 'account.status.updated',
    OFFER_PENDING: 'offer.pending',
    OFFER_STATUS_UPDATED: 'offer.status.updated',
    BANNER_PENDING: 'banner.pending',
    BANNER_STATUS_UPDATED: 'banner.status.updated',
    ADVERTISEMENT_PENDING: 'advertisement.pending',
    ADVERTISEMENT_STATUS_UPDATED: 'advertisement.status.updated',
  },
});

// notification.service does a real FCM fan-out; neutralised so these tests
// exercise only the realtime path.
stubModule('services/notification.service.js', {
  sendToUser: async () => {},
  sendToAll: async () => {},
});

const USER_ID = new mongoose.Types.ObjectId();
const BANNER_ID = new mongoose.Types.ObjectId();
const ADMIN_ID = new mongoose.Types.ObjectId();
const ADVERTISEMENT_ID = new mongoose.Types.ObjectId();
const WAREHOUSE_ID = new mongoose.Types.ObjectId();
const PRODUCT_ID = new mongoose.Types.ObjectId();

let userSaveBehavior = async () => {};
let bannerSaveBehavior = async () => {};
let advertisementSaveBehavior = async () => {};

// The advertisement services chain .select()/.populate() off a find(), so the
// flat `async () => []` stub the older services were happy with isn't enough.
// This is a thenable that ignores every chained call and resolves to whatever
// the caller set up - `await Model.find(...)` still works exactly as before.
function chainableQuery(getResult) {
  const query = {
    select: () => query,
    populate: () => query,
    sort: () => query,
    limit: () => query,
    lean: () => query,
    then: (resolve, reject) => Promise.resolve(getResult()).then(resolve, reject),
  };
  return query;
}

function buildPendingUser() {
  return {
    _id: USER_ID,
    role: 'pharmacy',
    status: 'pending',
    save: () => userSaveBehavior(),
  };
}

// Block/unblock act on an already-decided account, so they need a non-pending
// starting status.
function buildManageableUser(status, role = 'pharmacy') {
  return { _id: USER_ID, role, status, save: () => userSaveBehavior() };
}

function buildBanner() {
  return {
    _id: BANNER_ID,
    bannerNumber: 42,
    status: 'pending',
    rejectionNote: null,
    approvedBy: null,
    save: () => bannerSaveBehavior(),
  };
}

function buildAdvertisement(status = 'pending') {
  return {
    _id: ADVERTISEMENT_ID,
    warehouseId: WAREHOUSE_ID,
    titleAr: 'إعلان',
    titleEn: 'Ad',
    items: [{ productId: PRODUCT_ID }],
    totalPriceUsd: 5,
    status,
    rejectionNote: null,
    approvedBy: null,
    approvedAt: null,
    save: () => advertisementSaveBehavior(),
    deleteOne: async () => {},
  };
}

// A create payload the advertisement service's validation accepts end to end.
function advertisementPayload() {
  return {
    titleAr: 'إعلان',
    titleEn: 'Ad',
    items: [{ productId: PRODUCT_ID.toString() }],
    totalPriceUsd: 5,
    startDate: '2026-01-01',
    endDate: '2026-12-31',
  };
}

// Mutated in place, never reassigned - the services captured these exact
// objects at require time.
const userModelStub = { findById: async () => buildPendingUser() };
const bannerModelStub = { findById: async () => buildBanner() };
const advertisementModelStub = {
  create: async (doc) => ({ ...buildAdvertisement(), ...doc }),
  findOne: async () => buildAdvertisement(),
  findById: async () => buildAdvertisement(),
  find: () => chainableQuery(() => []),
  countDocuments: async () => 0,
};
// The ownership check in validateItems asks for the products it was handed;
// returning exactly one satisfies a one-item advertisement.
const productModelStub = {
  find: () => chainableQuery(() => [{ _id: PRODUCT_ID, nameAr: 'دواء', nameEn: 'Medicine' }]),
  findOne: async () => null,
};

stubModule('models/user.model.js', userModelStub);
stubModule('models/banner.model.js', bannerModelStub);
stubModule('models/advertisement.model.js', advertisementModelStub);
stubModule('models/pharmacy.model.js', { find: async () => [], findOne: async () => null });
stubModule('models/warehouse.model.js', { find: async () => [], findById: async () => null });
stubModule('models/product.model.js', productModelStub);
stubModule('models/counter.model.js', { findOneAndUpdate: async () => ({ seq: 1 }) });

const adminService = require('../src/services/admin.service');
const adminBannerService = require('../src/services/adminBanner.service');
const warehouseAdvertisementService = require('../src/services/warehouseAdvertisement.service');
const adminAdvertisementService = require('../src/services/adminAdvertisement.service');

test.beforeEach(() => {
  emitted.length = 0;
  userSaveBehavior = async () => {};
  bannerSaveBehavior = async () => {};
  advertisementSaveBehavior = async () => {};
  userModelStub.findById = async () => buildPendingUser();
  bannerModelStub.findById = async () => buildBanner();
  advertisementModelStub.create = async (doc) => ({ ...buildAdvertisement(), ...doc });
  advertisementModelStub.findOne = async () => buildAdvertisement();
  advertisementModelStub.findById = async () => buildAdvertisement();
});

// --- Accounts --------------------------------------------------------------

test('approveAccount emits exactly one account.status.updated, to admins', async () => {
  await adminService.approveAccount(USER_ID.toString());

  assert.strictEqual(emitted.length, 1);
  assert.strictEqual(emitted[0].room, 'admin');
  assert.strictEqual(emitted[0].event, 'account.status.updated');
  assert.strictEqual(emitted[0].payload.userId, USER_ID.toString());
  assert.strictEqual(emitted[0].payload.status, 'active');
});

test('rejectAccount emits exactly one account.status.updated, to admins', async () => {
  await adminService.rejectAccount(USER_ID.toString());

  assert.strictEqual(emitted.length, 1);
  assert.strictEqual(emitted[0].room, 'admin');
  assert.strictEqual(emitted[0].payload.status, 'blocked');
});

test('a failed account write emits nothing', async () => {
  userSaveBehavior = async () => {
    throw new Error('mongo write failed');
  };

  await assert.rejects(() => adminService.approveAccount(USER_ID.toString()), /mongo write failed/);
  assert.deepStrictEqual(emitted, [], 'no event may be emitted when persistence fails');
});

test('approving an account that is not pending emits nothing', async () => {
  userModelStub.findById = async () => ({ ...buildPendingUser(), status: 'active' });

  await assert.rejects(() => adminService.approveAccount(USER_ID.toString()));
  assert.deepStrictEqual(emitted, [], 'a rejected business rule is not an event');
});

test('an unknown account emits nothing', async () => {
  userModelStub.findById = async () => null;

  await assert.rejects(() => adminService.approveAccount(USER_ID.toString()));
  assert.deepStrictEqual(emitted, []);
});

// --- Block / Unblock -----------------------------------------------------------

test('blockAccount emits exactly one account.status.updated {blocked}, to admins', async () => {
  userModelStub.findById = async () => buildManageableUser('active');

  await adminService.blockAccount(USER_ID.toString());

  assert.strictEqual(emitted.length, 1);
  assert.strictEqual(emitted[0].room, 'admin');
  assert.strictEqual(emitted[0].event, 'account.status.updated');
  assert.strictEqual(emitted[0].payload.userId, USER_ID.toString());
  assert.strictEqual(emitted[0].payload.status, 'blocked');
});

test('unblockAccount emits exactly one account.status.updated {active}, to admins', async () => {
  userModelStub.findById = async () => buildManageableUser('blocked', 'warehouse');

  await adminService.unblockAccount(USER_ID.toString());

  assert.strictEqual(emitted.length, 1);
  assert.strictEqual(emitted[0].payload.status, 'active');
  assert.strictEqual(emitted[0].payload.role, 'warehouse');
});

test('blocking a non-active / unblocking a non-blocked account emits nothing', async () => {
  userModelStub.findById = async () => buildManageableUser('pending');
  await assert.rejects(() => adminService.blockAccount(USER_ID.toString()));

  userModelStub.findById = async () => buildManageableUser('active');
  await assert.rejects(() => adminService.unblockAccount(USER_ID.toString()));

  assert.deepStrictEqual(emitted, [], 'a rejected state transition is not an event');
});

test('a failed block write emits nothing', async () => {
  userModelStub.findById = async () => buildManageableUser('active');
  userSaveBehavior = async () => {
    throw new Error('mongo write failed');
  };

  await assert.rejects(() => adminService.blockAccount(USER_ID.toString()), /mongo write failed/);
  assert.deepStrictEqual(emitted, []);
});

test('block/unblock on an unknown account emits nothing', async () => {
  userModelStub.findById = async () => null;
  await assert.rejects(() => adminService.blockAccount(USER_ID.toString()));
  await assert.rejects(() => adminService.unblockAccount(USER_ID.toString()));
  assert.deepStrictEqual(emitted, []);
});

// --- Banners ---------------------------------------------------------------

test('approveBanner emits exactly one banner.status.updated, to admins', async () => {
  await adminBannerService.approveBanner(BANNER_ID.toString(), ADMIN_ID);

  assert.strictEqual(emitted.length, 1);
  assert.strictEqual(emitted[0].room, 'admin');
  assert.strictEqual(emitted[0].event, 'banner.status.updated');
  assert.strictEqual(emitted[0].payload.bannerId, BANNER_ID.toString());
  assert.strictEqual(emitted[0].payload.status, 'approved');
});

test('rejectBanner emits exactly one banner.status.updated, to admins', async () => {
  await adminBannerService.rejectBanner(BANNER_ID.toString(), 'wrong dimensions');

  assert.strictEqual(emitted.length, 1);
  assert.strictEqual(emitted[0].payload.status, 'rejected');
});

test('rejectBanner with no note throws before any write, and emits nothing', async () => {
  await assert.rejects(() => adminBannerService.rejectBanner(BANNER_ID.toString(), '  '));
  assert.deepStrictEqual(emitted, [], 'validation failure must not announce a decision');
});

test('a failed banner write emits nothing', async () => {
  bannerSaveBehavior = async () => {
    throw new Error('mongo write failed');
  };

  await assert.rejects(
    () => adminBannerService.approveBanner(BANNER_ID.toString(), ADMIN_ID),
    /mongo write failed/
  );
  assert.deepStrictEqual(emitted, []);
});

test('an unknown banner emits nothing', async () => {
  bannerModelStub.findById = async () => null;

  await assert.rejects(() => adminBannerService.approveBanner(BANNER_ID.toString(), ADMIN_ID));
  assert.deepStrictEqual(emitted, []);
});

// --- Advertisements --------------------------------------------------------

test('createAdvertisement emits exactly one advertisement.pending, to admins', async () => {
  await warehouseAdvertisementService.createAdvertisement(WAREHOUSE_ID, advertisementPayload());

  assert.strictEqual(emitted.length, 1);
  assert.strictEqual(emitted[0].room, 'admin');
  assert.strictEqual(emitted[0].event, 'advertisement.pending');
  assert.strictEqual(emitted[0].payload.advertisementId, ADVERTISEMENT_ID.toString());
  assert.strictEqual(emitted[0].payload.warehouseId, WAREHOUSE_ID.toString());
});

test('a rejected advertisement validation emits nothing', async () => {
  // Two independent rules, neither of which may announce anything.
  await assert.rejects(() =>
    warehouseAdvertisementService.createAdvertisement(
      WAREHOUSE_ID,
      { ...advertisementPayload(), totalPriceUsd: -1 }
    )
  );
  await assert.rejects(() =>
    warehouseAdvertisementService.createAdvertisement(WAREHOUSE_ID, { ...advertisementPayload(), items: [] })
  );

  assert.deepStrictEqual(emitted, [], 'a rejected business rule is not an event');
});

test('editing a pending advertisement does not re-announce it', async () => {
  await warehouseAdvertisementService.updateAdvertisement(
    ADVERTISEMENT_ID.toString(),
    WAREHOUSE_ID,
    advertisementPayload()
  );
  assert.deepStrictEqual(emitted, [], 'it is already in the queue');
});

test('editing an approved advertisement re-queues it with one advertisement.pending', async () => {
  advertisementModelStub.findOne = async () => buildAdvertisement('approved');

  await warehouseAdvertisementService.updateAdvertisement(
    ADVERTISEMENT_ID.toString(),
    WAREHOUSE_ID,
    advertisementPayload()
  );

  assert.strictEqual(emitted.length, 1);
  assert.strictEqual(emitted[0].event, 'advertisement.pending');
});

test('a failed advertisement write emits nothing', async () => {
  advertisementModelStub.findOne = async () => buildAdvertisement('approved');
  advertisementSaveBehavior = async () => {
    throw new Error('mongo write failed');
  };

  await assert.rejects(
    () =>
      warehouseAdvertisementService.updateAdvertisement(
        ADVERTISEMENT_ID.toString(),
        WAREHOUSE_ID,
        advertisementPayload()
      ),
    /mongo write failed/
  );
  assert.deepStrictEqual(emitted, []);
});

test('approveAdvertisement emits exactly one advertisement.status.updated {approved}', async () => {
  await adminAdvertisementService.approveAdvertisement(ADVERTISEMENT_ID.toString(), ADMIN_ID);

  assert.strictEqual(emitted.length, 1);
  assert.strictEqual(emitted[0].room, 'admin');
  assert.strictEqual(emitted[0].event, 'advertisement.status.updated');
  assert.strictEqual(emitted[0].payload.advertisementId, ADVERTISEMENT_ID.toString());
  assert.strictEqual(emitted[0].payload.status, 'approved');
});

test('rejectAdvertisement emits exactly one advertisement.status.updated {rejected}', async () => {
  await adminAdvertisementService.rejectAdvertisement(ADVERTISEMENT_ID.toString(), 'prices look wrong');

  assert.strictEqual(emitted.length, 1);
  assert.strictEqual(emitted[0].payload.status, 'rejected');
});

test('rejectAdvertisement with no note throws before any write, and emits nothing', async () => {
  await assert.rejects(() => adminAdvertisementService.rejectAdvertisement(ADVERTISEMENT_ID.toString(), '  '));
  assert.deepStrictEqual(emitted, [], 'validation failure must not announce a decision');
});

test('an unknown advertisement emits nothing', async () => {
  advertisementModelStub.findOne = async () => null;

  await assert.rejects(() => adminAdvertisementService.approveAdvertisement(ADVERTISEMENT_ID.toString(), ADMIN_ID));
  await assert.rejects(() => adminAdvertisementService.rejectAdvertisement(ADVERTISEMENT_ID.toString(), 'note'));
  assert.deepStrictEqual(emitted, []);
});

test('a failed approval write emits nothing', async () => {
  advertisementSaveBehavior = async () => {
    throw new Error('mongo write failed');
  };

  await assert.rejects(
    () => adminAdvertisementService.approveAdvertisement(ADVERTISEMENT_ID.toString(), ADMIN_ID),
    /mongo write failed/
  );
  assert.deepStrictEqual(emitted, []);
});
