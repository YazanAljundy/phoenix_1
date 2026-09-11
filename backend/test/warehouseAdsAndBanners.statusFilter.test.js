// Covers the status filter added to Warehouse Advertisements and Warehouse
// Banners - both pages previously always showed every status at once, unlike
// their Admin equivalents which already supported filtering.
//
// Runs against its own database (feniq-wh-status-filter-test) and drops it
// at the end, same pattern as adminProduct.categoryFilter.test.js.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-wh-status-filter-tests';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const { startMemoryMongo, stopMemoryMongo } = require('./helpers/mongo');

const User = require('../src/models/user.model');
const Warehouse = require('../src/models/warehouse.model');
const Product = require('../src/models/product.model');
const Banner = require('../src/models/banner.model');

const warehouseAdvertisementService = require('../src/services/warehouseAdvertisement.service');
const adminAdvertisementService = require('../src/services/adminAdvertisement.service');
const warehouseBannerService = require('../src/services/warehouseBanner.service');

function withCode(expected) {
  return (err) => {
    assert.strictEqual(err.code, expected, `expected error code ${expected}, got ${err.code}`);
    return true;
  };
}

const ids = {};

test.before(async () => {
  await startMemoryMongo({ dbName: 'feniq-wh-status-filter-test' });

  const [whUser, adminUser] = await User.create([
    { name: 'WH', phone: '0960000001', role: 'warehouse', status: 'active' },
    { name: 'Admin', phone: '0960000002', role: 'admin', status: 'active' },
  ]);
  ids.adminUser = adminUser._id;

  const warehouse = await Warehouse.create({
    userId: whUser._id, nameAr: 'م', nameEn: 'W',
    address: 'addr', city: 'Latakia', phone: '0960000001', isActive: true,
  });
  ids.warehouseId = warehouse._id;

  const product = await Product.create({
    warehouseId: warehouse._id, nameAr: 'دواء', nameEn: 'Medicine',
    manufacturerAr: 'شركة', manufacturerEn: 'Co', price: 5, isActive: true, isAvailable: true,
  });
  ids.productId = product._id;
});

test.after(async () => {
  await stopMemoryMongo();
});

// ---------------------------------------------------------------------------
// Warehouse Advertisements
// ---------------------------------------------------------------------------

function adPayload(overrides = {}) {
  return {
    titleAr: 'باقة',
    titleEn: 'Package',
    items: [{ productId: ids.productId.toString(), quantity: 1 }],
    totalPriceUsd: 4,
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    ...overrides,
  };
}

test('warehouseAdvertisement.service: status filter narrows the warehouse\'s own list', async () => {
  const pendingRow = await warehouseAdvertisementService.createAdvertisement(ids.warehouseId, adPayload());
  const approvedRow = await warehouseAdvertisementService.createAdvertisement(
    ids.warehouseId, adPayload({ titleEn: 'Approved Package' })
  );
  await adminAdvertisementService.approveAdvertisement(approvedRow.advertisement._id, ids.adminUser);

  const allRows = await warehouseAdvertisementService.listAdvertisementsForWarehouse(ids.warehouseId);
  assert.ok(allRows.length >= 2);

  const pendingOnly = await warehouseAdvertisementService.listAdvertisementsForWarehouse(ids.warehouseId, 'pending');
  assert.ok(pendingOnly.every((r) => r.advertisement.status === 'pending'));
  assert.ok(pendingOnly.some((r) => String(r.advertisement._id) === String(pendingRow.advertisement._id)));

  const approvedOnly = await warehouseAdvertisementService.listAdvertisementsForWarehouse(ids.warehouseId, 'approved');
  assert.ok(approvedOnly.every((r) => r.advertisement.status === 'approved'));
  assert.ok(approvedOnly.some((r) => String(r.advertisement._id) === String(approvedRow.advertisement._id)));
  assert.ok(!approvedOnly.some((r) => String(r.advertisement._id) === String(pendingRow.advertisement._id)));
});

test('warehouseAdvertisement.service: an invalid status filter is rejected', async () => {
  await assert.rejects(
    () => warehouseAdvertisementService.listAdvertisementsForWarehouse(ids.warehouseId, 'bogus'),
    withCode('INVALID_STATUS_FILTER')
  );
});

// ---------------------------------------------------------------------------
// Warehouse Banners
// ---------------------------------------------------------------------------

async function makeBanner(status) {
  return Banner.create({
    bannerNumber: Math.floor(Math.random() * 1_000_000),
    warehouseId: ids.warehouseId,
    imageUrl: 'https://example.com/banner.png',
    title: `Banner (${status})`,
    status,
    startDate: new Date('2026-01-01'),
    endDate: new Date('2026-12-31'),
    createdBy: ids.adminUser,
  });
}

test('warehouseBanner.service: status filter narrows the warehouse\'s own list', async () => {
  const pending = await makeBanner('pending');
  const approved = await makeBanner('approved');
  const rejected = await makeBanner('rejected');

  const all = await warehouseBannerService.listPaginatedBannersForWarehouse(ids.warehouseId, { limit: 50 });
  assert.strictEqual(all.rows.length, 3);

  const pendingOnly = await warehouseBannerService.listPaginatedBannersForWarehouse(ids.warehouseId, {
    status: 'pending', limit: 50,
  });
  assert.deepStrictEqual(pendingOnly.rows.map((r) => String(r._id)), [String(pending._id)]);

  const approvedOnly = await warehouseBannerService.listPaginatedBannersForWarehouse(ids.warehouseId, {
    status: 'approved', limit: 50,
  });
  assert.deepStrictEqual(approvedOnly.rows.map((r) => String(r._id)), [String(approved._id)]);

  const rejectedOnly = await warehouseBannerService.listPaginatedBannersForWarehouse(ids.warehouseId, {
    status: 'rejected', limit: 50,
  });
  assert.deepStrictEqual(rejectedOnly.rows.map((r) => String(r._id)), [String(rejected._id)]);
});

test('warehouseBanner.service: status filter combines with pagination', async () => {
  // Add two more pending banners on top of the one from the previous test,
  // so a limit of 1 forces a second page.
  await makeBanner('pending');
  await makeBanner('pending');

  const seen = [];
  let after = null;
  for (let guard = 0; guard < 10; guard += 1) {
    const page = await warehouseBannerService.listPaginatedBannersForWarehouse(ids.warehouseId, {
      status: 'pending', limit: 1, after,
    });
    seen.push(...page.rows.map((r) => String(r._id)));
    if (!page.hasMore) break;
    after = page.nextCursor;
    assert.ok(after, 'hasMore implies a cursor');
  }
  assert.strictEqual(seen.length, 3, 'all three pending banners seen across pages');
  assert.strictEqual(new Set(seen).size, seen.length, 'no repeats across pages');
});

test('warehouseBanner.service: an invalid status filter is rejected', async () => {
  await assert.rejects(
    () => warehouseBannerService.listPaginatedBannersForWarehouse(ids.warehouseId, { status: 'bogus' }),
    withCode('INVALID_STATUS_FILTER')
  );
});
