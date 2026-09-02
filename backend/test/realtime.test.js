// Realtime layer tests - Node's built-in runner (`node --test`), no test
// framework added to the project.
//
// These drive a REAL Socket.IO server over a real port with real clients, so
// what's verified is the actual handshake/room behavior rather than a mock of
// it. Mongoose models are stubbed through require.cache (see below) because
// the point here is the socket layer, not the database.
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/phoenix-test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-realtime-tests';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const { io: ioClient } = require('socket.io-client');

// --- Model stubs -----------------------------------------------------------
// Seeded into require.cache BEFORE anything pulls the real Mongoose models in,
// so no database connection is ever needed.
const users = new Map();
const warehousesByUserId = new Map();

const { modelQuery } = require('./helpers/model-query-stub');

function stubModule(relativePath, exportsValue) {
  const resolved = require.resolve(path.join(__dirname, '..', 'src', relativePath));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsValue };
}

// modelQuery, not `async () => ...`: a Mongoose model method returns a
// chainable Query, and the handshake's authenticateToken selects fields off
// it. Stubbing only the thenable half would make the double, not the code
// under test, decide whether this passes. The resolved values are unchanged.
stubModule('models/user.model.js', {
  findById: modelQuery((id) => users.get(String(id)) ?? null),
});
stubModule('models/warehouse.model.js', {
  findOne: modelQuery((filter) => warehousesByUserId.get(String(filter.userId)) ?? null),
});

const {
  initRealtime,
  emitToWarehouse,
  emitToAdmins,
  EVENTS,
  _setIoForTesting,
} = require('../src/realtime');

// --- Fixtures --------------------------------------------------------------
const WAREHOUSE_A_USER = 'aaaaaaaaaaaaaaaaaaaaaaa1';
const WAREHOUSE_B_USER = 'bbbbbbbbbbbbbbbbbbbbbbb1';
const PHARMACY_USER = 'ccccccccccccccccccccccc1';
const BLOCKED_USER = 'ddddddddddddddddddddddd1';
const ADMIN_USER = 'eeeeeeeeeeeeeeeeeeeeeee1';
const ADMIN_USER_2 = 'eeeeeeeeeeeeeeeeeeeeeee2';
const BLOCKED_ADMIN_USER = 'fffffffffffffffffffffff1';
const PENDING_ADMIN_USER = 'fffffffffffffffffffffff2';
const WAREHOUSE_A_ID = 'a0a0a0a0a0a0a0a0a0a0a0a0';
const WAREHOUSE_B_ID = 'b0b0b0b0b0b0b0b0b0b0b0b0';

function seedFixtures() {
  users.clear();
  warehousesByUserId.clear();

  users.set(WAREHOUSE_A_USER, { _id: WAREHOUSE_A_USER, role: 'warehouse', status: 'active' });
  users.set(WAREHOUSE_B_USER, { _id: WAREHOUSE_B_USER, role: 'warehouse', status: 'active' });
  users.set(PHARMACY_USER, { _id: PHARMACY_USER, role: 'pharmacy', status: 'active' });
  users.set(BLOCKED_USER, { _id: BLOCKED_USER, role: 'warehouse', status: 'blocked' });
  users.set(ADMIN_USER, { _id: ADMIN_USER, role: 'admin', status: 'active' });
  users.set(ADMIN_USER_2, { _id: ADMIN_USER_2, role: 'admin', status: 'active' });
  users.set(BLOCKED_ADMIN_USER, { _id: BLOCKED_ADMIN_USER, role: 'admin', status: 'blocked' });
  users.set(PENDING_ADMIN_USER, { _id: PENDING_ADMIN_USER, role: 'admin', status: 'pending' });

  warehousesByUserId.set(WAREHOUSE_A_USER, { _id: WAREHOUSE_A_ID, userId: WAREHOUSE_A_USER });
  warehousesByUserId.set(WAREHOUSE_B_USER, { _id: WAREHOUSE_B_ID, userId: WAREHOUSE_B_USER });
  warehousesByUserId.set(BLOCKED_USER, { _id: WAREHOUSE_A_ID, userId: BLOCKED_USER });
  // Deliberately also gives the admin users a warehouse profile: if
  // resolveRoomsFor ever fell through to the warehouse branch for an admin,
  // these fixtures would let it silently succeed - and the "admin joins no
  // warehouse room" test below would catch it.
  warehousesByUserId.set(ADMIN_USER, { _id: WAREHOUSE_A_ID, userId: ADMIN_USER });
}

