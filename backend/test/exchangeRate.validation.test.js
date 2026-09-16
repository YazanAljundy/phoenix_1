// Writes whose USD figure the web panel converted from SYP must carry the rate
// they used, and are refused when that rate is no longer current.
//
// The defect: the panel loads the exchange rate once per session and converts
// SYP input to USD with it on save. The daily 09:00 refresh and an admin's
// manual change never reach an open tab, so product prices, a warehouse's
// order limits and advertisement totals were stored at a stale rate, silently.
//
// Now every such write sends `rateUsed`; exchangeRate.service.js's
// assertRateUsedIsCurrent refuses a stale one with 409 RATE_CHANGED
// { rateUsed, currentUsdToSyp }, and a missing one with 400 RATE_USED_REQUIRED
// - only when the write actually converted something (a value re-sent
// unchanged needs no rate).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-exchange-rate-checks';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const jwt = require('jsonwebtoken');

const { startMemoryMongo, stopMemoryMongo } = require('./helpers/mongo');

const app = require('../src/app');
const env = require('../src/config/env');

const User = require('../src/models/user.model');
const Warehouse = require('../src/models/warehouse.model');
const Category = require('../src/models/category.model');
const ProductCatalog = require('../src/models/productCatalog.model');
const Product = require('../src/models/product.model');
const Advertisement = require('../src/models/advertisement.model');
const ExchangeRate = require('../src/models/exchangeRate.model');

const exchangeRateService = require('../src/services/exchangeRate.service');
const warehouseProductService = require('../src/services/warehouseProduct.service');
const warehouseAdvertisementService = require('../src/services/warehouseAdvertisement.service');

const RATE = 130;
const STALE = 125;

const ids = {};
const tokens = {};
let server;
let baseUrl;

async function setRate(usdToSyp) {
  await ExchangeRate.findByIdAndUpdate(
    'singleton',
    { usdToSyp, source: 'manual', lastUpdated: new Date(), manualOverride: true },
    { upsert: true }
  );
}

