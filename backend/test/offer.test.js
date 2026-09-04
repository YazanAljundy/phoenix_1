// End-to-end behaviour of the Offers feature: permanent offers, the
// warehouse's proposed-edit buffer, the admin decision on that buffer, direct
// admin edit/delete, cross-warehouse isolation, and the pharmacist-facing
// consequence (a permanent offer counts as "active" with no end date).
//
// Runs against its own database (phoenix-offer-test) and drops it at the end.
process.env.MONGODB_URI = 'mongodb://localhost:27017/phoenix-offer-test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-offer-tests';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');

const User = require('../src/models/user.model');
const Warehouse = require('../src/models/warehouse.model');
const Product = require('../src/models/product.model');
const Offer = require('../src/models/offer.model');
const warehouseOfferService = require('../src/services/warehouseOffer.service');
const adminOfferService = require('../src/services/adminOffer.service');
const productService = require('../src/services/product.service');

const WAREHOUSE_A = new mongoose.Types.ObjectId();
const WAREHOUSE_B = new mongoose.Types.ObjectId();
const ADMIN_ID = new mongoose.Types.ObjectId();
let productA1;
let productA2;
let productB1;

const DAY = 24 * 60 * 60 * 1000;
const iso = (offsetDays) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

async function seed() {
  const userA = new mongoose.Types.ObjectId();
  const userB = new mongoose.Types.ObjectId();
  await User.create([
    { _id: userA, name: 'WHA', phone: '0900000101', role: 'warehouse', status: 'active' },
    { _id: userB, name: 'WHB', phone: '0900000102', role: 'warehouse', status: 'active' },
  ]);
  await Warehouse.create([
    { _id: WAREHOUSE_A, userId: userA, nameAr: 'أ', nameEn: 'Alpha', address: 'a', city: 'Latakia', phone: '0900000101', isActive: true },
    { _id: WAREHOUSE_B, userId: userB, nameAr: 'ب', nameEn: 'Beta', address: 'a', city: 'Latakia', phone: '0900000102', isActive: true },
  ]);
  [productA1, productA2, productB1] = await Product.create([
    { warehouseId: WAREHOUSE_A, masterProductId: null, price: 10, nameAr: 'منتج أ1', nameEn: 'Prod A1', manufacturerAr: 'ش', manufacturerEn: 'Co', isActive: true, isAvailable: true, unitAr: 'ع', unitEn: 'box' },
    { warehouseId: WAREHOUSE_A, masterProductId: null, price: 20, nameAr: 'منتج أ2', nameEn: 'Prod A2', manufacturerAr: 'ش', manufacturerEn: 'Co', isActive: true, isAvailable: true, unitAr: 'ع', unitEn: 'box' },
    { warehouseId: WAREHOUSE_B, masterProductId: null, price: 30, nameAr: 'منتج ب1', nameEn: 'Prod B1', manufacturerAr: 'ش', manufacturerEn: 'Co', isActive: true, isAvailable: true, unitAr: 'ع', unitEn: 'box' },
  ]);
}

