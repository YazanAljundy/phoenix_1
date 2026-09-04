// Warehouse advertisements: a curated multi-product package sold at one package
// total, moderated by an admin before pharmacies see it.
//
// A package carries NO per-product price - each product is always shown and
// billed at its current catalog price, and the package total is the discount.
// These tests pin that, plus that a package never touches Product.price.
//
// Own database, dropped at the end - same pattern as warehouse.invoices.test.js.
process.env.MONGODB_URI = 'mongodb://localhost:27017/phoenix-advertisement-test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-advertisement-tests';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');

const User = require('../src/models/user.model');
const Warehouse = require('../src/models/warehouse.model');
const Product = require('../src/models/product.model');
const Advertisement = require('../src/models/advertisement.model');

const service = require('../src/services/warehouseAdvertisement.service');
const adminService = require('../src/services/adminAdvertisement.service');
const viewModel = require('../src/viewmodels/warehouseAdvertisement.viewmodel');

const ids = {};

// A valid payload with whatever the individual test wants to override. An
// item is a productId + a quantity - no per-product price.
function payload(overrides = {}) {
  return {
    titleAr: 'عرض العودة إلى المدرسة',
    titleEn: 'Back to School Offer',
    items: [
      { productId: ids.paracetamol.toString(), quantity: 2 },
      { productId: ids.vitaminC.toString(), quantity: 1 },
      { productId: ids.syrupX.toString(), quantity: 1 },
    ],
    // Catalog prices 3 + 4 + 2.5; weighted by qty: 2x3 + 4 + 2.5 = 12.5.
    totalPriceUsd: 10,
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    ...overrides,
  };
}

async function makeProduct(key, warehouseId, nameEn, nameAr, priceUsd) {
  const product = await Product.create({
    warehouseId,
    nameEn,
    nameAr,
    manufacturerAr: 'شركة الاختبار',
    manufacturerEn: 'Test Pharma',
    price: priceUsd,
    unitAr: 'علبة',
    unitEn: 'box',
    isAvailable: true,
    isActive: true,
  });
  ids[key] = product._id;
  return product;
}

