// Regression tests for the notification broadcast fan-out.
//
// sendToAll used to be `Promise.all(userIds.map(sendToUser))`: every recipient's
// User.findById and Notification.create issued at once. At 535 recipients that
// took an unrelated GET /exchange-rate from a 13 ms median to 1,242 ms. It is
// now a bounded worker pool.
//
// What has to stay true: every eligible recipient still gets exactly one
// Notification row, one failing recipient never costs the others, and the
// number of simultaneous operations is actually capped.
process.env.MONGODB_URI = 'mongodb://localhost:27017/phoenix-fanout-test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-fanout-tests';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');

const User = require('../src/models/user.model');
const Notification = require('../src/models/notification.model');
const notificationService = require('../src/services/notification.service');

const { sendToAll, _mapWithConcurrency, FANOUT_CONCURRENCY } = notificationService;

const PAYLOAD = {
  titleAr: 'عنوان', titleEn: 'Title',
  bodyAr: 'نص', bodyEn: 'Body',
  type: 'system',
};

test.before(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  await mongoose.connection.dropDatabase();
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

// ---------------------------------------------------------------------------
// The concurrency primitive
// ---------------------------------------------------------------------------

test('the worker pool never exceeds its concurrency limit', async () => {
  let inFlight = 0;
  let peak = 0;
  const items = Array.from({ length: 200 }, (_, i) => i);

  await _mapWithConcurrency(items, 8, async () => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 1));
    inFlight -= 1;
  });

  assert.ok(peak <= 8, `peak concurrency was ${peak}, limit was 8`);
  assert.ok(peak > 1, 'it must still be concurrent, not serialised');
});

test('the worker pool processes every item exactly once', async () => {
  const items = Array.from({ length: 137 }, (_, i) => i);
  const seen = [];
  await _mapWithConcurrency(items, 10, async (item) => {
    await new Promise((resolve) => setTimeout(resolve, Math.random() * 2));
    seen.push(item);
  });
  assert.strictEqual(seen.length, items.length);
  assert.deepStrictEqual([...seen].sort((a, b) => a - b), items);
});

test('one throwing item does not abort the rest of the fan-out', async () => {
  const items = Array.from({ length: 50 }, (_, i) => i);
  const completed = [];
  await _mapWithConcurrency(items, 5, async (item) => {
    if (item % 7 === 0) throw new Error('recipient ' + item + ' failed');
    completed.push(item);
  });
  const expected = items.filter((i) => i % 7 !== 0);
  assert.deepStrictEqual([...completed].sort((a, b) => a - b), expected);
});

test('a pool smaller than the limit does not spawn idle workers', async () => {
  let started = 0;
  await _mapWithConcurrency([1, 2], 50, async () => { started += 1; });
  assert.strictEqual(started, 2);
});

test('an empty recipient list is a no-op', async () => {
  await _mapWithConcurrency([], FANOUT_CONCURRENCY, async () => {
    assert.fail('the worker must never run for an empty list');
  });
});

// ---------------------------------------------------------------------------
// Delivery behaviour
// ---------------------------------------------------------------------------

test('a broadcast writes exactly one notification per recipient', async () => {
  const users = await User.create(
    Array.from({ length: 60 }, (_, i) => ({
      name: 'Recipient ' + i,
      phone: '0921' + String(i).padStart(6, '0'),
      role: i % 2 === 0 ? 'pharmacy' : 'warehouse',
      status: 'active',
    }))
  );
  const userIds = users.map((u) => u._id);

  await sendToAll(userIds, PAYLOAD);

  const written = await Notification.countDocuments({ type: 'system' });
  assert.strictEqual(written, userIds.length, 'every recipient must get exactly one row');

  for (const userId of userIds.slice(0, 5)) {
    const rows = await Notification.find({ userId }).lean();
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].titleAr, PAYLOAD.titleAr);
    assert.strictEqual(rows[0].titleEn, PAYLOAD.titleEn);
    assert.strictEqual(rows[0].bodyAr, PAYLOAD.bodyAr);
    assert.strictEqual(rows[0].bodyEn, PAYLOAD.bodyEn);
    assert.strictEqual(rows[0].isRead, false);
    assert.strictEqual(rows[0].relatedOrderId, null);
  }
});

test('a recipient that no longer exists is skipped without failing the broadcast', async () => {
  await Notification.deleteMany({});
  const real = await User.create({
    name: 'Still here', phone: '0922000001', role: 'pharmacy', status: 'active',
  });
  const ghost = new mongoose.Types.ObjectId();

  // The ghost sits in the middle, so a failure there would strand the tail.
  await sendToAll([ghost, real._id, ghost], PAYLOAD);

  assert.strictEqual(await Notification.countDocuments({ userId: real._id }), 1);
  assert.strictEqual(await Notification.countDocuments({ userId: ghost }), 0);
});

test('a user document with no deviceTokens field still gets its notification', async () => {
  await Notification.deleteMany({});
  // Inserted through the raw driver so `deviceTokens` is genuinely absent -
  // the case where .lean() would otherwise skip the schema default and throw.
  const legacyId = new mongoose.Types.ObjectId();
  await mongoose.connection.collection('users').insertOne({
    _id: legacyId,
    name: 'Legacy user',
    phone: '0923000001',
    role: 'pharmacy',
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    __v: 0,
  });

  await sendToAll([legacyId], PAYLOAD);
  assert.strictEqual(
    await Notification.countDocuments({ userId: legacyId }), 1,
    'a pre-deviceTokens user record must still receive its in-app notification'
  );
});

test('the offer rate limit still suppresses a second offer inside 24h', async () => {
  await Notification.deleteMany({});
  const user = await User.create({
    name: 'Offer target', phone: '0924000001', role: 'pharmacy', status: 'active',
  });
  const offerPayload = { ...PAYLOAD, type: 'offer' };

  await sendToAll([user._id], offerPayload);
  assert.strictEqual(await Notification.countDocuments({ userId: user._id, type: 'offer' }), 1);

  // Second broadcast in the same window must be dropped, exactly as before.
  await sendToAll([user._id], offerPayload);
  assert.strictEqual(
    await Notification.countDocuments({ userId: user._id, type: 'offer' }), 1,
    'the 24h per-user offer cap must survive the concurrency change'
  );
});

test('the default fan-out concurrency stays well inside the driver connection pool', () => {
  assert.ok(FANOUT_CONCURRENCY >= 5, 'too low would make broadcasts needlessly slow');
  assert.ok(
    FANOUT_CONCURRENCY <= 50,
    'the mongoose/driver default maxPoolSize is 100; the fan-out must not be able to monopolise it'
  );
});
