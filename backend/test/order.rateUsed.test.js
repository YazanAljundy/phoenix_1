// An order is priced in USD and billed in SYP at the rate the server holds
// when it is placed. The app shows that SYP total first, converted at the rate
// IT holds - so a rate that moved in between billed a total the pharmacist
// never agreed to, silently: PRICE_CHANGED compares USD prices and catches
// none of it.
//
// Now the app says which rate it converted with, and an order agreed to at a
// rate that has since moved is refused with the same 409 RATE_CHANGED the web
// panel uses, carrying both rates so the app can show the new total and ask
// again.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-order-rate-tests';
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

const RATE = 10000;
const ids = {};
let pharmacyToken;
let server;
let baseUrl;

function line(productId, quantity = 1, displayedUnitPriceUsd = 100) {
  return { productId: productId.toString(), quantity, displayedUnitPriceUsd };
}

function submit({ rateUsed, items, idempotencyKey = null }) {
  return orderService.createOrder({
    userId: ids.pharmacyUser,
    pharmacyId: ids.pharmacy,
    warehouseId: ids.warehouse,
    items,
    notes: null,
    idempotencyKey,
    rateUsed,
  });
}

// Refused with exactly the shape the panel already gets, so one client
// handler serves both.
function isRateChanged({ rateUsed, currentUsdToSyp }) {
  return (err) => {
    assert.strictEqual(err.code, 'RATE_CHANGED');
    assert.strictEqual(err.statusCode, 409);
    assert.deepStrictEqual(err.details, { rateUsed, currentUsdToSyp });
    return true;
  };
}

function orderCount() {
  return Order.countDocuments({ pharmacyId: ids.pharmacy });
}

async function setRate(usdToSyp) {
  await ExchangeRate.findByIdAndUpdate('singleton', { usdToSyp, source: 'manual' });
}

async function call(method, path, body) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pharmacyToken}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

test.before(async () => {
  await startMemoryMongo({ dbName: 'feniq-order-rate-test' });
  await syncIndexes(Order, OrderItem);
  await ExchangeRate.create({ _id: 'singleton', usdToSyp: RATE, source: 'manual' });

  const [phUser, whUser] = await User.create([
    { name: 'Ph', phone: '0931000401', role: 'pharmacy', status: 'active' },
    { name: 'WH', phone: '0941000401', role: 'warehouse', status: 'active' },
  ]);
  ids.pharmacyUser = phUser._id;
  pharmacyToken = jwt.sign({ sub: String(phUser._id) }, env.jwtSecret, { expiresIn: '1h' });

  const pharmacy = await Pharmacy.create({
    userId: phUser._id, nameAr: 'ص', nameEn: 'Pharmacy', ownerName: 'O',
    address: 'a', city: 'Latakia', areaType: 'city', phone: '0931000401', addedBy: 'self',
  });
  ids.pharmacy = pharmacy._id;

  const warehouse = await Warehouse.create({
    userId: whUser._id, nameAr: 'م', nameEn: 'Warehouse', address: 'r', city: 'Latakia',
    phone: '0941000401', deliveryType: 'self', isActive: true, discountRate: 0, commissionRate: 0,
  });
  ids.warehouse = warehouse._id;

  const product = await Product.create({
    warehouseId: warehouse._id, nameAr: 'دواء', nameEn: 'Drug', manufacturerAr: 'شركة',
    price: 100, unitAr: 'علبة', unitEn: 'box', isAvailable: true, isActive: true,
  });
  ids.product = product._id;

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
  await setRate(RATE);
});

test('an order converted at the current rate is placed', async () => {
  const order = await submit({ rateUsed: RATE, items: [line(ids.product, 2)] });

  assert.ok(order._id);
  // Priced at the same rate the pharmacist was shown: 2 x $100 x 10000.
  assert.strictEqual(order.totalPrice, 2 * 100 * RATE);
  assert.strictEqual(await orderCount(), 1);
});

test('a stale rate is refused with RATE_CHANGED naming both rates', async () => {
  await setRate(12000);

  await assert.rejects(
    () => submit({ rateUsed: RATE, items: [line(ids.product, 2)] }),
    isRateChanged({ rateUsed: RATE, currentUsdToSyp: 12000 })
  );
  // Refused before anything was written - not a placed order the pharmacist
  // would have to cancel.
  assert.strictEqual(await orderCount(), 0);
});

