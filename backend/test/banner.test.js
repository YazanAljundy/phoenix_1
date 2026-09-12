// Banner: a single image a warehouse (or the admin directly) submits to run
// for a date range, moderated by an admin before pharmacies see it.
//
// No banner.test.js existed before this - coverage was scattered across
// warehouseAdsAndBanners.statusFilter.test.js (status filters) and
// projection.select.test.js (field shape). This file covers the two new
// behaviors: a warehouse-submitted banner's image is now optional at
// creation, and an admin can replace a banner's image (at any status,
// including approved) during review.
//
// Own database, dropped at the end - same pattern as advertisement.test.js.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-banner-tests';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const { startMemoryMongo, stopMemoryMongo } = require('./helpers/mongo');

const User = require('../src/models/user.model');
const Warehouse = require('../src/models/warehouse.model');
const Banner = require('../src/models/banner.model');

const warehouseBannerService = require('../src/services/warehouseBanner.service');
const adminBannerService = require('../src/services/adminBanner.service');
const bannerService = require('../src/services/banner.service');

const ids = {};

test.before(async () => {
  await startMemoryMongo({ dbName: 'feniq-banner-test' });

  const [whUser, adminUser] = await User.create([
    { name: 'WH', phone: '0942000501', role: 'warehouse', status: 'active' },
    { name: 'Admin', phone: '0942000502', role: 'admin', status: 'active' },
  ]);
  ids.adminUser = adminUser._id;

  const warehouse = await Warehouse.create({
    userId: whUser._id,
    nameAr: 'م',
    nameEn: 'Warehouse',
    address: 'addr',
    city: 'Latakia',
    phone: '0942000501',
    deliveryType: 'self',
    isActive: true,
  });
  ids.warehouse = warehouse._id;
});

test.after(async () => {
  await stopMemoryMongo();
});

test.afterEach(async () => {
  await Banner.deleteMany({});
});

function bannerPayload(overrides = {}) {
  return {
    title: 'Back to school',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    imageUrl: 'https://res.cloudinary.com/test/banners/original.jpg',
    ...overrides,
  };
}

// --- Optional image on warehouse creation -----------------------------------

test('a warehouse can create a banner without an image - it is optional, unlike before', async () => {
  const banner = await warehouseBannerService.createBanner(ids.warehouse, ids.adminUser, {
    ...bannerPayload(),
    imageUrl: null,
  });
  assert.strictEqual(banner.imageUrl, null);
  assert.strictEqual(banner.status, 'pending');

  const stored = await Banner.findById(banner._id);
  assert.strictEqual(stored.imageUrl, null);
});

test('a warehouse banner still saves the image when one is given', async () => {
  const banner = await warehouseBannerService.createBanner(ids.warehouse, ids.adminUser, bannerPayload());
  assert.strictEqual(banner.imageUrl, 'https://res.cloudinary.com/test/banners/original.jpg');
});

// --- Admin can edit the image, at any status --------------------------------

test('an admin can replace an approved banner image', async () => {
  const created = await Banner.create({
    bannerNumber: 9001,
    warehouseId: ids.warehouse,
    imageUrl: 'https://res.cloudinary.com/test/banners/old.jpg',
    title: 'Original title',
    status: 'approved',
    approvedBy: ids.adminUser,
    startDate: new Date('2026-01-01'),
    endDate: new Date('2026-12-31'),
    createdBy: ids.adminUser,
  });

  const updated = await adminBannerService.updateBanner(created._id.toString(), {
    imageUrl: 'https://res.cloudinary.com/test/banners/new.jpg',
  });

  assert.strictEqual(updated.imageUrl, 'https://res.cloudinary.com/test/banners/new.jpg');
  // Title/dates/status untouched - only the image was passed.
  assert.strictEqual(updated.title, 'Original title');
  assert.strictEqual(updated.status, 'approved');

  const stored = await Banner.findById(created._id);
  assert.strictEqual(stored.imageUrl, 'https://res.cloudinary.com/test/banners/new.jpg');
});

test('an admin can edit an approved banner title/dates without touching the image', async () => {
  const created = await Banner.create({
    bannerNumber: 9002,
    warehouseId: ids.warehouse,
    imageUrl: 'https://res.cloudinary.com/test/banners/keep.jpg',
    title: 'Old title',
    status: 'approved',
    approvedBy: ids.adminUser,
    startDate: new Date('2026-01-01'),
    endDate: new Date('2026-12-31'),
    createdBy: ids.adminUser,
  });

  const updated = await adminBannerService.updateBanner(created._id.toString(), { title: 'New title' });

  assert.strictEqual(updated.title, 'New title');
  assert.strictEqual(updated.imageUrl, 'https://res.cloudinary.com/test/banners/keep.jpg');
});

// --- Visibility guard: an image-less banner never goes "live" --------------

test('listActiveBanners excludes an approved, in-range banner with no image yet', async () => {
  await Banner.create({
    bannerNumber: 9003,
    warehouseId: ids.warehouse,
    imageUrl: null,
    title: 'Waiting on an image',
    status: 'approved',
    approvedBy: ids.adminUser,
    startDate: new Date('2020-01-01'),
    endDate: new Date('2099-12-31'),
    createdBy: ids.adminUser,
  });
  await Banner.create({
    bannerNumber: 9004,
    warehouseId: ids.warehouse,
    imageUrl: 'https://res.cloudinary.com/test/banners/live.jpg',
    title: 'Has an image',
    status: 'approved',
    approvedBy: ids.adminUser,
    startDate: new Date('2020-01-01'),
    endDate: new Date('2099-12-31'),
    createdBy: ids.adminUser,
  });

  const active = await bannerService.listActiveBanners();
  assert.strictEqual(active.length, 1);
  assert.strictEqual(active[0].imageUrl, 'https://res.cloudinary.com/test/banners/live.jpg');
});
