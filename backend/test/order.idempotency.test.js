// Order idempotency is keyed on the request's contents, not the key alone.
//
// The defect this guards against: the app kept its idempotency key across
// cart edits, and the server answered any request carrying a known key with
// the order that key first produced. So when the first submit's response was
// lost and the pharmacist then changed the cart and submitted again, the
// server handed back the OLD order, the app cleared the cart, and the edits
// were silently never ordered.
//
// Now every keyed order stores a fingerprint of what was asked for. The same
// key with the same contents is a retry and replays; the same key with
// different contents is refused with IDEMPOTENCY_KEY_REUSED.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-idempotency-tests';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const { startMemoryMongo, stopMemoryMongo, syncIndexes } = require('./helpers/mongo');

const app = require('../src/app');
const env = require('../src/config/env');

const User = require('../src/models/user.model');
const Pharmacy = require('../src/models/pharmacy.model');
const Warehouse = require('../src/models/warehouse.model');
const Product = require('../src/models/product.model');
const Order = require('../src/models/order.model');
const OrderItem = require('../src/models/orderItem.model');
const ExchangeRate = require('../src/models/exchangeRate.model');

const orderService = require('../src/services/order.service');

const { computeOrderFingerprint, normalizePackageRequests } = orderService;

const ids = {};
let pharmacyToken;
let server;
let baseUrl;

function newKey(label) {
  return `${label}-${new mongoose.Types.ObjectId().toString()}`;
}

function submit({ key, items, notes = null }) {
  return orderService.createOrder({
    userId: ids.pharmacyUser,
    pharmacyId: ids.pharmacy,
    warehouseId: ids.warehouse,
    items,
    notes,
    idempotencyKey: key,
  });
}

function line(productId, quantity, displayedUnitPriceUsd = 100) {
  return { productId: productId.toString(), quantity, displayedUnitPriceUsd };
}

// Rejects with exactly IDEMPOTENCY_KEY_REUSED, naming the order the key
// already produced.
function isKeyReused(expectedOrder) {
  return (err) => {
    assert.strictEqual(err.code, 'IDEMPOTENCY_KEY_REUSED');
    assert.strictEqual(err.statusCode, 409);
    assert.strictEqual(err.details.orderId, String(expectedOrder._id));
    assert.strictEqual(err.details.orderNumber, expectedOrder.orderNumber);
    return true;
  };
}

function orderCount() {
  return Order.countDocuments({ pharmacyId: ids.pharmacy });
}

async function call(method, path, body) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pharmacyToken}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
}

test.before(async () => {
  await startMemoryMongo({ dbName: 'feniq-order-idempotency-test' });
  // The unique (pharmacyId, idempotencyKey) index is what the race test below
  // leans on, and orders are written in a transaction.
  await syncIndexes(Order, OrderItem);
  await ExchangeRate.create({ _id: 'singleton', usdToSyp: 10000, source: 'manual' });

  const [phUser, whUser] = await User.create([
    { name: 'Ph', phone: '0931000301', role: 'pharmacy', status: 'active' },
    { name: 'WH', phone: '0941000301', role: 'warehouse', status: 'active' },
  ]);
  ids.pharmacyUser = phUser._id;
  pharmacyToken = jwt.sign({ sub: String(phUser._id) }, env.jwtSecret, { expiresIn: '1h' });

  const pharmacy = await Pharmacy.create({
    userId: phUser._id, nameAr: 'ص', nameEn: 'Pharmacy', ownerName: 'O',
    address: 'a', city: 'Latakia', areaType: 'city', phone: '0931000301', addedBy: 'self',
  });
  ids.pharmacy = pharmacy._id;

  const warehouse = await Warehouse.create({
    userId: whUser._id, nameAr: 'م', nameEn: 'Warehouse', address: 'r', city: 'Latakia',
    phone: '0941000301', deliveryType: 'self', isActive: true, discountRate: 0, commissionRate: 0,
  });
  ids.warehouse = warehouse._id;

  const [productA, productB] = await Product.create([
    {
      warehouseId: warehouse._id, nameAr: 'دواء أ', nameEn: 'Drug A', manufacturerAr: 'شركة',
      price: 100, unitAr: 'علبة', unitEn: 'box', isAvailable: true, isActive: true,
    },
    {
      warehouseId: warehouse._id, nameAr: 'دواء ب', nameEn: 'Drug B', manufacturerAr: 'شركة',
      price: 100, unitAr: 'علبة', unitEn: 'box', isAvailable: true, isActive: true,
    },
  ]);
  ids.productA = productA._id;
  ids.productB = productB._id;

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await stopMemoryMongo();
});