// The `role` claim in the JWT is deliberately WRONG for most of these (always
// 'warehouse'), which is the point: the server must derive role from the User
// document it loads, never from the token payload. See the explicit test for
// that below.
function tokenFor(userId) {
  return jwt.sign({ sub: userId, role: 'warehouse' }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

let server;
let baseUrl;
let liveIo;
const openClients = [];

function connectClient(auth) {
  const client = ioClient(baseUrl, {
    auth,
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
  });
  openClients.push(client);
  return client;
}

// Resolves 'connected' or 'rejected' - never hangs a test on a socket that
// silently does neither.
function settle(client) {
  return new Promise((resolve) => {
    const done = (outcome) => {
      clearTimeout(timer);
      resolve(outcome);
    };
    const timer = setTimeout(() => done('timeout'), 3000);
    client.on('connect', () => done('connected'));
    client.on('connect_error', (err) => done(`rejected:${err.message}`));
  });
}

// Collects events for `ms`, so "warehouse B received nothing" is an actual
// observed silence rather than an assertion made too early. Removes its own
// listener afterwards so shared long-lived clients don't accumulate one per
// test.
function collect(client, event, ms = 400) {
  const received = [];
  const handler = (payload) => received.push(payload);
  client.on(event, handler);
  return new Promise((resolve) =>
    setTimeout(() => {
      client.off(event, handler);
      resolve(received);
    }, ms)
  );
}

test.before(async () => {
  seedFixtures();
  server = http.createServer();
  _setIoForTesting(null);
  liveIo = initRealtime(server);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  for (const client of openClients) client.close();
  await new Promise((resolve) => server.close(resolve));
});

// --- 1. Authentication -----------------------------------------------------

test('a valid warehouse token connects successfully', async () => {
  const client = connectClient({ token: tokenFor(WAREHOUSE_A_USER) });
  assert.strictEqual(await settle(client), 'connected');
  client.close();
});

test('a connection with no token is rejected', async () => {
  const client = connectClient({});
  assert.strictEqual(await settle(client), 'rejected:UNAUTHORIZED');
  client.close();
});

test('a garbage/forged token is rejected', async () => {
  const client = connectClient({ token: 'not-a-real-jwt' });
  assert.strictEqual(await settle(client), 'rejected:UNAUTHORIZED');
  client.close();
});

test('a token signed with the wrong secret is rejected', async () => {
  const forged = jwt.sign({ sub: WAREHOUSE_A_USER, role: 'warehouse' }, 'wrong-secret');
  const client = connectClient({ token: forged });
  assert.strictEqual(await settle(client), 'rejected:UNAUTHORIZED');
  client.close();
});

test('a blocked account is rejected even with an otherwise valid token', async () => {
  const client = connectClient({ token: tokenFor(BLOCKED_USER) });
  // authenticateToken throws ApiError.forbidden for a blocked user, which the
  // handshake maps to UNAUTHORIZED - the point is that it never connects.
  assert.strictEqual(await settle(client), 'rejected:UNAUTHORIZED');
  client.close();
});

test('a pharmacy account gets no dashboard subscription', async () => {
  const client = connectClient({ token: tokenFor(PHARMACY_USER) });
  assert.strictEqual(await settle(client), 'rejected:NO_SUBSCRIPTIONS');
  client.close();
});

// --- 1b. Admin authentication ----------------------------------------------

test('a valid admin token connects successfully', async () => {
  const client = connectClient({ token: tokenFor(ADMIN_USER) });
  assert.strictEqual(await settle(client), 'connected');
  client.close();
});

test('a blocked admin is rejected', async () => {
  const client = connectClient({ token: tokenFor(BLOCKED_ADMIN_USER) });
  assert.strictEqual(await settle(client), 'rejected:UNAUTHORIZED');
  client.close();
});

test('a non-active (pending) admin is rejected', async () => {
  const client = connectClient({ token: tokenFor(PENDING_ADMIN_USER) });
  assert.strictEqual(await settle(client), 'rejected:FORBIDDEN');
  client.close();
});

test('role comes from the database, not the JWT claim', async () => {
  // This token claims role 'warehouse' for a user who is really an admin (see
  // tokenFor). If the server trusted the claim it would look for a warehouse
  // profile; because it loads the User instead, this connects as an admin.
  // The room assertion is in the isolation section below.
  const forgedRoleToken = jwt.sign(
    { sub: ADMIN_USER, role: 'warehouse' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
  const client = connectClient({ token: forgedRoleToken });
  assert.strictEqual(await settle(client), 'connected');

  // Proof it landed in the admin room and NOT warehouse:A - despite the
  // fixtures giving ADMIN_USER a warehouse profile at WAREHOUSE_A_ID.
  const warehouseTraffic = collect(client, EVENTS.ORDER_CREATED);
  const adminTraffic = collect(client, EVENTS.ACCOUNT_PENDING);
  await new Promise((resolve) => setTimeout(resolve, 50));
  emitToWarehouse(WAREHOUSE_A_ID, EVENTS.ORDER_CREATED, { orderId: 'o-forge' });
  emitToAdmins(EVENTS.ACCOUNT_PENDING, { userId: 'u-forge' });

  assert.deepStrictEqual(await warehouseTraffic, [], 'a claimed role must not grant a warehouse room');
  assert.strictEqual((await adminTraffic).length, 1, 'the real role from the DB decides the room');
  client.close();
});

// --- 2. Room authorization -------------------------------------------------

test('a client cannot join another warehouse room by asking for it', async () => {
  const clientB = connectClient({ token: tokenFor(WAREHOUSE_B_USER) });
  assert.strictEqual(await settle(clientB), 'connected');

  // There is no join handler server-side, so these are simply ignored. The
  // assertion below is what proves it: B still hears nothing from A's room.
  clientB.emit('join', `warehouse:${WAREHOUSE_A_ID}`);
  clientB.emit('subscribe', { room: `warehouse:${WAREHOUSE_A_ID}` });
  clientB.emit('join-room', `warehouse:${WAREHOUSE_A_ID}`);

  const receivedPromise = collect(clientB, EVENTS.ORDER_CREATED);
  await new Promise((resolve) => setTimeout(resolve, 100));
  emitToWarehouse(WAREHOUSE_A_ID, EVENTS.ORDER_CREATED, { orderId: 'o1', warehouseId: WAREHOUSE_A_ID });

  assert.deepStrictEqual(await receivedPromise, [], 'warehouse B must not receive warehouse A events');
  clientB.close();
});

// --- 3. Per-event warehouse isolation --------------------------------------

const ISOLATION_CASES = [
  [EVENTS.ORDER_CREATED, { orderId: 'o1', orderNumber: 11 }],
  [EVENTS.ORDER_CANCELLED, { orderId: 'o2', orderNumber: 12 }],
  [EVENTS.ORDER_STATUS_UPDATED, { orderId: 'o3', orderNumber: 13, status: 'confirmed' }],
  [EVENTS.RETURN_CREATED, { returnId: 'r1', orderId: 'o4' }],
  [EVENTS.RETURN_STATUS_UPDATED, { returnId: 'r2', orderId: 'o5', status: 'approved' }],
];

// Warehouse A, warehouse B and an admin, all connected at once - each case
// removes its own listeners (see collect). Reconnecting fresh clients per case
// churned through sockets fast enough to start timing out.
let isolationA;
let isolationB;
let isolationAdmin;

test('isolation fixture: two warehouses and an admin are connected', async () => {
  isolationA = connectClient({ token: tokenFor(WAREHOUSE_A_USER) });
  isolationB = connectClient({ token: tokenFor(WAREHOUSE_B_USER) });
  isolationAdmin = connectClient({ token: tokenFor(ADMIN_USER_2) });
  assert.strictEqual(await settle(isolationA), 'connected');
  assert.strictEqual(await settle(isolationB), 'connected');
  assert.strictEqual(await settle(isolationAdmin), 'connected');
});

for (const [event, payload] of ISOLATION_CASES) {
  test(`${event} reaches only the owning warehouse - not the other, not admins`, async () => {
    const receivedA = collect(isolationA, event);
    const receivedB = collect(isolationB, event);
    const receivedAdmin = collect(isolationAdmin, event);
    await new Promise((resolve) => setTimeout(resolve, 50));

    emitToWarehouse(WAREHOUSE_A_ID, event, { ...payload, warehouseId: WAREHOUSE_A_ID });

    const [a, b, admin] = await Promise.all([receivedA, receivedB, receivedAdmin]);
    assert.strictEqual(a.length, 1, `warehouse A should receive exactly one ${event}`);
    assert.strictEqual(a[0].eventType, event, 'payload carries its own event type');
    assert.strictEqual(b.length, 0, `warehouse B must never receive ${event} for warehouse A`);
    assert.strictEqual(admin.length, 0, `admins must not receive per-warehouse ${event}`);
  });
}

// --- 3b. Admin-room isolation ----------------------------------------------

const ADMIN_EVENT_CASES = [
  [EVENTS.ACCOUNT_PENDING, { userId: 'u1', role: 'pharmacy' }],
  [EVENTS.ACCOUNT_STATUS_UPDATED, { userId: 'u2', role: 'pharmacy', status: 'active' }],
  [EVENTS.OFFER_PENDING, { offerId: 'of1', warehouseId: WAREHOUSE_A_ID }],
  [EVENTS.OFFER_STATUS_UPDATED, { offerId: 'of2', warehouseId: WAREHOUSE_A_ID, status: 'approved' }],
  [EVENTS.BANNER_PENDING, { bannerId: 'b1', bannerNumber: 7, warehouseId: WAREHOUSE_A_ID }],
  [EVENTS.BANNER_STATUS_UPDATED, { bannerId: 'b2', bannerNumber: 8, status: 'approved' }],
];

for (const [event, payload] of ADMIN_EVENT_CASES) {
  test(`${event} reaches admins only - no warehouse receives it`, async () => {
    const receivedAdmin = collect(isolationAdmin, event);
    const receivedA = collect(isolationA, event);
    const receivedB = collect(isolationB, event);
    await new Promise((resolve) => setTimeout(resolve, 50));

    emitToAdmins(event, payload);

    const [admin, a, b] = await Promise.all([receivedAdmin, receivedA, receivedB]);
    assert.strictEqual(admin.length, 1, `admin should receive exactly one ${event}`);
    assert.strictEqual(admin[0].eventType, event, 'payload carries its own event type');
    assert.strictEqual(a.length, 0, `warehouse A must never receive admin event ${event}`);
    assert.strictEqual(b.length, 0, `warehouse B must never receive admin event ${event}`);
  });
}

test('every connected admin receives the same admin event', async () => {
  const secondAdmin = connectClient({ token: tokenFor(ADMIN_USER) });
  assert.strictEqual(await settle(secondAdmin), 'connected');

  const first = collect(isolationAdmin, EVENTS.ACCOUNT_PENDING);
  const second = collect(secondAdmin, EVENTS.ACCOUNT_PENDING);
  await new Promise((resolve) => setTimeout(resolve, 50));

  emitToAdmins(EVENTS.ACCOUNT_PENDING, { userId: 'shared-1' });

  // The queues are global, so both admins' screens must go stale together.
  assert.strictEqual((await first).length, 1);
  assert.strictEqual((await second).length, 1);
  secondAdmin.close();
});

test('a warehouse client cannot talk its way into the admin room', async () => {
  // No join handler exists server-side, so these are ignored outright. The
  // assertion is the proof: A still receives no admin traffic afterwards.
  isolationA.emit('join', 'admin');
  isolationA.emit('join-room', 'admin');
  isolationA.emit('subscribe', 'admin');
  isolationA.emit('subscribe', { room: 'admin' });

  const received = collect(isolationA, EVENTS.ACCOUNT_PENDING);
  await new Promise((resolve) => setTimeout(resolve, 100));
  emitToAdmins(EVENTS.ACCOUNT_PENDING, { userId: 'u-secret' });

  assert.deepStrictEqual(await received, [], 'a warehouse user must never enter the admin room');
});

test('an admin cannot talk its way into a warehouse room', async () => {
  isolationAdmin.emit('join', `warehouse:${WAREHOUSE_B_ID}`);
  isolationAdmin.emit('join-room', `warehouse:${WAREHOUSE_B_ID}`);
  isolationAdmin.emit('subscribe', `warehouse:${WAREHOUSE_B_ID}`);

  const received = collect(isolationAdmin, EVENTS.ORDER_CREATED);
  await new Promise((resolve) => setTimeout(resolve, 100));
  emitToWarehouse(WAREHOUSE_B_ID, EVENTS.ORDER_CREATED, { orderId: 'o-b' });

  assert.deepStrictEqual(await received, [], 'an admin must not gain a warehouse room by asking');
});

// --- 4. Emit safety --------------------------------------------------------

test('emitToWarehouse never throws when the realtime layer is not running', () => {
  // Scripts and any future test that imports a service must not blow up just
  // because no server was booted.
  //
  // The live instance is stashed and put back directly rather than calling
  // initRealtime() again - a second attach to the same http server breaks its
  // upgrade handling.
  const live = liveIo;
  _setIoForTesting(null);
  assert.doesNotThrow(() => emitToWarehouse(WAREHOUSE_A_ID, EVENTS.ORDER_CREATED, { orderId: 'x' }));
  _setIoForTesting(live);
});

test('emitToWarehouse ignores a missing warehouseId instead of broadcasting', async () => {
  const clientA = connectClient({ token: tokenFor(WAREHOUSE_A_USER) });
  assert.strictEqual(await settle(clientA), 'connected');

  const received = collect(clientA, EVENTS.ORDER_CREATED);
  await new Promise((resolve) => setTimeout(resolve, 100));
  emitToWarehouse(null, EVENTS.ORDER_CREATED, { orderId: 'orphan' });
  emitToWarehouse(undefined, EVENTS.ORDER_CREATED, { orderId: 'orphan2' });

  assert.deepStrictEqual(await received, [], 'a warehouse-less emit must reach nobody');
  clientA.close();
});

test('emitToAdmins never throws when the realtime layer is not running', () => {
  const live = liveIo;
  _setIoForTesting(null);
  assert.doesNotThrow(() => emitToAdmins(EVENTS.ACCOUNT_PENDING, { userId: 'x' }));
  _setIoForTesting(live);
});
