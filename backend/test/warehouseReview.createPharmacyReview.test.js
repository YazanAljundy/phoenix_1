// Section 13b: warehouseReview.service.js's createPharmacyReview is the one
// place in the codebase that loads a full (non-lean) Pharmacy document and
// calls `.save()` on it, to fold a new rating into averageRating/reviewsCount.
//
// This is exactly the write path pharmacy.model.js's areaType field being
// made `required: true` put at risk: a full `.save()` re-validates every
// path on the document, so a pharmacy missing areaType would have thrown here
// the moment it was next rated. scripts/backfill-pharmacy-area-type.js exists
// to close that gap on real data before the schema change ships; this test
// proves the write path itself is fine once areaType is actually populated
// (as every pharmacy created from now on always is).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-pharmacy-review-save';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');

const { startMemoryMongo, stopMemoryMongo } = require('./helpers/mongo');

const User = require('../src/models/user.model');
const Pharmacy = require('../src/models/pharmacy.model');
const Warehouse = require('../src/models/warehouse.model');
const Product = require('../src/models/product.model');
const ExchangeRate = require('../src/models/exchangeRate.model');

const orderService = require('../src/services/order.service');
const warehouseOrderService = require('../src/services/warehouseOrder.service');
const warehouseReviewService = require('../src/services/warehouseReview.service');

const ids = {};

async function deliver(order) {
  let current = order;
  for (let i = 0; i < 4; i += 1) {
    current = await warehouseOrderService.advanceOrderStatus(current._id.toString(), ids.warehouse, ids.whUser);
  }
  return current;
}

test.before(async () => {
  await startMemoryMongo({ dbName: 'feniq-pharmacy-review-save-test' });
  await ExchangeRate.create({ _id: 'singleton', usdToSyp: 10000, source: 'manual' });

  const [phUser, whUser] = await User.create([
    { name: 'PH', phone: '0932500001', role: 'pharmacy', status: 'active' },
    { name: 'WH', phone: '0942500001', role: 'warehouse', status: 'active' },
  ]);
  ids.phUser = phUser._id;
  ids.whUser = whUser._id;

  const pharmacy = await Pharmacy.create({
    userId: phUser._id, nameAr: 'ص', nameEn: 'Pharmacy', ownerName: 'O',
    address: 'a', city: 'Latakia', areaType: 'rural', phone: '0932500001', addedBy: 'self',
  });
  ids.pharmacy = pharmacy._id;

  const warehouse = await Warehouse.create({
    userId: whUser._id, nameAr: 'م', nameEn: 'Warehouse', address: 'r', city: 'Latakia',
    phone: '0942500001', deliveryType: 'self', isActive: true, discountRate: 0, commissionRate: 0,
  });
  ids.warehouse = warehouse._id;

  const product = await Product.create({
    warehouseId: warehouse._id, nameAr: 'دواء', nameEn: 'Drug', manufacturerAr: 'شركة',
    price: 100, unitAr: 'علبة', unitEn: 'box', isAvailable: true, isActive: true,
  });
  ids.product = product._id;
});

test.after(async () => {
  await stopMemoryMongo();
});

test('rating a pharmacy still saves cleanly now that areaType is required', async () => {
  const order = await orderService.createOrder({
    userId: ids.phUser, pharmacyId: ids.pharmacy, warehouseId: ids.warehouse,
    items: [{ productId: ids.product.toString(), quantity: 2 }], notes: null,
  });
  const delivered = await deliver(order);

  const before = await Pharmacy.findById(ids.pharmacy).lean();
  assert.strictEqual(before.reviewsCount, 0);

  const review = await warehouseReviewService.createPharmacyReview(ids.warehouse, ids.whUser, {
    orderId: delivered._id.toString(),
    rating: 4,
    comment: 'Good service',
  });
  assert.strictEqual(review.rating, 4);

  const after = await Pharmacy.findById(ids.pharmacy).lean();
  assert.strictEqual(after.reviewsCount, 1);
  assert.strictEqual(after.averageRating, 4);
  // The unrelated field this write path exists to update must not disturb
  // the pharmacy's own required areaType.
  assert.strictEqual(after.areaType, 'rural');
});