test.beforeEach(async () => {
  await Promise.all([Order.deleteMany({}), OrderItem.deleteMany({})]);
});

// --- the fingerprint itself ---------------------------------------------------

function fingerprint({
  warehouseId = 'w1',
  items = [],
  packages = null,
  advertisementId = null,
  notes = null,
} = {}) {
  return computeOrderFingerprint({
    warehouseId,
    items,
    packageRequests: normalizePackageRequests({ packages, advertisementId }),
    notes,
  });
}

test('fingerprint: the same request always hashes the same', () => {
  const request = {
    items: [line('p1', 2), line('p2', 1)],
    packages: [{ advertisementId: 'ad1', copies: 2 }],
    notes: 'back door',
  };
  assert.strictEqual(fingerprint(request), fingerprint(request));
  assert.match(fingerprint(request), /^[0-9a-f]{64}$/);
});

test('fingerprint: line order, duplicate lines and note whitespace do not matter', () => {
  const base = fingerprint({
    items: [line('p1', 3), line('p2', 1)],
    packages: [{ advertisementId: 'ad1', copies: 1 }, { advertisementId: 'ad2', copies: 1 }],
    notes: 'back door',
  });

  assert.strictEqual(
    fingerprint({
      items: [line('p2', 1), line('p1', 3)],
      packages: [{ advertisementId: 'ad2', copies: 1 }, { advertisementId: 'ad1', copies: 1 }],
      notes: 'back door',
    }),
    base,
    'reordered lines and packages'
  );
  assert.strictEqual(
    fingerprint({
      // Merged exactly as createOrder merges them: one line of 3.
      items: [line('p1', 1), line('p2', 1), line('p1', 2)],
      packages: [{ advertisementId: 'ad1', copies: 1 }, { advertisementId: 'ad2', copies: 1 }],
      notes: '  back door  ',
    }),
    base,
    'duplicate lines merged, notes trimmed'
  );
  assert.strictEqual(
    fingerprint({ items: [line('p1', 1)], notes: '   ' }),
    fingerprint({ items: [line('p1', 1)], notes: null }),
    'whitespace-only notes are no notes'
  );
});

test('fingerprint: sub-cent noise in the displayed price does not matter, a cent does', () => {
  const at = (price) => fingerprint({ items: [line('p1', 1, price)] });
  assert.strictEqual(at(10.001), at(10.004));
  assert.notStrictEqual(at(10), at(10.01));
  assert.notStrictEqual(at(10), fingerprint({ items: [line('p1', 1, null)] }));
});

test('fingerprint: every change that alters the order changes the hash', () => {
  const base = {
    warehouseId: 'w1',
    items: [line('p1', 2)],
    packages: [{ advertisementId: 'ad1', copies: 1 }],
    notes: 'back door',
  };
  const baseHash = fingerprint(base);
  const variants = {
    'another warehouse': { ...base, warehouseId: 'w2' },
    'a different quantity': { ...base, items: [line('p1', 3)] },
    'an extra line': { ...base, items: [line('p1', 2), line('p2', 1)] },
    'a removed line': { ...base, items: [] },
    'more package copies': { ...base, packages: [{ advertisementId: 'ad1', copies: 2 }] },
    'another package': { ...base, packages: [{ advertisementId: 'ad2', copies: 1 }] },
    'different notes': { ...base, notes: 'front door' },
    'no notes': { ...base, notes: null },
    // The pre-packages shape deducts the package's products from the loose
    // lines, so it is a different order from the same package sent as a
    // `packages` entry.
    'the legacy package field': { ...base, packages: null, advertisementId: 'ad1' },
  };
  for (const [label, variant] of Object.entries(variants)) {
    assert.notStrictEqual(fingerprint(variant), baseHash, label);
  }
});

// --- createOrder ------------------------------------------------------------

test('the same key with the same contents replays the first order (idempotent)', async () => {
  const key = newKey('same');
  const items = [line(ids.productA, 2)];

  const first = await submit({ key, items, notes: 'back door' });
  // Same meaning, different spelling - still a retry of the same order.
  const second = await submit({ key, items: [line(ids.productA, 2)], notes: '  back door ' });

  assert.strictEqual(String(second._id), String(first._id));
  assert.strictEqual(second.$locals.idempotentReplay, true);
  assert.strictEqual(first.$locals.idempotentReplay, undefined, 'the first one was really placed');
  assert.strictEqual(await orderCount(), 1);

  const stored = await Order.findById(first._id).lean();
  assert.match(stored.idempotencyFingerprint, /^[0-9a-f]{64}$/);
});