test("an admin's rate change between the screen and the tap refuses the order, and the retry at the new rate places it", async () => {
  const items = [line(ids.product, 3)];
  // The pharmacist's screen converted at RATE; an admin moves it while they
  // are deciding.
  await setRate(11500);

  await assert.rejects(
    () => submit({ rateUsed: RATE, items }),
    isRateChanged({ rateUsed: RATE, currentUsdToSyp: 11500 })
  );
  assert.strictEqual(await orderCount(), 0);

  // The app refreshed the rate, showed the new total, and the pharmacist
  // confirmed.
  const order = await submit({ rateUsed: 11500, items });
  assert.strictEqual(order.totalPrice, 3 * 100 * 11500);
  assert.strictEqual(await orderCount(), 1);
});

test('an app build that sends no rate is not checked (it cannot be reloaded like a browser tab)', async () => {
  await setRate(12000);

  const order = await submit({ rateUsed: undefined, items: [line(ids.product)] });

  assert.ok(order._id);
  assert.strictEqual(order.totalPrice, 100 * 12000);
});

test('a malformed rate is refused as invalid, not silently ignored', async () => {
  await assert.rejects(
    () => submit({ rateUsed: 'soon', items: [line(ids.product)] }),
    (err) => {
      assert.strictEqual(err.code, 'INVALID_RATE_USED');
      assert.strictEqual(err.statusCode, 400);
      return true;
    }
  );
  await assert.rejects(
    () => submit({ rateUsed: 0, items: [line(ids.product)] }),
    (err) => {
      assert.strictEqual(err.code, 'INVALID_RATE_USED');
      return true;
    }
  );
  assert.strictEqual(await orderCount(), 0);
});

test('float noise from the JSON round trip is not a rate change', async () => {
  const order = await submit({
    rateUsed: RATE + 1e-9,
    items: [line(ids.product)],
  });

  assert.ok(order._id);
});

test('the rate is not part of what identifies the order: a retry after a rate change still replays', async () => {
  const key = `rate-${new mongoose.Types.ObjectId().toString()}`;
  const items = [line(ids.product, 2)];
  const first = await submit({ rateUsed: RATE, items, idempotencyKey: key });

  // The response was lost; by the time the app retries, the admin has moved
  // the rate and the app is sending the new one.
  await setRate(12000);
  const replay = await submit({ rateUsed: 12000, items, idempotencyKey: key });

  // The same order comes back - not a second one, and not
  // IDEMPOTENCY_KEY_REUSED, which is what would happen if rateUsed were part
  // of the fingerprint.
  assert.strictEqual(String(replay._id), String(first._id));
  assert.strictEqual(replay.$locals.idempotentReplay, true);
  assert.strictEqual(await orderCount(), 1);
});

// --- over HTTP, the shape the app actually meets ----------------------------

test('POST /orders: the refusal is a 409 with RATE_CHANGED and both rates', async () => {
  await setRate(12345);

  const response = await call('POST', '/orders', {
    warehouseId: String(ids.warehouse),
    items: [{ productId: String(ids.product), quantity: 1, displayedUnitPriceUsd: 100 }],
    rateUsed: RATE,
  });

  assert.strictEqual(response.status, 409);
  assert.strictEqual(response.body.code, 'RATE_CHANGED');
  assert.deepStrictEqual(response.body.details, { rateUsed: RATE, currentUsdToSyp: 12345 });
  assert.strictEqual(await orderCount(), 0);
});

test('POST /orders: the same order at the current rate is placed', async () => {
  const response = await call('POST', '/orders', {
    warehouseId: String(ids.warehouse),
    items: [{ productId: String(ids.product), quantity: 1, displayedUnitPriceUsd: 100 }],
    rateUsed: RATE,
  });

  assert.strictEqual(response.status, 201);
  assert.strictEqual(await orderCount(), 1);
});

test('POST /orders: a rate sent as a string (JSON from an older client) still checks', async () => {
  await setRate(12000);

  const response = await call('POST', '/orders', {
    warehouseId: String(ids.warehouse),
    items: [{ productId: String(ids.product), quantity: 1, displayedUnitPriceUsd: 100 }],
    rateUsed: String(RATE),
  });

  assert.strictEqual(response.status, 409);
  assert.strictEqual(response.body.code, 'RATE_CHANGED');
});
