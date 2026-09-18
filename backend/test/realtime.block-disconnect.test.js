// Audit F-10: blocking an account must cut its *already open* Socket.IO
// connections, not just stop the next HTTP request.
//
// Like realtime.test.js, this drives a REAL Socket.IO server over a real port
// with real clients - what is under test is an actual disconnect arriving at an
// actual client, which a mocked socket could not demonstrate. The Mongoose
// models are stubbed through require.cache so no database is needed.
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/feniq-test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-realtime-tests-p';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const { io: ioClient } = require('socket.io-client');

const { modelQuery } = require('./helpers/model-query-stub');

const users = new Map();
const warehousesByUserId = new Map();
const deletedRefreshTokensFor = [];

function stubModule(relativePath, exportsValue) {
  const resolved = require.resolve(path.join(__dirname, '..', 'src', relativePath));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsValue };
}

stubModule('models/user.model.js', {
  findById: modelQuery((id) => users.get(String(id)) ?? null),
});
stubModule('models/warehouse.model.js', {
  findOne: modelQuery((filter) => warehousesByUserId.get(String(filter.userId)) ?? null),
});
stubModule('models/pharmacy.model.js', { findOne: modelQuery(() => null) });
stubModule('models/refreshToken.model.js', {
  deleteMany: async (filter) => {
    deletedRefreshTokensFor.push(String(filter.userId));
    return { deletedCount: 0 };
  },
});
// admin.service pulls this in at require time; nothing here exercises push.
stubModule('services/notification.service.js', {});

const { initRealtime, disconnectUser, _setIoForTesting } = require('../src/realtime');
const adminService = require('../src/services/admin.service');

// 24 hex chars: blockAccount runs these through mongoose's ObjectId.isValid.
const WAREHOUSE_USER = 'aaaaaaaaaaaaaaaaaaaaaaa1';
const OTHER_WAREHOUSE_USER = 'bbbbbbbbbbbbbbbbbbbbbbb1';
const WAREHOUSE_ID = 'a0a0a0a0a0a0a0a0a0a0a0a0';
const OTHER_WAREHOUSE_ID = 'b0b0b0b0b0b0b0b0b0b0b0b0';

function makeUser(id) {
  return {
    _id: id,
    role: 'warehouse',
    status: 'active',
    tokenVersion: 0,
    // blockAccount mutates the document then saves it; the stub only records
    // that the save happened, so the assertions can tell a persisted status
    // change apart from a broadcast-only one.
    saved: 0,
    async save() {
      this.saved += 1;
      return this;
    },
  };
}

function seedFixtures() {
  users.clear();
  warehousesByUserId.clear();
  deletedRefreshTokensFor.length = 0;
  users.set(WAREHOUSE_USER, makeUser(WAREHOUSE_USER));
  users.set(OTHER_WAREHOUSE_USER, makeUser(OTHER_WAREHOUSE_USER));
  warehousesByUserId.set(WAREHOUSE_USER, { _id: WAREHOUSE_ID, userId: WAREHOUSE_USER });
  warehousesByUserId.set(OTHER_WAREHOUSE_USER, {
    _id: OTHER_WAREHOUSE_ID,
    userId: OTHER_WAREHOUSE_USER,
  });
}

function tokenFor(userId) {
  return jwt.sign({ sub: userId, role: 'warehouse' }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

let server;
let baseUrl;
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

function connected(client) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('client never connected')), 3000);
    client.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    client.once('connect_error', (err) => {
      clearTimeout(timer);
      reject(new Error(`rejected: ${err.message}`));
    });
  });
}

// Returns a promise for the next 'disconnect', resolving null if none arrives
// in `ms`. Always created BEFORE the action that should cause the disconnect: a
// close that lands before the listener is attached is a lost event, and the
// test would then fail on listener timing rather than on the behavior it means
// to check.
function disconnectWithin(client, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    client.once('disconnect', (reason) => {
      clearTimeout(timer);
      resolve(reason);
    });
  });
}

test.before(async () => {
  seedFixtures();
  server = http.createServer();
  _setIoForTesting(null);
  initRealtime(server);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  for (const client of openClients) client.close();
  await new Promise((resolve) => server.close(resolve));
});

test('blocking a currently-connected account drops its socket', async () => {
  seedFixtures();
  const client = connectClient({ token: tokenFor(WAREHOUSE_USER) });
  await connected(client);
  assert.strictEqual(client.connected, true, 'precondition: the client is connected');

  const dropped = disconnectWithin(client, 3000);
  await adminService.blockAccount(WAREHOUSE_USER);

  const reason = await dropped;
  assert.ok(reason, 'the socket should have been closed by the server, not left open');
  assert.strictEqual(client.connected, false);
  // The status change was persisted, not merely broadcast.
  assert.strictEqual(users.get(WAREHOUSE_USER).status, 'blocked');
  assert.strictEqual(users.get(WAREHOUSE_USER).saved, 1);
});

test('blocking one account leaves other accounts connected', async () => {
  seedFixtures();
  const victim = connectClient({ token: tokenFor(WAREHOUSE_USER) });
  const bystander = connectClient({ token: tokenFor(OTHER_WAREHOUSE_USER) });
  await Promise.all([connected(victim), connected(bystander)]);

  const victimDropped = disconnectWithin(victim, 3000);
  const bystanderDropped = disconnectWithin(bystander, 600);
  await adminService.blockAccount(WAREHOUSE_USER);

  assert.ok(await victimDropped, 'the blocked account should be disconnected');
  assert.strictEqual(await bystanderDropped, null, 'an unrelated account must stay connected');
  assert.strictEqual(bystander.connected, true);

  victim.close();
  bystander.close();
});

test('a blocked account cannot immediately reconnect', async () => {
  seedFixtures();
  const client = connectClient({ token: tokenFor(WAREHOUSE_USER) });
  await connected(client);

  const dropped = disconnectWithin(client, 3000);
  await adminService.blockAccount(WAREHOUSE_USER);
  await dropped;

  // The same still-unexpired token: handshakeAuth re-reads status from the DB,
  // so the refusal comes from the account state rather than from the token.
  const retry = connectClient({ token: tokenFor(WAREHOUSE_USER) });
  await assert.rejects(() => connected(retry), /rejected: UNAUTHORIZED/);
  retry.close();
});

test('disconnectUser is a no-op for a user with no open sockets', () => {
  seedFixtures();
  assert.strictEqual(disconnectUser(OTHER_WAREHOUSE_USER), 0);
  assert.strictEqual(disconnectUser(null), 0);
  assert.strictEqual(disconnectUser('nobody'), 0);
});

test('a closed socket is untracked, so a later block disconnects nothing', async () => {
  seedFixtures();
  const client = connectClient({ token: tokenFor(WAREHOUSE_USER) });
  await connected(client);

  const dropped = disconnectWithin(client, 3000);
  client.close();
  await dropped;
  // The server's own 'disconnect' handler runs a tick after the client's.
  await new Promise((resolve) => setTimeout(resolve, 150));

  assert.strictEqual(
    disconnectUser(WAREHOUSE_USER),
    0,
    'the registry should have dropped the closed socket'
  );
});
