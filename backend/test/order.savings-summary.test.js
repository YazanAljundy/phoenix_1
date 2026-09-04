// Account History "Money Saved" card: order.service.getSavingsSummaryForPharmacy
// sums OrderItem.savingsUsd (locked in at order time) across a pharmacy's
// non-cancelled orders. It computes no discount of its own - it only totals a
// field the order flow already stored.
//
// Own database, dropped at the end - same pattern as order.reorder.test.js.
process.env.MONGODB_URI = 'mongodb://localhost:27017/phoenix-order-savings-test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-order-savings-tests';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');

const User = require('../src/models/user.model');
const Pharmacy = require('../src/models/pharmacy.model');
const Warehouse = require('../src/models/warehouse.model');
const Order = require('../src/models/order.model');
const OrderItem = require('../src/models/orderItem.model');

const orderService = require('../src/services/order.service');
const orderViewModel = require('../src/viewmodels/order.viewmodel');

const ids = {};
let orderSeq = 90000;

async function makeOrder(pharmacyId, warehouseId, { status = 'delivered', lines = [] }) {
  const order = await Order.create({
    orderNumber: ++orderSeq,
    pharmacyId,
    warehouseId,
    status,
    totalPrice: 1000,
    discountAmount: 0,
    commissionAmount: 0,
    finalPrice: 1000,
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
    }))
  );
  return order;
}

test.before(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  await mongoose.connection.dropDatabase();

  const [pharmacyUser, otherPharmacyUser, warehouseUser] = await User.create([
    { name: 'Pharm', phone: '0932900001', role: 'pharmacy', status: 'active' },
    { name: 'Other Pharm', phone: '0932900002', role: 'pharmacy', status: 'active' },
    { name: 'WH', phone: '0942900001', role: 'warehouse', status: 'active' },
  ]);
  ids.pharmacyUser = pharmacyUser._id;

  const [pharmacy, otherPharmacy] = await Pharmacy.create([
    {
      userId: pharmacyUser._id, nameAr: 'ص', nameEn: 'Pharmacy', ownerName: 'O',
      address: 'a', city: 'Latakia', phone: '0932900001', addedBy: 'self',
    },
    {
      userId: otherPharmacyUser._id, nameAr: 'ص2', nameEn: 'Other Pharmacy', ownerName: 'O2',
      address: 'a', city: 'Latakia', phone: '0932900002', addedBy: 'self',
    },
  ]);
  const warehouse = await Warehouse.create({
    userId: warehouseUser._id, nameAr: 'مستودع', nameEn: 'Warehouse',
    address: 'r', city: 'Latakia', phone: '0942900001', deliveryType: 'self', isActive: true,
    discountRate: 0, commissionRate: 0,
  });
  ids.pharmacy = pharmacy._id;
  ids.otherPharmacy = otherPharmacy._id;
  ids.warehouse = warehouse._id;
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test('returns 0 for a pharmacy that has never ordered', async () => {
  const summary = await orderService.getSavingsSummaryForPharmacy(ids.otherPharmacy);
  assert.deepStrictEqual(summary, { totalSavingsUsd: 0 });
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

test('the viewmodel nests the total under `savings`', () => {
  assert.deepStrictEqual(orderViewModel.toSavingsSummaryResponse({ totalSavingsUsd: 4 }), {
    savings: { totalSavingsUsd: 4 },
  });
});