async function call(method, path, { token = tokens.warehouse, body, form } = {}) {
  const init = { method, headers: { Authorization: `Bearer ${token}` } };
  if (form) {
    // multipart, as the panel sends it when an image is attached - every
    // field arrives as a string.
    const data = new FormData();
    for (const [key, value] of Object.entries(form)) data.append(key, value);
    init.body = data;
  } else if (body) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const response = await fetch(baseUrl + path, init);
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

function assertRateChanged(response, { rateUsed = STALE, currentUsdToSyp = RATE } = {}) {
  assert.strictEqual(response.status, 409, JSON.stringify(response.body));
  assert.strictEqual(response.body.success, false);
  assert.strictEqual(response.body.code, 'RATE_CHANGED');
  assert.deepStrictEqual(response.body.details, { rateUsed, currentUsdToSyp });
}

function assertRateRequired(response) {
  assert.strictEqual(response.status, 400, JSON.stringify(response.body));
  assert.strictEqual(response.body.code, 'RATE_USED_REQUIRED');
}

function withCode(code) {
  return (err) => {
    assert.strictEqual(err.code, code);
    return true;
  };
}

function newCatalogEntry(label) {
  return ProductCatalog.create({ nameAr: `دواء ${label}`, manufacturerAr: 'شركة' });
}

function newProductBody(masterProductId, overrides = {}) {
  return {
    masterProductId: String(masterProductId),
    categoryId: String(ids.category),
    unitAr: 'علبة',
    unitEn: 'Box',
    priceUsd: 10,
    ...overrides,
  };
}

function advertisementBody(overrides = {}) {
  return {
    titleAr: 'باقة',
    titleEn: 'Package',
    items: [{ productId: String(ids.product), quantity: 2 }],
    totalPriceUsd: 15,
    startDate: '2026-10-01',
    endDate: '2026-10-31',
    ...overrides,
  };
}

async function freshProduct(price = 10) {
  const master = await newCatalogEntry(`p-${Date.now()}-${Math.random()}`);
  return Product.create({
    warehouseId: ids.warehouse,
    masterProductId: master._id,
    categoryId: ids.category,
    unitAr: 'علبة',
    unitEn: 'Box',
    price,
    isAvailable: true,
    isActive: true,
  });
}

test.before(async () => {
  await startMemoryMongo({ dbName: 'feniq-exchange-rate-validation-test' });
  await setRate(RATE);

  const [whUser, adminUser] = await User.create([
    { name: 'WH', phone: '0942000401', role: 'warehouse', status: 'active' },
    { name: 'AD', phone: '0952000401', role: 'admin', status: 'active' },
  ]);
  tokens.warehouse = jwt.sign({ sub: String(whUser._id) }, env.jwtSecret, { expiresIn: '1h' });
  tokens.admin = jwt.sign({ sub: String(adminUser._id) }, env.jwtSecret, { expiresIn: '1h' });

  const warehouse = await Warehouse.create({
    userId: whUser._id, nameAr: 'م', nameEn: 'Warehouse', address: 'r', city: 'Latakia',
    phone: '0942000401', deliveryType: 'self', isActive: true,
  });
  ids.warehouse = warehouse._id;

  const category = await Category.create({ nameAr: 'فئة', nameEn: 'Category' });
  ids.category = category._id;

  ids.product = (await freshProduct(10))._id;

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await stopMemoryMongo();
});

test.beforeEach(async () => {
  await setRate(RATE);
  await Warehouse.updateOne(
    { _id: ids.warehouse },
    { $set: { minOrderAmountUsd: 0, maxOrderAmountUsd: null, requireDeliverySealPhoto: false } }
  );
});

// --- the shared check -------------------------------------------------------

test('assertRateUsedIsCurrent: accepts the current rate, refuses anything else', async () => {
  const current = await exchangeRateService.assertRateUsedIsCurrent(RATE);
  assert.strictEqual(current.usdToSyp, RATE);
  // A multipart body sends it as a string.
  assert.strictEqual((await exchangeRateService.assertRateUsedIsCurrent(String(RATE))).usdToSyp, RATE);

  await assert.rejects(exchangeRateService.assertRateUsedIsCurrent(STALE), (err) => {
    assert.strictEqual(err.statusCode, 409);
    assert.strictEqual(err.code, 'RATE_CHANGED');
    assert.deepStrictEqual(err.details, { rateUsed: STALE, currentUsdToSyp: RATE });
    return true;
  });
  await assert.rejects(exchangeRateService.assertRateUsedIsCurrent(undefined), withCode('RATE_USED_REQUIRED'));
  await assert.rejects(exchangeRateService.assertRateUsedIsCurrent(''), withCode('RATE_USED_REQUIRED'));
  await assert.rejects(exchangeRateService.assertRateUsedIsCurrent(-1), withCode('INVALID_RATE_USED'));
  await assert.rejects(exchangeRateService.assertRateUsedIsCurrent('abc'), withCode('INVALID_RATE_USED'));
});

test('assertRateUsedIsCurrent: an optional rate that is absent is not checked', async () => {
  assert.strictEqual(await exchangeRateService.assertRateUsedIsCurrent(undefined, { required: false }), null);
  // ...but one that is present still is.
  await assert.rejects(
    exchangeRateService.assertRateUsedIsCurrent(STALE, { required: false }),
    withCode('RATE_CHANGED')
  );
});

test('assertRateUsedIsCurrent: no rate on record at all', async () => {
  await ExchangeRate.deleteOne({ _id: 'singleton' });
  try {
    await assert.rejects(
      exchangeRateService.assertRateUsedIsCurrent(RATE),
      withCode('EXCHANGE_RATE_UNAVAILABLE')
    );
  } finally {
    await setRate(RATE);
  }
});

// --- POST /warehouse/products -----------------------------------------------

test('POST /warehouse/products: saved at the current rate, refused at a stale one or without one', async () => {
  const stale = await newCatalogEntry('create-stale');
  const refused = await call('POST', '/warehouse/products', {
    body: newProductBody(stale._id, { rateUsed: STALE }),
  });
  assertRateChanged(refused);
  assert.strictEqual(await Product.countDocuments({ masterProductId: stale._id }), 0, 'nothing saved');

  const missing = await call('POST', '/warehouse/products', { body: newProductBody(stale._id) });
  assertRateRequired(missing);

  const saved = await call('POST', '/warehouse/products', {
    body: newProductBody(stale._id, { rateUsed: RATE }),
  });
  assert.strictEqual(saved.status, 201, JSON.stringify(saved.body));
  assert.strictEqual(saved.body.product.priceUsd, 10);
});

// --- PATCH /warehouse/products/:id ------------------------------------------

test('PATCH /warehouse/products/:id: a new price needs the current rate', async () => {
  const product = await freshProduct(10);
  const path = `/warehouse/products/${product._id}`;

  assertRateChanged(await call('PATCH', path, { body: { priceUsd: 12, rateUsed: STALE } }));
  assertRateRequired(await call('PATCH', path, { body: { priceUsd: 12 } }));
  const unchanged = await Product.findById(product._id).lean();
  assert.strictEqual(unchanged.price, 10, 'the price did not move');
  assert.strictEqual(unchanged.priceHistory.length, 0, 'no history entry either');

  const saved = await call('PATCH', path, { body: { priceUsd: 12, rateUsed: RATE } });
  assert.strictEqual(saved.status, 200, JSON.stringify(saved.body));
  assert.strictEqual(saved.body.product.priceUsd, 12);
});

test('PATCH /warehouse/products/:id: re-sending the stored price needs no rate at all', async () => {
  const product = await freshProduct(10);
  const path = `/warehouse/products/${product._id}`;

  // The panel's untouched-price path: the exact stored USD, no rateUsed.
  const untouched = await call('PATCH', path, { body: { priceUsd: 10, unitEn: 'Pack' } });
  assert.strictEqual(untouched.status, 200, JSON.stringify(untouched.body));
  assert.strictEqual(untouched.body.product.unitEn, 'Pack');

  // A stale rate beside an unchanged price is not what was converted, so it
  // is not checked.
  const staleButUnchanged = await call('PATCH', path, { body: { priceUsd: 10, rateUsed: STALE } });
  assert.strictEqual(staleButUnchanged.status, 200);
});

// --- PATCH /admin/products/:id ----------------------------------------------

test('PATCH /admin/products/:id: the admin edit follows the same rule', async () => {
  const product = await freshProduct(10);
  const path = `/admin/products/${product._id}`;

  assertRateChanged(await call('PATCH', path, { token: tokens.admin, body: { priceUsd: 9, rateUsed: STALE } }));
  assertRateRequired(await call('PATCH', path, { token: tokens.admin, body: { priceUsd: 9 } }));
  assert.strictEqual((await Product.findById(product._id).lean()).price, 10);

  const saved = await call('PATCH', path, { token: tokens.admin, body: { priceUsd: 9, rateUsed: RATE } });
  assert.strictEqual(saved.status, 200, JSON.stringify(saved.body));
  assert.strictEqual((await Product.findById(product._id).lean()).price, 9);
});

// --- PATCH /warehouse/settings ----------------------------------------------

test('PATCH /warehouse/settings: new limits need the current rate', async () => {
  assertRateChanged(
    await call('PATCH', '/warehouse/settings', {
      body: { minOrderAmountUsd: 50, maxOrderAmountUsd: 500, rateUsed: STALE },
    })
  );
  assertRateRequired(await call('PATCH', '/warehouse/settings', { body: { maxOrderAmountUsd: 500 } }));
  let warehouse = await Warehouse.findById(ids.warehouse).lean();
  assert.strictEqual(warehouse.minOrderAmountUsd, 0);
  assert.strictEqual(warehouse.maxOrderAmountUsd, null);

  const saved = await call('PATCH', '/warehouse/settings', {
    body: { minOrderAmountUsd: 50, maxOrderAmountUsd: 500, rateUsed: RATE },
  });
  assert.strictEqual(saved.status, 200, JSON.stringify(saved.body));
  warehouse = await Warehouse.findById(ids.warehouse).lean();
  assert.strictEqual(warehouse.minOrderAmountUsd, 50);
  assert.strictEqual(warehouse.maxOrderAmountUsd, 500);
});

test('PATCH /warehouse/settings: the toggle, cleared limits and unchanged limits need no rate', async () => {
  await Warehouse.updateOne({ _id: ids.warehouse }, { $set: { minOrderAmountUsd: 50, maxOrderAmountUsd: 500 } });

  const unchanged = await call('PATCH', '/warehouse/settings', {
    body: { minOrderAmountUsd: 50, maxOrderAmountUsd: 500, requireDeliverySealPhoto: true },
  });
  assert.strictEqual(unchanged.status, 200, JSON.stringify(unchanged.body));
  assert.strictEqual((await Warehouse.findById(ids.warehouse).lean()).requireDeliverySealPhoto, true);

  const cleared = await call('PATCH', '/warehouse/settings', {
    body: { minOrderAmountUsd: 0, maxOrderAmountUsd: null },
  });
  assert.strictEqual(cleared.status, 200, JSON.stringify(cleared.body));
  const warehouse = await Warehouse.findById(ids.warehouse).lean();
  assert.strictEqual(warehouse.minOrderAmountUsd, 0);
  assert.strictEqual(warehouse.maxOrderAmountUsd, null);
});

// --- POST /warehouse/advertisements -----------------------------------------

test('POST /warehouse/advertisements: the total needs the current rate, JSON or multipart', async () => {
  const before = await Advertisement.countDocuments();

  assertRateChanged(
    await call('POST', '/warehouse/advertisements', { body: advertisementBody({ rateUsed: STALE }) })
  );
  assertRateRequired(await call('POST', '/warehouse/advertisements', { body: advertisementBody() }));

  const multipart = (overrides) => {
    const body = advertisementBody(overrides);
    return {
      ...body,
      items: JSON.stringify(body.items),
      totalPriceUsd: String(body.totalPriceUsd),
    };
  };
  assertRateChanged(
    await call('POST', '/warehouse/advertisements', { form: multipart({ rateUsed: String(STALE) }) })
  );
  assert.strictEqual(await Advertisement.countDocuments(), before, 'nothing saved');

  const json = await call('POST', '/warehouse/advertisements', { body: advertisementBody({ rateUsed: RATE }) });
  assert.strictEqual(json.status, 201, JSON.stringify(json.body));
  const form = await call('POST', '/warehouse/advertisements', { form: multipart({ rateUsed: String(RATE) }) });
  assert.strictEqual(form.status, 201, JSON.stringify(form.body));
  assert.strictEqual(form.body.advertisement.totalPriceUsd, 15);
});

// --- PATCH /warehouse/advertisements/:id and /admin/advertisements/:id -------

async function existingAdvertisement() {
  // Created straight through the service, which checks no rate when given none.
  const { advertisement } = await warehouseAdvertisementService.createAdvertisement(
    ids.warehouse,
    advertisementBody()
  );
  return advertisement;
}

test('PATCH /warehouse/advertisements/:id: a changed total needs the current rate, an unchanged one none', async () => {
  const advertisement = await existingAdvertisement();
  const path = `/warehouse/advertisements/${advertisement._id}`;

  assertRateChanged(
    await call('PATCH', path, { body: advertisementBody({ totalPriceUsd: 12, rateUsed: STALE }) })
  );
  assertRateRequired(await call('PATCH', path, { body: advertisementBody({ totalPriceUsd: 12 }) }));
  assert.strictEqual((await Advertisement.findById(advertisement._id).lean()).totalPriceUsd, 15);

  const untouched = await call('PATCH', path, { body: advertisementBody({ titleEn: 'Renamed' }) });
  assert.strictEqual(untouched.status, 200, JSON.stringify(untouched.body));

  const saved = await call('PATCH', path, { body: advertisementBody({ totalPriceUsd: 12, rateUsed: RATE }) });
  assert.strictEqual(saved.status, 200, JSON.stringify(saved.body));
  assert.strictEqual((await Advertisement.findById(advertisement._id).lean()).totalPriceUsd, 12);
});

test('PATCH /admin/advertisements/:id: the admin edit follows the same rule', async () => {
  const advertisement = await existingAdvertisement();
  const path = `/admin/advertisements/${advertisement._id}`;
  const asAdmin = (body) => call('PATCH', path, { token: tokens.admin, body });

  assertRateChanged(await asAdmin(advertisementBody({ totalPriceUsd: 11, rateUsed: STALE })));
  assertRateRequired(await asAdmin(advertisementBody({ totalPriceUsd: 11 })));
  assert.strictEqual((await Advertisement.findById(advertisement._id).lean()).totalPriceUsd, 15);

  assert.strictEqual((await asAdmin(advertisementBody({ titleEn: 'Admin rename' }))).status, 200);

  const saved = await asAdmin(advertisementBody({ totalPriceUsd: 11, rateUsed: RATE }));
  assert.strictEqual(saved.status, 200, JSON.stringify(saved.body));
  assert.strictEqual((await Advertisement.findById(advertisement._id).lean()).totalPriceUsd, 11);
});

// --- the scenario the fix is for --------------------------------------------

test('an admin rate change while a panel form is open refuses the save made at the old rate', async () => {
  // The warehouse panel loads the rate when the session starts...
  const loaded = await call('GET', '/exchange-rate');
  assert.strictEqual(loaded.body.usdToSyp, RATE);

  // ...the admin changes it while the warehouse is still typing...
  const changed = await call('PATCH', '/admin/exchange-rate', { token: tokens.admin, body: { usdToSyp: 150 } });
  assert.strictEqual(changed.status, 200, JSON.stringify(changed.body));

  // ...and every save converted at the old rate is refused, naming both rates.
  const master = await newCatalogEntry('pending');
  const product = await freshProduct(10);
  const advertisement = await existingAdvertisement();
  const staleWrites = [
    call('POST', '/warehouse/products', { body: newProductBody(master._id, { rateUsed: RATE }) }),
    call('PATCH', `/warehouse/products/${product._id}`, { body: { priceUsd: 11, rateUsed: RATE } }),
    call('PATCH', '/warehouse/settings', { body: { minOrderAmountUsd: 40, rateUsed: RATE } }),
    call('PATCH', `/warehouse/advertisements/${advertisement._id}`, {
      body: advertisementBody({ totalPriceUsd: 13, rateUsed: RATE }),
    }),
  ];
  for (const response of await Promise.all(staleWrites)) {
    assertRateChanged(response, { rateUsed: RATE, currentUsdToSyp: 150 });
  }
  assert.strictEqual(await Product.countDocuments({ masterProductId: master._id }), 0);
  assert.strictEqual((await Product.findById(product._id).lean()).price, 10);
  assert.strictEqual((await Warehouse.findById(ids.warehouse).lean()).minOrderAmountUsd, 0);

  // Once the panel has the new rate and the user confirms, the save goes
  // through at it.
  const retried = await call('POST', '/warehouse/products', {
    body: newProductBody(master._id, { priceUsd: 8.67, rateUsed: 150 }),
  });
  assert.strictEqual(retried.status, 201, JSON.stringify(retried.body));
  assert.strictEqual(retried.body.product.priceUsd, 8.67);
});

test('a direct service call without a rate is not checked (only the HTTP boundary requires one)', async () => {
  const master = await newCatalogEntry('direct');
  const product = await warehouseProductService.createProduct(ids.warehouse, newProductBody(master._id));
  assert.strictEqual(product.price, 10);
});