test('the same key with different contents is refused with IDEMPOTENCY_KEY_REUSED', async () => {
  const key = newKey('reused');
  const first = await submit({ key, items: [line(ids.productA, 2)], notes: 'back door' });

  await assert.rejects(submit({ key, items: [line(ids.productA, 5)], notes: 'back door' }), isKeyReused(first));
  await assert.rejects(
    submit({ key, items: [line(ids.productA, 2), line(ids.productB, 1)], notes: 'back door' }),
    isKeyReused(first)
  );
  await assert.rejects(submit({ key, items: [line(ids.productA, 2)], notes: 'front door' }), isKeyReused(first));

  assert.strictEqual(await orderCount(), 1, 'no second order');
  const [firstLine] = await OrderItem.find({ orderId: first._id }).lean();
  assert.strictEqual(firstLine.quantity, 2, 'the original order is untouched');
});

test('editing the cart after a lost response never yields the old order', async () => {
  // Attempt 1 reached the server and placed the order, but the app never got
  // the response, so all the pharmacist saw was a network error.
  const lostKey = newKey('lost');
  const placed = await submit({ key: lostKey, items: [line(ids.productA, 1)] });

  // They raise the quantity and submit again. A build that still sends the
  // old key is refused rather than handed the stale order...
  await assert.rejects(submit({ key: lostKey, items: [line(ids.productA, 4)] }), isKeyReused(placed));

  // ...and the current app, which drops its key on every cart edit, gets its
  // edited cart placed as a new order.
  const edited = await submit({ key: newKey('edited'), items: [line(ids.productA, 4)] });
  assert.notStrictEqual(String(edited._id), String(placed._id));
  assert.strictEqual(edited.$locals.idempotentReplay, undefined);
  const [editedLine] = await OrderItem.find({ orderId: edited._id }).lean();
  assert.strictEqual(editedLine.quantity, 4, 'what was ordered is the edited cart');
});

test('two concurrent submissions under one key with different contents place one order', async () => {
  const key = newKey('race');
  const results = await Promise.allSettled([
    submit({ key, items: [line(ids.productA, 1)] }),
    submit({ key, items: [line(ids.productA, 7)] }),
  ]);

  const placed = results.filter((r) => r.status === 'fulfilled');
  const refused = results.filter((r) => r.status === 'rejected');
  assert.strictEqual(placed.length, 1, 'exactly one request wins');
  assert.strictEqual(refused.length, 1, 'the other is refused, not handed the winner');
  assert.ok(isKeyReused(placed[0].value)(refused[0].reason));
  assert.strictEqual(await orderCount(), 1);
});

test('an order placed before fingerprints existed still replays on its key alone', async () => {
  const key = newKey('legacy');
  const first = await submit({ key, items: [line(ids.productA, 1)] });
  // What every keyed order written before this change looks like.
  await Order.updateOne({ _id: first._id }, { $set: { idempotencyFingerprint: null } });

  const retry = await submit({ key, items: [line(ids.productA, 9)] });

  assert.strictEqual(String(retry._id), String(first._id));
  assert.strictEqual(retry.$locals.idempotentReplay, true);
  assert.strictEqual(await orderCount(), 1);
});

test('an order placed without a key stores no fingerprint', async () => {
  const order = await submit({ key: null, items: [line(ids.productA, 1)] });
  const stored = await Order.findById(order._id).lean();
  assert.strictEqual(stored.idempotencyKey, null);
  assert.strictEqual(stored.idempotencyFingerprint, null);
});

// --- over the wire ------------------------------------------------------------

test('POST /orders: replay is 200 + Idempotent-Replay, a reused key is 409 IDEMPOTENCY_KEY_REUSED', async () => {
  const body = {
    warehouseId: ids.warehouse.toString(),
    items: [line(ids.productA, 2)],
    idempotencyKey: newKey('http'),
  };

  const first = await call('POST', '/orders', body);
  assert.strictEqual(first.status, 201);

  const replay = await call('POST', '/orders', body);
  assert.strictEqual(replay.status, 200);
  assert.strictEqual(replay.headers.get('idempotent-replay'), 'true');
  assert.strictEqual(replay.body.order.id, first.body.order.id);

  const reused = await call('POST', '/orders', { ...body, items: [line(ids.productA, 3)] });
  assert.strictEqual(reused.status, 409);
  assert.strictEqual(reused.headers.get('idempotent-replay'), null);
  assert.strictEqual(reused.body.success, false);
  assert.strictEqual(reused.body.code, 'IDEMPOTENCY_KEY_REUSED');
  assert.strictEqual(reused.body.details.orderId, first.body.order.id);
  assert.strictEqual(reused.body.details.orderNumber, first.body.order.orderNumber);
  assert.ok(!('order' in reused.body), 'the old order is not handed back');

  assert.strictEqual(await orderCount(), 1);
});