test.before(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  await mongoose.connection.dropDatabase();

  const [whUser, otherWhUser, adminUser] = await User.create([
    { name: 'WH', phone: '0942000401', role: 'warehouse', status: 'active' },
    { name: 'WH2', phone: '0942000402', role: 'warehouse', status: 'active' },
    { name: 'Admin', phone: '0942000403', role: 'admin', status: 'active' },
  ]);
  ids.adminUser = adminUser._id;

  const [warehouse, otherWarehouse] = await Warehouse.create([
    { userId: whUser._id, nameAr: 'م', nameEn: 'Warehouse', address: 'r', city: 'Latakia', phone: '0942000401', deliveryType: 'self', isActive: true },
    { userId: otherWhUser._id, nameAr: 'م2', nameEn: 'Warehouse 2', address: 'r', city: 'Latakia', phone: '0942000402', deliveryType: 'self', isActive: true },
  ]);
  ids.warehouse = warehouse._id;
  ids.otherWarehouse = otherWarehouse._id;

  await makeProduct('paracetamol', ids.warehouse, 'Paracetamol', 'باراسيتامول', 3);
  await makeProduct('vitaminC', ids.warehouse, 'Vitamin C', 'فيتامين سي', 4);
  await makeProduct('syrupX', ids.warehouse, 'Syrup X', 'شراب اكس', 2.5);
  await makeProduct('deactivated', ids.warehouse, 'Retired Item', 'صنف متوقف', 9);
  await Product.updateOne({ _id: ids.deactivated }, { isActive: false });

  // Belongs to the OTHER warehouse - must never be attachable here.
  await makeProduct('foreign', ids.otherWarehouse, 'Foreign Product', 'منتج آخر', 5);
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test.afterEach(async () => {
  await Advertisement.deleteMany({});
  // Reset any price a test moved.
  await Product.updateOne({ _id: ids.paracetamol }, { price: 3 });
});

// --- Advertisement number (for the WhatsApp conversation with the admin) ------

test('every advertisement gets a sequential number, serialized in the response', async () => {
  const first = await service.createAdvertisement(ids.warehouse, payload());
  const second = await service.createAdvertisement(ids.warehouse, payload());

  assert.strictEqual(typeof first.advertisement.advertisementNumber, 'number');
  assert.strictEqual(
    second.advertisement.advertisementNumber,
    first.advertisement.advertisementNumber + 1
  );

  const { advertisement } = viewModel.toAdvertisementResponse(first);
  assert.strictEqual(advertisement.advertisementNumber, first.advertisement.advertisementNumber);
});

test('editing an advertisement created without a number lazily assigns one', async () => {
  // Simulate a row from before the field existed.
  const { advertisement } = await service.createAdvertisement(ids.warehouse, payload());
  await Advertisement.updateOne(
    { _id: advertisement._id },
    { $unset: { advertisementNumber: 1 } }
  );
  assert.strictEqual(
    (await Advertisement.findById(advertisement._id)).advertisementNumber,
    undefined
  );

  await service.updateAdvertisement(advertisement._id.toString(), ids.warehouse, payload());

  const reread = await Advertisement.findById(advertisement._id);
  assert.strictEqual(typeof reread.advertisementNumber, 'number');
});

// --- The package shape --------------------------------------------------------

test('a package holds several products with quantities and one package total', async () => {
  const { advertisement } = await service.createAdvertisement(ids.warehouse, payload());

  assert.strictEqual(advertisement.items.length, 3);
  const stored = await Advertisement.findById(advertisement._id);
  // The subdoc is productId + quantity, no price.
  assert.deepStrictEqual(Object.keys(stored.items[0].toObject()).sort(), ['productId', 'quantity']);
  const qtyByProduct = new Map(stored.items.map((i) => [i.productId.toString(), i.quantity]));
  assert.strictEqual(qtyByProduct.get(ids.paracetamol.toString()), 2);
  assert.strictEqual(qtyByProduct.get(ids.vitaminC.toString()), 1);
  assert.strictEqual(stored.totalPriceUsd, 10);
});

test('a quantity defaults to 1 when the client omits it', async () => {
  const { advertisement } = await service.createAdvertisement(
    ids.warehouse,
    payload({ items: [{ productId: ids.paracetamol.toString() }], totalPriceUsd: 2 })
  );
  assert.strictEqual(advertisement.items[0].quantity, 1);
});

test('a non-integer or below-1 quantity is rejected', async () => {
  for (const bad of [0, -2, 1.5, 'x', null]) {
    await assert.rejects(
      () =>
        service.createAdvertisement(
          ids.warehouse,
          payload({ items: [{ productId: ids.paracetamol.toString(), quantity: bad }] })
        ),
      (err) => err.code === 'INVALID_ADVERTISEMENT_QUANTITY',
      `quantity=${String(bad)} should be rejected`
    );
  }
});

test('a single-product package is just as valid as a multi-product one', async () => {
  const { advertisement } = await service.createAdvertisement(
    ids.warehouse,
    payload({ items: [{ productId: ids.paracetamol.toString(), quantity: 3 }], totalPriceUsd: 8 })
  );
  assert.strictEqual(advertisement.items.length, 1);
  assert.strictEqual(advertisement.items[0].quantity, 3);
});

test('the same product cannot be added twice', async () => {
  await assert.rejects(
    () =>
      service.createAdvertisement(
        ids.warehouse,
        payload({
          items: [
            { productId: ids.paracetamol.toString() },
            { productId: ids.paracetamol.toString() },
          ],
        })
      ),
    (err) => err.code === 'DUPLICATE_ADVERTISEMENT_PRODUCT'
  );
});

test('a package needs at least one product', async () => {
  await assert.rejects(
    () => service.createAdvertisement(ids.warehouse, payload({ items: [] })),
    (err) => err.code === 'ADVERTISEMENT_ITEMS_REQUIRED'
  );
});

// --- Ownership ------------------------------------------------------------

test("a warehouse cannot attach another warehouse's product", async () => {
  await assert.rejects(
    () =>
      service.createAdvertisement(
        ids.warehouse,
        payload({ items: [{ productId: ids.foreign.toString() }] })
      ),
    (err) => err.code === 'PRODUCT_NOT_FOUND'
  );
  assert.strictEqual(await Advertisement.countDocuments({}), 0);
});

test('a deactivated product cannot be advertised', async () => {
  await assert.rejects(
    () =>
      service.createAdvertisement(
        ids.warehouse,
        payload({ items: [{ productId: ids.deactivated.toString() }] })
      ),
    (err) => err.code === 'PRODUCT_NOT_FOUND'
  );
});

// --- Total price validation ----------------------------------------------

test('the package total must be a positive number', async () => {
  for (const bad of [0, -1, 'free', null, undefined, NaN]) {
    await assert.rejects(
      () => service.createAdvertisement(ids.warehouse, payload({ totalPriceUsd: bad })),
      (err) => err.code === 'INVALID_TOTAL_PRICE',
      `totalPriceUsd=${String(bad)} should be rejected`
    );
  }
});

test('a payload cannot smuggle a per-product price back in', async () => {
  // An old client sending advertisedPriceUsd is ignored, not honoured.
  const { advertisement } = await service.createAdvertisement(
    ids.warehouse,
    payload({
      items: [{ productId: ids.paracetamol.toString(), quantity: 1, advertisedPriceUsd: 0.01 }],
      totalPriceUsd: 2,
    })
  );
  const stored = await Advertisement.findById(advertisement._id);
  assert.strictEqual(stored.items[0].advertisedPriceUsd, undefined);
});

test('an invalid date range is rejected', async () => {
  await assert.rejects(
    () => service.createAdvertisement(ids.warehouse, payload({ endDate: '2025-01-01' })),
    (err) => err.code === 'INVALID_DATE_RANGE'
  );
});

test('a blank title is rejected', async () => {
  await assert.rejects(
    () => service.createAdvertisement(ids.warehouse, payload({ titleEn: '   ' })),
    (err) => err.code === 'INVALID_ADVERTISEMENT_TITLE'
  );
});

// --- Catalog prices flow through, live ----------------------------------------

test('each item carries its catalog price + quantity, and the weighted sum + saving % are derived', async () => {
  const created = await service.createAdvertisement(ids.warehouse, payload());
  const { advertisement } = viewModel.toAdvertisementResponse(created);

  const byName = new Map(advertisement.items.map((i) => [i.productNameEn, i]));
  assert.strictEqual(byName.get('Paracetamol').priceUsd, 3);
  assert.strictEqual(byName.get('Paracetamol').quantity, 2);
  assert.strictEqual(byName.get('Vitamin C').priceUsd, 4);

  // 2x3 + 4 + 2.5 = 12.5
  assert.strictEqual(advertisement.calculatedItemsTotalUsd, 12.5);
  assert.strictEqual(advertisement.totalPriceUsd, 10);
  // (12.5 - 10) / 12.5 = 20%
  assert.strictEqual(advertisement.savingPercentage, 20);
  assert.ok(advertisement.items.every((i) => i.advertisedPriceUsd === undefined));
});

test('the package follows a catalog price change - it is not a snapshot', async () => {
  const created = await service.createAdvertisement(ids.warehouse, payload());
  assert.strictEqual(viewModel.toAdvertisementResponse(created).advertisement.calculatedItemsTotalUsd, 12.5);

  await Product.updateOne({ _id: ids.paracetamol }, { price: 6 }); // was 3

  const [row] = await service.listAdvertisementsForWarehouse(ids.warehouse);
  const { advertisement } = viewModel.toAdvertisementResponse(row);
  assert.strictEqual(advertisement.calculatedItemsTotalUsd, 18.5); // 2x6 + 4 + 2.5
  assert.strictEqual(advertisement.totalPriceUsd, 10); // unchanged
  // (18.5 - 10) / 18.5 = 45.9% -> 46
  assert.strictEqual(advertisement.savingPercentage, 46);
});

test('a package total at or above the catalog sum is allowed - it just means no saving', async () => {
  const created = await service.createAdvertisement(ids.warehouse, payload({ totalPriceUsd: 999 }));
  const { advertisement } = viewModel.toAdvertisementResponse(created);
  assert.strictEqual(advertisement.totalPriceUsd, 999);
  assert.strictEqual(advertisement.savingPercentage, 0);
});

test('the normal product prices are never modified by a package', async () => {
  const before = await Product.find({ warehouseId: ids.warehouse }).select('_id price').lean();

  const created = await service.createAdvertisement(ids.warehouse, payload());
  await service.updateAdvertisement(
    created.advertisement._id,
    ids.warehouse,
    payload({ totalPriceUsd: 4 })
  );

  const after = await Product.find({ warehouseId: ids.warehouse }).select('_id price').lean();
  const priceById = new Map(after.map((p) => [p._id.toString(), p.price]));
  for (const product of before) {
    assert.strictEqual(priceById.get(product._id.toString()), product.price);
  }
  const paracetamol = await Product.findById(ids.paracetamol).select('priceHistory');
  assert.strictEqual(paracetamol.priceHistory.length, 0);
});

// --- Editing --------------------------------------------------------------

test('the package total can be edited later', async () => {
  const created = await service.createAdvertisement(ids.warehouse, payload());
  const updated = await service.updateAdvertisement(
    created.advertisement._id,
    ids.warehouse,
    payload({ totalPriceUsd: 5 })
  );

  assert.strictEqual(updated.advertisement.totalPriceUsd, 5);
  assert.strictEqual((await Advertisement.findById(created.advertisement._id)).totalPriceUsd, 5);
  assert.strictEqual(updated.advertisement.items.length, 3);
});

test('editing an approved package sends it back for moderation', async () => {
  const created = await service.createAdvertisement(ids.warehouse, payload());
  await adminService.approveAdvertisement(created.advertisement._id, ids.adminUser);

  await service.updateAdvertisement(created.advertisement._id, ids.warehouse, payload({ totalPriceUsd: 7 }));

  const reread = await Advertisement.findById(created.advertisement._id);
  assert.strictEqual(reread.status, 'pending');
  assert.strictEqual(reread.approvedBy, null);
  assert.strictEqual(reread.totalPriceUsd, 7);
});

test('a warehouse cannot edit or delete another warehouse package (IDOR)', async () => {
  const created = await service.createAdvertisement(ids.warehouse, payload());

  await assert.rejects(
    () => service.updateAdvertisement(created.advertisement._id, ids.otherWarehouse, payload()),
    (err) => err.code === 'ADVERTISEMENT_NOT_FOUND'
  );
  await assert.rejects(
    () => service.deleteAdvertisement(created.advertisement._id, ids.otherWarehouse),
    (err) => err.code === 'ADVERTISEMENT_NOT_FOUND'
  );
  assert.strictEqual(await Advertisement.countDocuments({}), 1);
});

test('a warehouse can delete its own package', async () => {
  const created = await service.createAdvertisement(ids.warehouse, payload());
  await service.deleteAdvertisement(created.advertisement._id, ids.warehouse);
  assert.strictEqual(await Advertisement.countDocuments({}), 0);
});

// --- Listing --------------------------------------------------------------

test('the warehouse list resolves each item product name and is scoped to its own warehouse', async () => {
  await service.createAdvertisement(ids.warehouse, payload());

  const mine = viewModel.toAdvertisementListResponse(
    await service.listAdvertisementsForWarehouse(ids.warehouse)
  ).advertisements;
  assert.strictEqual(mine.length, 1);
  assert.deepStrictEqual(
    mine[0].items.map((i) => i.productNameEn).sort(),
    ['Paracetamol', 'Syrup X', 'Vitamin C']
  );

  assert.strictEqual((await service.listAdvertisementsForWarehouse(ids.otherWarehouse)).length, 0);
});

// --- Moderation -----------------------------------------------------------

test('a package starts pending and only an admin can approve it', async () => {
  const created = await service.createAdvertisement(ids.warehouse, payload());
  assert.strictEqual(created.advertisement.status, 'pending');

  const queue = await adminService.listPendingAdvertisements();
  assert.strictEqual(queue.length, 1);
  assert.strictEqual(queue[0].warehouse.nameEn, 'Warehouse');

  await adminService.approveAdvertisement(created.advertisement._id, ids.adminUser);
  const approved = await Advertisement.findById(created.advertisement._id);
  assert.strictEqual(approved.status, 'approved');
  assert.strictEqual(String(approved.approvedBy), String(ids.adminUser));

  assert.strictEqual((await adminService.listPendingAdvertisements()).length, 0);
});

test('rejection keeps the package and records the reason', async () => {
  const created = await service.createAdvertisement(ids.warehouse, payload());
  await adminService.rejectAdvertisement(created.advertisement._id, '  Prices look wrong  ');

  const rejected = await Advertisement.findById(created.advertisement._id);
  assert.strictEqual(rejected.status, 'rejected');
  assert.strictEqual(rejected.rejectionNote, 'Prices look wrong');
  assert.strictEqual((await service.listAdvertisementsForWarehouse(ids.warehouse)).length, 1);
});

test('a rejection without a note is refused, and nothing changes', async () => {
  const created = await service.createAdvertisement(ids.warehouse, payload());
  await assert.rejects(
    () => adminService.rejectAdvertisement(created.advertisement._id, '   '),
    (err) => err.code === 'REJECTION_NOTE_REQUIRED'
  );
  assert.strictEqual((await Advertisement.findById(created.advertisement._id)).status, 'pending');
});

test('an already-decided package cannot be approved or rejected again', async () => {
  const created = await service.createAdvertisement(ids.warehouse, payload());
  await adminService.approveAdvertisement(created.advertisement._id, ids.adminUser);

  await assert.rejects(
    () => adminService.approveAdvertisement(created.advertisement._id, ids.adminUser),
    (err) => err.code === 'ADVERTISEMENT_NOT_FOUND'
  );
  await assert.rejects(
    () => adminService.rejectAdvertisement(created.advertisement._id, 'nope'),
    (err) => err.code === 'ADVERTISEMENT_NOT_FOUND'
  );
});

test('the admin queue paginates without repeats and reports a total count', async () => {
  for (let i = 0; i < 5; i += 1) {
    await service.createAdvertisement(ids.warehouse, payload({ titleEn: `Package ${i}` }));
  }

  const seen = [];
  let cursor = null;
  let totalCount = null;
  for (let i = 0; i < 10; i += 1) {
    const page = await adminService.listPaginatedPendingAdvertisements({ limit: 2, after: cursor });
    totalCount = page.totalCount;
    seen.push(...page.rows.map((r) => String(r.advertisement._id)));
    if (!page.hasMore) break;
    cursor = page.nextCursor;
  }

  assert.strictEqual(seen.length, 5);
  assert.strictEqual(new Set(seen).size, 5);
  assert.strictEqual(totalCount, 5);
});

// --- The existing Offer feature is untouched ------------------------------

test('packages do not touch the Offer collection', async () => {
  const Offer = require('../src/models/offer.model');
  await service.createAdvertisement(ids.warehouse, payload());
  assert.strictEqual(await Offer.countDocuments({}), 0);
});