test.before(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await seed();
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test.beforeEach(async () => {
  await Offer.deleteMany({});
});

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

test('creates a normal offer with a start and end date, pending', async () => {
  const { offer } = await warehouseOfferService.createOffer(WAREHOUSE_A, {
    productId: productA1._id.toString(),
    titleAr: 'حسم', titleEn: 'Deal', discountPercentage: 15,
    startDate: iso(0), endDate: iso(10),
  });
  assert.strictEqual(offer.status, 'pending');
  assert.strictEqual(offer.isPermanent, false);
  assert.ok(offer.endDate instanceof Date);
});

test('creates a permanent offer with no end date', async () => {
  const { offer } = await warehouseOfferService.createOffer(WAREHOUSE_A, {
    productId: productA1._id.toString(),
    titleAr: 'دائم', titleEn: 'Forever', discountPercentage: 25,
    startDate: iso(0), isPermanent: true, endDate: iso(5), // endDate ignored when permanent
  });
  assert.strictEqual(offer.isPermanent, true);
  assert.strictEqual(offer.endDate, null);
  assert.strictEqual(offer.status, 'pending');
});

test('a non-permanent offer requires a valid end date after the start', async () => {
  const base = { productId: productA1._id.toString(), titleAr: 'x', titleEn: 'x', discountPercentage: 10, startDate: iso(5) };
  await assert.rejects(
    () => warehouseOfferService.createOffer(WAREHOUSE_A, { ...base }),
    /INVALID_DATE_RANGE|Invalid offer date range/
  );
  await assert.rejects(
    () => warehouseOfferService.createOffer(WAREHOUSE_A, { ...base, endDate: iso(1) }),
    /INVALID_DATE_RANGE|Invalid offer date range/
  );
});

test('a permanent offer still requires a start date', async () => {
  await assert.rejects(
    () => warehouseOfferService.createOffer(WAREHOUSE_A, {
      productId: productA1._id.toString(), titleAr: 'x', titleEn: 'x',
      discountPercentage: 10, isPermanent: true,
    }),
    /INVALID_DATE_RANGE|Invalid offer date range/
  );
});

test('discount must be between 1 and 100', async () => {
  const base = { productId: productA1._id.toString(), titleAr: 'x', titleEn: 'x', startDate: iso(0), endDate: iso(3) };
  await assert.rejects(() => warehouseOfferService.createOffer(WAREHOUSE_A, { ...base, discountPercentage: 0 }));
  await assert.rejects(() => warehouseOfferService.createOffer(WAREHOUSE_A, { ...base, discountPercentage: 150 }));
});

test('a warehouse cannot make an offer on another warehouse\'s product', async () => {
  await assert.rejects(
    () => warehouseOfferService.createOffer(WAREHOUSE_A, {
      productId: productB1._id.toString(), titleAr: 'x', titleEn: 'x',
      discountPercentage: 10, startDate: iso(0), endDate: iso(3),
    }),
    /PRODUCT_NOT_FOUND|Product not found/
  );
});

// ---------------------------------------------------------------------------
// Warehouse list + isolation
// ---------------------------------------------------------------------------

test('the warehouse list returns every one of its offers, any status', async () => {
  const a = await warehouseOfferService.createOffer(WAREHOUSE_A, { productId: productA1._id.toString(), titleAr: 'a', titleEn: 'a', discountPercentage: 10, startDate: iso(0), endDate: iso(3) });
  await adminOfferService.approveOffer(a.offer._id.toString(), ADMIN_ID);
  await warehouseOfferService.createOffer(WAREHOUSE_A, { productId: productA2._id.toString(), titleAr: 'b', titleEn: 'b', discountPercentage: 20, startDate: iso(0), endDate: iso(3) });
  await warehouseOfferService.createOffer(WAREHOUSE_B, { productId: productB1._id.toString(), titleAr: 'c', titleEn: 'c', discountPercentage: 30, startDate: iso(0), endDate: iso(3) });

  const rows = await warehouseOfferService.listOffersForWarehouse(WAREHOUSE_A);
  assert.strictEqual(rows.length, 2, 'only warehouse A\'s offers');
  assert.ok(rows.every((r) => r.product), 'each row resolves its product name');
});

test('findOwnedOfferOrThrow refuses another warehouse\'s offer', async () => {
  const b = await warehouseOfferService.createOffer(WAREHOUSE_B, { productId: productB1._id.toString(), titleAr: 'c', titleEn: 'c', discountPercentage: 30, startDate: iso(0), endDate: iso(3) });
  await assert.rejects(
    () => warehouseOfferService.findOwnedOfferOrThrow(b.offer._id.toString(), WAREHOUSE_A),
    /OFFER_NOT_FOUND|Offer not found/
  );
});

// ---------------------------------------------------------------------------
// Warehouse edit - the proposed-changes buffer
// ---------------------------------------------------------------------------

test('editing a still-pending offer changes it in place, no buffer', async () => {
  const { offer } = await warehouseOfferService.createOffer(WAREHOUSE_A, { productId: productA1._id.toString(), titleAr: 'a', titleEn: 'a', discountPercentage: 10, startDate: iso(0), endDate: iso(3) });
  await warehouseOfferService.updateOffer(offer._id.toString(), WAREHOUSE_A, {
    productId: productA1._id.toString(), titleAr: 'a2', titleEn: 'a2', discountPercentage: 40, startDate: iso(0), endDate: iso(9),
  });
  const fresh = await Offer.findById(offer._id);
  assert.strictEqual(fresh.discountPercentage, 40);
  assert.strictEqual(fresh.titleEn, 'a2');
  assert.strictEqual(fresh.status, 'pending');
  assert.strictEqual(fresh.pendingUpdate, null);
});

test('editing an APPROVED offer parks the change and leaves the live offer untouched', async () => {
  const { offer } = await warehouseOfferService.createOffer(WAREHOUSE_A, { productId: productA1._id.toString(), titleAr: 'live', titleEn: 'live', discountPercentage: 10, startDate: iso(0), endDate: iso(30) });
  await adminOfferService.approveOffer(offer._id.toString(), ADMIN_ID);

  await warehouseOfferService.updateOffer(offer._id.toString(), WAREHOUSE_A, {
    productId: productA1._id.toString(), titleAr: 'proposed', titleEn: 'proposed', discountPercentage: 55, startDate: iso(0), isPermanent: true,
  });

  const fresh = await Offer.findById(offer._id);
  assert.strictEqual(fresh.status, 'approved');
  assert.strictEqual(fresh.discountPercentage, 10, 'live discount unchanged');
  assert.strictEqual(fresh.titleEn, 'live', 'live title unchanged');
  assert.ok(fresh.pendingUpdate, 'the edit is parked');
  assert.strictEqual(fresh.pendingUpdate.discountPercentage, 55);
  assert.strictEqual(fresh.pendingUpdate.isPermanent, true);
});

test('re-editing an approved offer overwrites the same parked edit, never a second one', async () => {
  const { offer } = await warehouseOfferService.createOffer(WAREHOUSE_A, { productId: productA1._id.toString(), titleAr: 'live', titleEn: 'live', discountPercentage: 10, startDate: iso(0), endDate: iso(30) });
  await adminOfferService.approveOffer(offer._id.toString(), ADMIN_ID);

  await warehouseOfferService.updateOffer(offer._id.toString(), WAREHOUSE_A, { productId: productA1._id.toString(), titleAr: 'first', titleEn: 'first', discountPercentage: 20, startDate: iso(0), endDate: iso(30) });
  await warehouseOfferService.updateOffer(offer._id.toString(), WAREHOUSE_A, { productId: productA1._id.toString(), titleAr: 'second', titleEn: 'second', discountPercentage: 35, startDate: iso(0), endDate: iso(30) });

  const fresh = await Offer.findById(offer._id);
  assert.strictEqual(fresh.titleEn, 'live', 'live offer still untouched');
  assert.strictEqual(fresh.pendingUpdate.titleEn, 'second', 'only the latest proposal is kept');
  assert.strictEqual(fresh.pendingUpdate.discountPercentage, 35);
});

// ---------------------------------------------------------------------------
// Admin decision on the buffer
// ---------------------------------------------------------------------------

test('approving a parked edit applies it and keeps the offer live', async () => {
  const { offer } = await warehouseOfferService.createOffer(WAREHOUSE_A, { productId: productA1._id.toString(), titleAr: 'live', titleEn: 'live', discountPercentage: 10, startDate: iso(-1), endDate: iso(30) });
  await adminOfferService.approveOffer(offer._id.toString(), ADMIN_ID);
  await warehouseOfferService.updateOffer(offer._id.toString(), WAREHOUSE_A, {
    productId: productA2._id.toString(), titleAr: 'new', titleEn: 'new', discountPercentage: 45, startDate: iso(-1), isPermanent: true,
  });

  await adminOfferService.approveOffer(offer._id.toString(), ADMIN_ID);

  const fresh = await Offer.findById(offer._id);
  assert.strictEqual(fresh.status, 'approved');
  assert.strictEqual(fresh.discountPercentage, 45);
  assert.strictEqual(fresh.titleEn, 'new');
  assert.strictEqual(String(fresh.productId), String(productA2._id));
  assert.strictEqual(fresh.isPermanent, true);
  assert.strictEqual(fresh.endDate, null);
  assert.strictEqual(fresh.pendingUpdate, null);
});

test('rejecting a parked edit discards it and leaves the live offer exactly as it was', async () => {
  const { offer } = await warehouseOfferService.createOffer(WAREHOUSE_A, { productId: productA1._id.toString(), titleAr: 'live', titleEn: 'live', discountPercentage: 10, startDate: iso(-1), endDate: iso(30) });
  await adminOfferService.approveOffer(offer._id.toString(), ADMIN_ID);
  await warehouseOfferService.updateOffer(offer._id.toString(), WAREHOUSE_A, {
    productId: productA1._id.toString(), titleAr: 'x', titleEn: 'x', discountPercentage: 99, startDate: iso(-1), endDate: iso(60),
  });

  await adminOfferService.rejectOffer(offer._id.toString());

  const fresh = await Offer.findById(offer._id);
  assert.ok(fresh, 'the offer still exists');
  assert.strictEqual(fresh.status, 'approved');
  assert.strictEqual(fresh.discountPercentage, 10);
  assert.strictEqual(fresh.titleEn, 'live');
  assert.strictEqual(fresh.pendingUpdate, null);
});

test('approving a brand-new offer sets it live; rejecting one deletes it', async () => {
  const a = await warehouseOfferService.createOffer(WAREHOUSE_A, { productId: productA1._id.toString(), titleAr: 'a', titleEn: 'a', discountPercentage: 10, startDate: iso(0), endDate: iso(3) });
  await adminOfferService.approveOffer(a.offer._id.toString(), ADMIN_ID);
  assert.strictEqual((await Offer.findById(a.offer._id)).status, 'approved');

  const b = await warehouseOfferService.createOffer(WAREHOUSE_A, { productId: productA2._id.toString(), titleAr: 'b', titleEn: 'b', discountPercentage: 10, startDate: iso(0), endDate: iso(3) });
  await adminOfferService.rejectOffer(b.offer._id.toString());
  assert.strictEqual(await Offer.findById(b.offer._id), null, 'a rejected new offer is gone');
});

// ---------------------------------------------------------------------------
// Warehouse delete
// ---------------------------------------------------------------------------

test('the warehouse deletes its own offer from the database', async () => {
  const { offer } = await warehouseOfferService.createOffer(WAREHOUSE_A, { productId: productA1._id.toString(), titleAr: 'a', titleEn: 'a', discountPercentage: 10, startDate: iso(0), endDate: iso(3) });
  await warehouseOfferService.deleteOffer(offer._id.toString(), WAREHOUSE_A);
  assert.strictEqual(await Offer.findById(offer._id), null);
});

test('the warehouse cannot delete another warehouse\'s offer', async () => {
  const b = await warehouseOfferService.createOffer(WAREHOUSE_B, { productId: productB1._id.toString(), titleAr: 'c', titleEn: 'c', discountPercentage: 30, startDate: iso(0), endDate: iso(3) });
  await assert.rejects(
    () => warehouseOfferService.deleteOffer(b.offer._id.toString(), WAREHOUSE_A),
    /OFFER_NOT_FOUND|Offer not found/
  );
  assert.ok(await Offer.findById(b.offer._id), 'the offer is untouched');
});

// ---------------------------------------------------------------------------
// Admin listing + direct edit/delete
// ---------------------------------------------------------------------------

test('the admin sees every warehouse\'s offers, each tagged with its warehouse', async () => {
  await warehouseOfferService.createOffer(WAREHOUSE_A, { productId: productA1._id.toString(), titleAr: 'a', titleEn: 'a', discountPercentage: 10, startDate: iso(0), endDate: iso(3) });
  await warehouseOfferService.createOffer(WAREHOUSE_B, { productId: productB1._id.toString(), titleAr: 'c', titleEn: 'c', discountPercentage: 30, startDate: iso(0), endDate: iso(3) });

  const rows = await adminOfferService.listAllOffers();
  assert.strictEqual(rows.length, 2);
  const names = rows.map((r) => r.warehouse && r.warehouse.nameEn).sort();
  assert.deepStrictEqual(names, ['Alpha', 'Beta']);
});

test('the admin moderation queue contains new offers AND parked edits', async () => {
  const a = await warehouseOfferService.createOffer(WAREHOUSE_A, { productId: productA1._id.toString(), titleAr: 'a', titleEn: 'a', discountPercentage: 10, startDate: iso(-1), endDate: iso(30) });
  await adminOfferService.approveOffer(a.offer._id.toString(), ADMIN_ID);
  await warehouseOfferService.updateOffer(a.offer._id.toString(), WAREHOUSE_A, { productId: productA1._id.toString(), titleAr: 'a', titleEn: 'a', discountPercentage: 22, startDate: iso(-1), endDate: iso(30) });
  await warehouseOfferService.createOffer(WAREHOUSE_B, { productId: productB1._id.toString(), titleAr: 'c', titleEn: 'c', discountPercentage: 30, startDate: iso(0), endDate: iso(3) });

  const rows = await adminOfferService.listPendingOffers();
  assert.strictEqual(rows.length, 2, 'the edited-approved offer + the new offer');
});

test('an admin direct edit applies straight away when no edit is parked', async () => {
  const { offer } = await warehouseOfferService.createOffer(WAREHOUSE_A, { productId: productA1._id.toString(), titleAr: 'a', titleEn: 'a', discountPercentage: 10, startDate: iso(-1), endDate: iso(30) });
  await adminOfferService.approveOffer(offer._id.toString(), ADMIN_ID);

  await adminOfferService.adminUpdateOffer(offer._id.toString(), {
    productId: productA1._id.toString(), titleAr: 'admin', titleEn: 'admin', discountPercentage: 12, startDate: iso(-1), isPermanent: true,
  });

  const fresh = await Offer.findById(offer._id);
  assert.strictEqual(fresh.discountPercentage, 12);
  assert.strictEqual(fresh.titleEn, 'admin');
  assert.strictEqual(fresh.isPermanent, true);
  assert.strictEqual(fresh.pendingUpdate, null);
});

test('an admin direct edit is refused while a warehouse edit is parked', async () => {
  const { offer } = await warehouseOfferService.createOffer(WAREHOUSE_A, { productId: productA1._id.toString(), titleAr: 'live', titleEn: 'live', discountPercentage: 10, startDate: iso(-1), endDate: iso(30) });
  await adminOfferService.approveOffer(offer._id.toString(), ADMIN_ID);
  await warehouseOfferService.updateOffer(offer._id.toString(), WAREHOUSE_A, { productId: productA1._id.toString(), titleAr: 'wh', titleEn: 'wh', discountPercentage: 33, startDate: iso(-1), endDate: iso(30) });

  await assert.rejects(
    () => adminOfferService.adminUpdateOffer(offer._id.toString(), {
      productId: productA1._id.toString(), titleAr: 'admin', titleEn: 'admin', discountPercentage: 12, startDate: iso(-1), isPermanent: true,
    }),
    /OFFER_HAS_PENDING_UPDATE|pending edit/
  );

  const fresh = await Offer.findById(offer._id);
  assert.strictEqual(fresh.discountPercentage, 10, 'the live offer is untouched');
  assert.strictEqual(fresh.titleEn, 'live');
  assert.ok(fresh.pendingUpdate, 'the parked edit is still there');
  assert.strictEqual(fresh.pendingUpdate.discountPercentage, 33);

  // ...and the admin then decides it through the normal flow.
  await adminOfferService.approveOffer(offer._id.toString(), ADMIN_ID);
  const decided = await Offer.findById(offer._id);
  assert.strictEqual(decided.discountPercentage, 33);
  assert.strictEqual(decided.pendingUpdate, null);
});

test('an admin delete removes any offer from the database', async () => {
  const b = await warehouseOfferService.createOffer(WAREHOUSE_B, { productId: productB1._id.toString(), titleAr: 'c', titleEn: 'c', discountPercentage: 30, startDate: iso(0), endDate: iso(3) });
  await adminOfferService.adminDeleteOffer(b.offer._id.toString());
  assert.strictEqual(await Offer.findById(b.offer._id), null);
});

// ---------------------------------------------------------------------------
// The pharmacist-facing consequence
// ---------------------------------------------------------------------------

test('a permanent approved offer counts as active (no end date), an expired one does not', async () => {
  // permanent, started yesterday, no end
  const perm = await warehouseOfferService.createOffer(WAREHOUSE_A, { productId: productA1._id.toString(), titleAr: 'p', titleEn: 'p', discountPercentage: 10, startDate: iso(-1), isPermanent: true });
  await adminOfferService.approveOffer(perm.offer._id.toString(), ADMIN_ID);
  // normal, already ended
  const expired = await warehouseOfferService.createOffer(WAREHOUSE_A, { productId: productA2._id.toString(), titleAr: 'e', titleEn: 'e', discountPercentage: 10, startDate: iso(-10), endDate: iso(10) });
  await adminOfferService.approveOffer(expired.offer._id.toString(), ADMIN_ID);
  await Offer.updateOne({ _id: expired.offer._id }, { endDate: new Date(Date.now() - DAY) });

  const { items } = await productService.listWarehouseProducts(WAREHOUSE_A, { limit: 100 });
  const byName = new Map(items.map((i) => [i.product.nameEn, i]));
  assert.ok(byName.get('Prod A1').offer, 'the permanent offer is active');
  assert.strictEqual(byName.get('Prod A2').offer, null, 'the expired offer is not');
});
