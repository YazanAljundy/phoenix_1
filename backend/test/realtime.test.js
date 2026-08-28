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

function stubModule(relativePath, exportsValue) {
  const resolved = require.resolve(path.join(__dirname, '..', 'src', relativePath));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsValue };
}

stubModule('models/user.model.js', {
  findById: async (id) => users.get(String(id)) ?? null,
});
stubModule('models/warehouse.model.js', {
  findOne: async (filter) => warehousesByUserId.get(String(filter.userId)) ?? null,
});

const { initRealtime, emitToWarehouse, EVENTS, _setIoForTesting } = require('../src/realtime');

// --- Fixtures --------------------------------------------------------------
const WAREHOUSE_A_USER = 'aaaaaaaaaaaaaaaaaaaaaaa1';
const WAREHOUSE_B_USER = 'bbbbbbbbbbbbbbbbbbbbbbb1';
const PHARMACY_USER = 'ccccccccccccccccccccccc1';
const BLOCKED_USER = 'ddddddddddddddddddddddd1';
const WAREHOUSE_A_ID = 'a0a0a0a0a0a0a0a0a0a0a0a0';
const WAREHOUSE_B_ID = 'b0b0b0b0b0b0b0b0b0b0b0b0';

function seedFixtures() {
  users.clear();
  warehousesByUserId.clear();

  users.set(WAREHOUSE_A_USER, { _id: WAREHOUSE_A_USER, role: 'warehouse', status: 'active' });
  users.set(WAREHOUSE_B_USER, { _id: WAREHOUSE_B_USER, role: 'warehouse', status: 'active' });
  users.set(PHARMACY_USER, { _id: PHARMACY_USER, role: 'pharmacy', status: 'active' });
  users.set(BLOCKED_USER, { _id: BLOCKED_USER, role: 'warehouse', status: 'blocked' });

  warehousesByUserId.set(WAREHOUSE_A_USER, { _id: WAREHOUSE_A_ID, userId: WAREHOUSE_A_USER });
  warehousesByUserId.set(WAREHOUSE_B_USER, { _id: WAREHOUSE_B_ID, userId: WAREHOUSE_B_USER });
  warehousesByUserId.set(BLOCKED_USER, { _id: WAREHOUSE_A_ID, userId: BLOCKED_USER });
}

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

// One connected pair, reused across the five cases - each case removes its
// own listeners (see collect). Reconnecting a fresh pair per case churned
// through sockets fast enough to start timing out.
let isolationA;
let isolationB;

test('isolation fixture: both warehouse dashboards are connected', async () => {
  isolationA = connectClient({ token: tokenFor(WAREHOUSE_A_USER) });
  isolationB = connectClient({ token: tokenFor(WAREHOUSE_B_USER) });
  assert.strictEqual(await settle(isolationA), 'connected');
  assert.strictEqual(await settle(isolationB), 'connected');
});

for (const [event, payload] of ISOLATION_CASES) {
  test(`${event} reaches only the owning warehouse`, async () => {
    const receivedA = collect(isolationA, event);
    const receivedB = collect(isolationB, event);
    await new Promise((resolve) => setTimeout(resolve, 50));

    emitToWarehouse(WAREHOUSE_A_ID, event, { ...payload, warehouseId: WAREHOUSE_A_ID });

    const [a, b] = await Promise.all([receivedA, receivedB]);
    assert.strictEqual(a.length, 1, `warehouse A should receive exactly one ${event}`);
    assert.strictEqual(a[0].eventType, event, 'payload carries its own event type');
    assert.strictEqual(b.length, 0, `warehouse B must never receive ${event} for warehouse A`);
  });
}

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
