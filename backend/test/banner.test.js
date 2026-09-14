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
// Padded to 32 characters: env.js rejects a shorter JWT_SECRET outright (audit
// F-09). Every other suite was padded when that landed; this file was added
// afterwards and missed it, which is why it could not boot on its own.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-banner-tests-pad';
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
const {
  resolveAdminBannerMediaType,
  resolveWarehouseBannerMediaType,
  verifyBannerMediaMagicBytes,
} = require('../src/middlewares/upload.middleware');

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

// --- Admin: image/GIF/video banners; warehouse stays image-only -----------

test('the admin upload path accepts image, GIF, and video MIME types', () => {
  assert.strictEqual(resolveAdminBannerMediaType('image/png'), 'image');
  assert.strictEqual(resolveAdminBannerMediaType('image/gif'), 'gif');
  assert.strictEqual(resolveAdminBannerMediaType('video/mp4'), 'video');
  assert.strictEqual(resolveAdminBannerMediaType('video/webm'), 'video');
});

test('the warehouse upload path rejects video with a 400 INVALID_MEDIA_TYPE error', () => {
  assert.throws(
    () => resolveWarehouseBannerMediaType('video/mp4'),
    (err) => {
      assert.strictEqual(err.statusCode, 400);
      assert.strictEqual(err.code, 'INVALID_MEDIA_TYPE');
      return true;
    }
  );
});

test('the warehouse upload path also rejects GIF - it stays image-only, unchanged from before this feature', () => {
  assert.throws(
    () => resolveWarehouseBannerMediaType('image/gif'),
    (err) => {
      assert.strictEqual(err.statusCode, 400);
      assert.strictEqual(err.code, 'INVALID_MEDIA_TYPE');
      return true;
    }
  );
});

test('an admin can create a banner with mediaType "video"', async () => {
  const banner = await adminBannerService.createAdminBanner(ids.adminUser, {
    ...bannerPayload(),
    imageUrl: 'https://res.cloudinary.com/test/video/upload/banners/promo.mp4',
    mediaType: 'video',
  });
  assert.strictEqual(banner.mediaType, 'video');

  const stored = await Banner.findById(banner._id);
  assert.strictEqual(stored.mediaType, 'video');
});

test('an admin can create a banner with mediaType "gif"', async () => {
  const banner = await adminBannerService.createAdminBanner(ids.adminUser, {
    ...bannerPayload(),
    imageUrl: 'https://res.cloudinary.com/test/banners/promo.gif',
    mediaType: 'gif',
  });
  assert.strictEqual(banner.mediaType, 'gif');
});

test('a banner defaults to mediaType "image" when none is given - covers pre-existing/warehouse banners', async () => {
  const banner = await warehouseBannerService.createBanner(ids.warehouse, ids.adminUser, bannerPayload());
  assert.strictEqual(banner.mediaType, 'image');
});

test('an admin replacing a banner image with a video updates mediaType alongside it', async () => {
  const created = await Banner.create({
    bannerNumber: 9005,
    warehouseId: null,
    imageUrl: 'https://res.cloudinary.com/test/banners/old.jpg',
    mediaType: 'image',
    title: 'Original',
    status: 'approved',
    approvedBy: ids.adminUser,
    startDate: new Date('2026-01-01'),
    endDate: new Date('2026-12-31'),
    createdBy: ids.adminUser,
  });

  const updated = await adminBannerService.updateBanner(created._id.toString(), {
    imageUrl: 'https://res.cloudinary.com/test/video/upload/banners/new.mp4',
    mediaType: 'video',
  });

  assert.strictEqual(updated.mediaType, 'video');
  assert.strictEqual(updated.imageUrl, 'https://res.cloudinary.com/test/video/upload/banners/new.mp4');
});

// --- Magic-byte content sniffing for the admin's GIF/video uploads ---------

test('verifyBannerMediaMagicBytes accepts a real GIF signature and rejects a fake one', () => {
  const realGif = Buffer.concat([Buffer.from('GIF89a', 'ascii'), Buffer.alloc(10)]);
  const fakeGif = Buffer.concat([Buffer.from('image/gif', 'ascii'), Buffer.alloc(10)]);
  assert.strictEqual(verifyBannerMediaMagicBytes(realGif, 'gif'), true);
  assert.strictEqual(verifyBannerMediaMagicBytes(fakeGif, 'gif'), false);
});

test('verifyBannerMediaMagicBytes accepts a real MP4 "ftyp" box and rejects unrelated bytes', () => {
  const realMp4 = Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x18]), Buffer.from('ftypmp42', 'ascii'), Buffer.alloc(4)]);
  const notVideo = Buffer.alloc(16);
  assert.strictEqual(verifyBannerMediaMagicBytes(realMp4, 'video'), true);
  assert.strictEqual(verifyBannerMediaMagicBytes(notVideo, 'video'), false);
});
