// Account History "Money Saved" card: order.service.getSavingsSummaryForPharmacy
// sums OrderItem.savingsUsd (locked in at order time) across a pharmacy's
// non-cancelled orders. It computes no discount of its own - it only totals a
// field the order flow already stored.
//
// Own database, dropped at the end - same pattern as order.reorder.test.js.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-order-savings-tests';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const { startMemoryMongo, stopMemoryMongo } = require('./helpers/mongo');

const User = require('../src/models/user.model');
const Pharmacy = require('../src/models/pharmacy.model');
const Warehouse = require('../src/models/warehouse.model');
const Order = require('../src/models/order.model');
const OrderItem = require('../src/models/orderItem.model');

const orderService = require('../src/services/order.service');
const orderViewModel = require('../src/viewmodels/order.viewmodel');

const ids = {};
let orderSeq = 90000;

async function makeOrder(
  pharmacyId,
  warehouseId,
  { status = 'delivered', lines = [], discountAmount = 0, advertisementDiscountAmount = 0 }
) {
  const order = await Order.create({
    orderNumber: ++orderSeq,
    pharmacyId,
    warehouseId,
    status,
    totalPrice: 1000,
    discountAmount,
    advertisementDiscountAmount,
    commissionAmount: 0,
    finalPrice: 1000 - discountAmount - advertisementDiscountAmount,
    fx: { rate: 10000, source: 'manual', rateAsOf: new Date() },
    statusHistory: [{ status, changedBy: ids.pharmacyUser, changedAt: new Date() }],
  });
  await OrderItem.insertMany(
    lines.map((line, i) => ({
      orderId: order._id,
      productId: new mongoose.Types.ObjectId(),
      productNameAr: `صنف ${i}`,
      productNameEn: `Item ${i}`,
      manufacturerAr: 'Acme',
      manufacturerEn: 'Acme',
      quantity: line.quantity ?? 1,
      unitPrice: 100,
      discountPrice: 100,
      savingsUsd: line.savingsUsd ?? 0,
      savingsSyp: line.savingsSyp ?? 0,
    }))
  );
  return order;
}

test.before(async () => {
  await startMemoryMongo({ dbName: 'phoenix-order-savings-test' });

  const [pharmacyUser, otherPharmacyUser, thirdPharmacyUser, warehouseUser] = await User.create([
    { name: 'Pharm', phone: '0932900001', role: 'pharmacy', status: 'active' },
    { name: 'Other Pharm', phone: '0932900002', role: 'pharmacy', status: 'active' },
    { name: 'Third Pharm', phone: '0932900003', role: 'pharmacy', status: 'active' },
    { name: 'WH', phone: '0942900001', role: 'warehouse', status: 'active' },
  ]);
  ids.pharmacyUser = pharmacyUser._id;

  const [pharmacy, otherPharmacy, thirdPharmacy] = await Pharmacy.create([
    {
      userId: pharmacyUser._id, nameAr: 'ص', nameEn: 'Pharmacy', ownerName: 'O',
      address: 'a', city: 'Latakia', phone: '0932900001', addedBy: 'self',
    },
    {
      userId: otherPharmacyUser._id, nameAr: 'ص2', nameEn: 'Other Pharmacy', ownerName: 'O2',
      address: 'a', city: 'Latakia', phone: '0932900002', addedBy: 'self',
    },
    {
      userId: thirdPharmacyUser._id, nameAr: 'ص3', nameEn: 'Third Pharmacy', ownerName: 'O3',
      address: 'a', city: 'Latakia', phone: '0932900003', addedBy: 'self',
    },
  ]);
  const warehouse = await Warehouse.create({
    userId: warehouseUser._id, nameAr: 'مستودع', nameEn: 'Warehouse',
    address: 'r', city: 'Latakia', phone: '0942900001', deliveryType: 'self', isActive: true,
    discountRate: 0, commissionRate: 0,
  });
  ids.pharmacy = pharmacy._id;
  ids.otherPharmacy = otherPharmacy._id;
  ids.thirdPharmacy = thirdPharmacy._id;
  ids.warehouse = warehouse._id;
});

test.after(async () => {
  await stopMemoryMongo();
});

test('returns a fully zeroed breakdown for a pharmacy that has never ordered', async () => {
  const summary = await orderService.getSavingsSummaryForPharmacy(ids.otherPharmacy);
  assert.deepStrictEqual(summary, {
    offerAndManufacturerSyp: 0,
    advertisementSyp: 0,
    platformDiscountSyp: 0,
    totalSavingsSyp: 0,
    totalSavingsUsd: 0,
  });
});

test('sums savingsUsd across every line of every non-cancelled order', async () => {
  await makeOrder(ids.pharmacy, ids.warehouse, {
    status: 'delivered',
    lines: [{ savingsUsd: 1.5 }, { savingsUsd: 2.25 }],
  });
  await makeOrder(ids.pharmacy, ids.warehouse, {
    status: 'pending',
    lines: [{ savingsUsd: 0.25 }],
  });
  await makeOrder(ids.pharmacy, ids.warehouse, {
    status: 'out_for_delivery',
    lines: [{ savingsUsd: 0 }],
  });

  const summary = await orderService.getSavingsSummaryForPharmacy(ids.pharmacy);
  assert.strictEqual(summary.totalSavingsUsd, 4);
});

test('a cancelled order contributes nothing', async () => {
  const before = await orderService.getSavingsSummaryForPharmacy(ids.pharmacy);
  await makeOrder(ids.pharmacy, ids.warehouse, {
    status: 'cancelled',
    lines: [{ savingsUsd: 99 }],
  });
  const after = await orderService.getSavingsSummaryForPharmacy(ids.pharmacy);
  assert.strictEqual(after.totalSavingsUsd, before.totalSavingsUsd);
});

test('another pharmacy\'s savings never leak in', async () => {
  await makeOrder(ids.otherPharmacy, ids.warehouse, {
    status: 'delivered',
    lines: [{ savingsUsd: 500 }],
  });
  const summary = await orderService.getSavingsSummaryForPharmacy(ids.pharmacy);
  assert.strictEqual(summary.totalSavingsUsd, 4);
});

test('the viewmodel nests the breakdown under `savings`', () => {
  // Money-Flow V2: SYP is the primary figure (frozen, so it stops drifting
  // with the exchange rate) and the three components are broken out because
  // they answer different questions. The USD total rides along as a hint.
  const summary = {
    offerAndManufacturerSyp: 1000,
    advertisementSyp: 2000,
    platformDiscountSyp: 500,
    totalSavingsSyp: 3500,
    totalSavingsUsd: 4,
  };
  assert.deepStrictEqual(orderViewModel.toSavingsSummaryResponse(summary), { savings: summary });
});

test('the total includes the platform discount and any package saving', async () => {
  // V1 counted only the per-line offer/manufacturer savings, so a pharmacy
  // buying nothing but advertisement packages - the deepest discounts in the
  // product - was told it had saved nothing.
  const fresh = ids.thirdPharmacy;
  await makeOrder(fresh, ids.warehouse, {
    status: 'delivered',
    lines: [{ savingsUsd: 0, savingsSyp: 1000 }],
    discountAmount: 4000,
    advertisementDiscountAmount: 25000,
  });

  const summary = await orderService.getSavingsSummaryForPharmacy(fresh);
  assert.strictEqual(summary.offerAndManufacturerSyp, 1000);
  assert.strictEqual(summary.platformDiscountSyp, 4000);
  assert.strictEqual(summary.advertisementSyp, 25000);
  assert.strictEqual(summary.totalSavingsSyp, 30000, 'all three components, in frozen SYP');
});
