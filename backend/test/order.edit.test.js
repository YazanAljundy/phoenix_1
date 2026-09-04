// Editing an order's items (warehouseOrder.service.updateOrderItems) is gated
// ONLY by the order's status ('pending'), never by the order's age. This pins
// that a pending order stays editable minutes, hours, days and weeks after it
// was created, and that the one real gate (status) still holds.
//
// Own database, dropped at the end - same pattern as order.status.test.js.
process.env.MONGODB_URI = 'mongodb://localhost:27017/phoenix-order-edit-test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-order-edit-tests';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const mongoose = require('mongoose');

function stubModule(relativePath, exportsValue) {
  const resolved = require.resolve(path.join(__dirname, '..', 'src', relativePath));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsValue };
}
stubModule('services/notification.service.js', { sendToUser: async () => {}, sendToAll: async () => {} });
stubModule('realtime/index.js', {
  emitToWarehouse: () => {},
  emitToAdmins: () => {},
  EVENTS: { ORDER_CREATED: 'order.created', ORDER_STATUS_UPDATED: 'order.status.updated' },
});

const User = require('../src/models/user.model');
const Pharmacy = require('../src/models/pharmacy.model');
const Warehouse = require('../src/models/warehouse.model');
const Order = require('../src/models/order.model');
const OrderItem = require('../src/models/orderItem.model');

const warehouseOrderService = require('../src/services/warehouseOrder.service');

function withCode(expected) {
  return (err) => {
    assert.strictEqual(err.code, expected, `expected error code ${expected}, got ${err.code}`);
    return true;
  };
}

const ids = {};
let orderSeq = 70000;

async function makeOrder(status, ageMs) {
  const order = await Order.create({
    orderNumber: ++orderSeq, pharmacyId: ids.pharmacy, warehouseId: ids.warehouse, status,
    totalPrice: 200, discountAmount: 0, commissionAmount: 0, finalPrice: 200,
    statusHistory: [{ status, changedBy: ids.pharmacyUser, changedAt: new Date() }],
  });
  const item = await OrderItem.create({
    orderId: order._id, productId: new mongoose.Types.ObjectId(),
    productNameAr: 'دواء', productNameEn: 'Drug', manufacturerAr: 'شركة', manufacturerEn: 'Co',
    quantity: 2, unitPrice: 100, discountPrice: 100, savingsUsd: 0,
  });
  if (ageMs) {
    await Order.collection.updateOne(
      { _id: order._id },
      { $set: { createdAt: new Date(Date.now() - ageMs) } }
    );
  }
  return { order, item };
}

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

test.before(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  await mongoose.connection.dropDatabase();

  const [pharmacyUser, whUser] = await User.create([
    { name: 'Ph', phone: '0932000201', role: 'pharmacy', status: 'active' },
    { name: 'WH', phone: '0942000201', role: 'warehouse', status: 'active' },
  ]);
  ids.pharmacyUser = pharmacyUser._id;
  const pharmacy = await Pharmacy.create({
    userId: pharmacyUser._id, nameAr: 'ص', nameEn: 'Pharmacy', ownerName: 'O',
    address: 'a', city: 'Latakia', phone: '0932000201', addedBy: 'self',
  });
  const warehouse = await Warehouse.create({
    userId: whUser._id, nameAr: 'م', nameEn: 'Warehouse', address: 'r', city: 'Latakia',
    phone: '0942000201', deliveryType: 'self', isActive: true, discountRate: 0, commissionRate: 0,
  });
  ids.pharmacy = pharmacy._id;
  ids.warehouse = warehouse._id;
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

async function editQuantity(order, item, quantity) {
  return warehouseOrderService.updateOrderItems(order._id.toString(), ids.warehouse, ids.pharmacyUser, {
    updateItems: [{ orderItemId: item._id.toString(), quantity }],
  });
}

for (const [label, ageMs] of [
  ['just created', 0],
  ['4 minutes old', 4 * MINUTE],
  ['6 minutes old (past the old 5-minute window)', 6 * MINUTE],
  ['5 hours old', 5 * 60 * MINUTE],
  ['10 days old', 10 * DAY],
  ['6 weeks old', 42 * DAY],
]) {
  test(`a pending order that is ${label} can still be edited`, async () => {
    const { order, item } = await makeOrder('pending', ageMs);

    const result = await editQuantity(order, item, 5);

    assert.strictEqual(result.items.find((i) => String(i._id) === String(item._id)).quantity, 5);
    const reloaded = await Order.findById(order._id).lean();
    assert.strictEqual(reloaded.totalPrice, 500); // 100 * 5, rates are 0
    assert.ok(reloaded.statusHistory.some((e) => e.status === 'modified'));
  });
}

test('the warehouse can edit its own 10-day-old pending order (permissions + status unchanged)', async () => {
  const { order, item } = await makeOrder('pending', 10 * DAY);
  const result = await editQuantity(order, item, 3);
  assert.strictEqual(result.order.finalPrice, 300);
});

test('a non-pending order is still rejected - by status, not by age', async () => {
  // Fresh, but already confirmed => still blocked.
  const fresh = await makeOrder('confirmed', 0);
  await assert.rejects(() => editQuantity(fresh.order, fresh.item, 4), withCode('ORDER_NOT_EDITABLE'));

  // Ancient, but still pending => allowed (the age is irrelevant).
  const ancient = await makeOrder('pending', 60 * DAY);
  const ok = await editQuantity(ancient.order, ancient.item, 4);
  assert.strictEqual(ok.order.totalPrice, 400);
});

test('a wrong-warehouse edit is still an IDOR 404 (unchanged)', async () => {
  const { order, item } = await makeOrder('pending', DAY);
  await assert.rejects(
    () =>
      warehouseOrderService.updateOrderItems(
        order._id.toString(),
        new mongoose.Types.ObjectId(),
        ids.pharmacyUser,
        { updateItems: [{ orderItemId: item._id.toString(), quantity: 4 }] }
      ),
    withCode('ORDER_NOT_FOUND')
  );
});
