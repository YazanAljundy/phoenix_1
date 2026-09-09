// The pharmacist-facing "everything currently on offer" listing behind the
// app's Offers & Ads tab (GET /offers/active).
//
// It is a pure read: these tests pin WHICH offers a pharmacy may see (the
// approved + date-window rule, permanent offers included) and that the price
// it reports is the very same number the catalog already shows for that
// product - never a second, independently-computed discount.
//
// Runs against its own database and drops it at the end.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-offer-active-tests';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const { startMemoryMongo, stopMemoryMongo } = require('./helpers/mongo');

const User = require('../src/models/user.model');
const Warehouse = require('../src/models/warehouse.model');
const Product = require('../src/models/product.model');
const Offer = require('../src/models/offer.model');
const ManufacturerDiscount = require('../src/models/manufacturerDiscount.model');

const offerService = require('../src/services/offer.service');
const offerViewModel = require('../src/viewmodels/offer.viewmodel');
const productService = require('../src/services/product.service');
const productViewModel = require('../src/viewmodels/product.viewmodel');

const WAREHOUSE_A = new mongoose.Types.ObjectId();
const WAREHOUSE_B = new mongoose.Types.ObjectId();
const WAREHOUSE_OFF = new mongoose.Types.ObjectId();

let productA1;
let productA2;
let productB1;
let productOff;

const DAY = 24 * 60 * 60 * 1000;
const daysFromNow = (offset) => new Date(Date.now() + offset * DAY);

// An approved, currently-running offer unless a test overrides it.
function offerDoc(overrides = {}) {
  return {
    warehouseId: WAREHOUSE_A,
    productId: productA1._id,
    titleAr: 'عرض',
    titleEn: 'Offer',
    discountPercentage: 20,
    status: 'approved',
    startDate: daysFromNow(-1),
    endDate: daysFromNow(7),
    isPermanent: false,
    ...overrides,
  };
}

async function listSerialized() {
  const rows = await offerService.listActiveOffers();
  return offerViewModel.toActiveOffersResponse(rows).offers;
}

test.before(async () => {
  await startMemoryMongo({ dbName: 'feniq-offer-active-test' });

  const userA = new mongoose.Types.ObjectId();
  const userB = new mongoose.Types.ObjectId();
  const userOff = new mongoose.Types.ObjectId();
  await User.create([
    { _id: userA, name: 'WHA', phone: '0900000201', role: 'warehouse', status: 'active' },
    { _id: userB, name: 'WHB', phone: '0900000202', role: 'warehouse', status: 'active' },
    { _id: userOff, name: 'WHOff', phone: '0900000203', role: 'warehouse', status: 'active' },
  ]);
  await Warehouse.create([
    { _id: WAREHOUSE_A, userId: userA, nameAr: 'أ', nameEn: 'Alpha', address: 'a', city: 'Latakia', phone: '0900000201', isActive: true },
    { _id: WAREHOUSE_B, userId: userB, nameAr: 'ب', nameEn: 'Beta', address: 'a', city: 'Latakia', phone: '0900000202', isActive: true },
    { _id: WAREHOUSE_OFF, userId: userOff, nameAr: 'ج', nameEn: 'Gamma', address: 'a', city: 'Latakia', phone: '0900000203', isActive: false },
  ]);
  [productA1, productA2, productB1, productOff] = await Product.create([
    { warehouseId: WAREHOUSE_A, masterProductId: null, price: 10, nameAr: 'منتج أ1', nameEn: 'Prod A1', manufacturerAr: 'ش', manufacturerEn: 'Co', isActive: true, isAvailable: true, unitAr: 'ع', unitEn: 'box' },
    { warehouseId: WAREHOUSE_A, masterProductId: null, price: 20, nameAr: 'منتج أ2', nameEn: 'Prod A2', manufacturerAr: 'ش2', manufacturerEn: 'Co2', isActive: true, isAvailable: true, unitAr: 'ع', unitEn: 'box' },
    { warehouseId: WAREHOUSE_B, masterProductId: null, price: 30, nameAr: 'منتج ب1', nameEn: 'Prod B1', manufacturerAr: 'ش', manufacturerEn: 'Co', isActive: true, isAvailable: true, unitAr: 'ع', unitEn: 'box' },
    { warehouseId: WAREHOUSE_OFF, masterProductId: null, price: 40, nameAr: 'منتج ج', nameEn: 'Prod Off', manufacturerAr: 'ش', manufacturerEn: 'Co', isActive: true, isAvailable: true, unitAr: 'ع', unitEn: 'box' },
  ]);
});

test.after(async () => {
  await stopMemoryMongo();
});

test.beforeEach(async () => {
  await Offer.deleteMany({});
  await ManufacturerDiscount.deleteMany({});
});

// ---------------------------------------------------------------------------
// Which offers a pharmacy may see
// ---------------------------------------------------------------------------

test('lists a running approved offer across every warehouse', async () => {
  await Offer.create([offerDoc(), offerDoc({ warehouseId: WAREHOUSE_B, productId: productB1._id })]);

  const offers = await listSerialized();

  assert.equal(offers.length, 2);
  assert.deepEqual(
    offers.map((o) => o.warehouseId.toString()).sort(),
    [WAREHOUSE_A.toString(), WAREHOUSE_B.toString()].sort()
  );
});

