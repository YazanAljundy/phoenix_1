// Boots an in-memory MongoDB **replica set** for a test file.
//
// Money-Flow V2 runs every financial write inside a transaction, and
// transactions need a replica set - so tests can no longer point at a plain
// local `mongod` on 27017 the way the V1 suites did. `replSet` here is what
// makes session.withTransaction() actually work; a single member is enough.
//
// Usage:
//   const { startMemoryMongo, stopMemoryMongo, clearCollections } = require('./helpers/mongo');
//   test.before(async () => { await startMemoryMongo(); /* seed */ });
//   test.after(async () => { await stopMemoryMongo(); });
//
// The first run downloads a MongoDB binary into node_modules/.cache - one
// time, and cached across test files and runs.
const mongoose = require('mongoose');

// mongodb-memory-server defaults to a 10s launch timeout, which is not enough
// on a loaded or cold machine - every test file boots its own instance and the
// runner runs files in parallel. The failure surfaces as an unhelpful
// "Instance failed to start within 10000ms" attributed to whichever test
// happened to be next, so it is worth raising generously.
const LAUNCH_TIMEOUT_MS = Number(process.env.MONGOMS_LAUNCH_TIMEOUT) || 120000;

let replSet = null;

// The download is slow the first time; node:test's default timeout is
// generous but the boot itself can still take a few seconds on a cold cache.
async function startMemoryMongo({ dbName = 'phoenix-test' } = {}) {
  if (replSet) return mongoose.connection;

  // Required lazily so a test file that never calls this pays nothing for it,
  // and so the package is only a hard dependency of the suites that need it.
  const { MongoMemoryReplSet } = require('mongodb-memory-server');

  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
    instanceOpts: [{ launchTimeout: LAUNCH_TIMEOUT_MS }],
  });

  await mongoose.connect(replSet.getUri(dbName));
  return mongoose.connection;
}

async function stopMemoryMongo() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
  if (replSet) {
    await replSet.stop();
    replSet = null;
  }
}

// Empties the named collections between tests without tearing the server down
// (a restart per test would dominate the runtime). Pass Mongoose models.
async function clearCollections(...models) {
  await Promise.all(models.map((model) => model.deleteMany({})));
}

// Mongoose only builds indexes lazily, and several V2 guarantees (one charge
// per order, one reversal per entry, unique idempotency keys) are *unique
// indexes*. A test asserting those must force them to exist first.
async function syncIndexes(...models) {
  for (const model of models) {
    await model.syncIndexes();
  }
}

module.exports = { startMemoryMongo, stopMemoryMongo, clearCollections, syncIndexes };