test('a permanent offer with no end date is live', async () => {
  await Offer.create(offerDoc({ endDate: null, isPermanent: true }));

  const offers = await listSerialized();

  assert.equal(offers.length, 1);
  assert.equal(offers[0].isPermanent, true);
  assert.equal(offers[0].endDate, null);
});

test('a pending offer is never listed', async () => {
  await Offer.create(offerDoc({ status: 'pending' }));

  assert.deepEqual(await listSerialized(), []);
});

test('an expired offer is never listed', async () => {
  await Offer.create(offerDoc({ startDate: daysFromNow(-30), endDate: daysFromNow(-1) }));

  assert.deepEqual(await listSerialized(), []);
});

test('an offer that has not started yet is never listed', async () => {
  await Offer.create(offerDoc({ startDate: daysFromNow(3), endDate: daysFromNow(10) }));

  assert.deepEqual(await listSerialized(), []);
});

test('an offer from a deactivated warehouse is hidden', async () => {
  await Offer.create(offerDoc({ warehouseId: WAREHOUSE_OFF, productId: productOff._id }));

  assert.deepEqual(await listSerialized(), []);
});

test('an offer whose product has been deactivated is hidden', async () => {
  await Product.updateOne({ _id: productA2._id }, { isActive: false });
  await Offer.create(offerDoc({ productId: productA2._id }));

  const offers = await listSerialized();
  await Product.updateOne({ _id: productA2._id }, { isActive: true });

  assert.deepEqual(offers, []);
});

test('an offer pointing at a product owned by another warehouse is hidden', async () => {
  await Offer.create(offerDoc({ warehouseId: WAREHOUSE_A, productId: productB1._id }));

  assert.deepEqual(await listSerialized(), []);
});

test('a warehouse edit awaiting approval never changes what pharmacies see', async () => {
  await Offer.create(
    offerDoc({
      pendingUpdate: {
        productId: productA1._id,
        titleAr: 'عرض معدل',
        titleEn: 'Edited Offer',
        discountPercentage: 90,
        startDate: daysFromNow(-1),
        endDate: daysFromNow(7),
        isPermanent: false,
      },
    })
  );

  const offers = await listSerialized();

  assert.equal(offers[0].titleEn, 'Offer');
  assert.equal(offers[0].discountPercentage, 20);
});

// ---------------------------------------------------------------------------
// What the card is told
// ---------------------------------------------------------------------------

test('carries the product identity the client needs to navigate into the catalog', async () => {
  await Offer.create(offerDoc());

  const [offer] = await listSerialized();

  assert.equal(offer.productId.toString(), productA1._id.toString());
  assert.equal(offer.nameEn, 'Prod A1');
  assert.equal(offer.nameAr, 'منتج أ1');
  assert.equal(offer.manufacturerAr, 'ش');
  assert.equal(offer.warehouseNameEn, 'Alpha');
  assert.equal(offer.isAvailable, true);
});

test('the discounted price is the offer percentage off the catalog price', async () => {
  await Offer.create(offerDoc({ discountPercentage: 25 }));

  const [offer] = await listSerialized();

  assert.equal(offer.priceUsd, 10);
  assert.equal(offer.discountPriceUsd, 7.5);
});

test('the manufacturer discount stacks in, exactly as it does in the catalog', async () => {
  await ManufacturerDiscount.create({ warehouseId: WAREHOUSE_A, manufacturerAr: 'ش', discountPercentage: 10 });
  await Offer.create(offerDoc({ discountPercentage: 20 }));

  const [offer] = await listSerialized();

  // 10 -> 8 (offer) -> 7.2 (manufacturer).
  assert.equal(offer.discountPriceUsd, 7.2);

  // And it is the SAME number the catalog card shows for that product - the
  // offers tab must never quote a price the catalog disagrees with.
  const { items } = await productService.listWarehouseProducts(WAREHOUSE_A.toString(), {});
  const { products } = productViewModel.toProductListResponse(items);
  const catalogRow = products.find((p) => p.id.toString() === productA1._id.toString());
  assert.equal(catalogRow.discountPriceUsd, offer.discountPriceUsd);
});

test('a manufacturer discount from another warehouse never leaks in', async () => {
  await ManufacturerDiscount.create({ warehouseId: WAREHOUSE_B, manufacturerAr: 'ش', discountPercentage: 50 });
  await Offer.create(offerDoc({ discountPercentage: 20 }));

  const [offer] = await listSerialized();

  assert.equal(offer.discountPriceUsd, 8);
});

test('an unavailable product still lists, flagged as unavailable', async () => {
  await Product.updateOne({ _id: productA2._id }, { isAvailable: false });
  await Offer.create(offerDoc({ productId: productA2._id }));

  const offers = await listSerialized();
  await Product.updateOne({ _id: productA2._id }, { isAvailable: true });

  assert.equal(offers.length, 1);
  assert.equal(offers[0].isAvailable, false);
});

test('no live offers is an empty list, not an error', async () => {
  assert.deepEqual(await listSerialized(), []);
});
