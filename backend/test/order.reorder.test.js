// "Reorder an existing order" - order.service.prepareReorder builds a
// cart-ready payload from a past DELIVERED order without creating or mutating
// anything, and a later checkout goes through the normal createOrder flow.
//
// Own database, dropped at the end - same pattern as order.status.test.js /
// projection.select.test.js. realtime is stubbed through require.cache so
// order.created can be observed; the exchange rate is stubbed so checkout can
// price without a seeded rate document.
process.env.MONGODB_URI = 'mongodb://localhost:27017/phoenix-order-reorder-test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-order-reorder-tests';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const mongoose = require('mongoose');

const emitted = [];

function stubModule(relativePath, exportsValue) {
  const resolved = require.resolve(path.join(__dirname, '..', 'src', relativePath));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsValue };
}

stubModule('realtime/index.js', {
  emitToWarehouse: (warehouseId, event, payload) =>
    emitted.push({ room: `warehouse:${warehouseId}`, event, payload }),
  emitToAdmins: (event, payload) => emitted.push({ room: 'admin', event, payload }),
  EVENTS: {
    ORDER_CREATED: 'order.created',
    ORDER_CANCELLED: 'order.cancelled',
    ORDER_STATUS_UPDATED: 'order.status.updated',
  },
});
stubModule('services/exchangeRate.service.js', {
  getRate: async () => ({ usdToSyp: 15000 }),
});
stubModule('services/notification.service.js', {
  sendToUser: async () => {},
  sendToAll: async () => {},
});

const User = require('../src/models/user.model');
const Pharmacy = require('../src/models/pharmacy.model');
const Warehouse = require('../src/models/warehouse.model');
const Product = require('../src/models/product.model');
const Order = require('../src/models/order.model');
const OrderItem = require('../src/models/orderItem.model');

const orderService = require('../src/services/order.service');
const orderViewModel = require('../src/viewmodels/order.viewmodel');

function withCode(expected) {
  return (err) => {
    assert.strictEqual(err.code, expected, `expected error code ${expected}, got ${err.code}`);
    return true;
  };
}

const ids = {};
let orderSeq = 5000;

async function makeProduct(warehouseId, { name, price, isActive = true, isAvailable = true }) {
  const product = await Product.create({
    warehouseId,
    nameAr: name,
    nameEn: name,
    manufacturerAr: 'Acme',
    manufacturerEn: 'Acme',
    price,
    isActive,
    isAvailable,
    unitAr: 'علبة',
    unitEn: 'box',
  });
  return product;
}

async function makeDeliveredOrder(pharmacyId, warehouseId, lines) {
  const order = await Order.create({
    orderNumber: ++orderSeq,
    pharmacyId,
    warehouseId,
    status: 'delivered',
    totalPrice: 1000,
    discountAmount: 0,
    commissionAmount: 0,
    finalPrice: 1000,
    statusHistory: [{ status: 'delivered', changedBy: ids.pharmacyUser, changedAt: new Date() }],
  });
  await OrderItem.insertMany(
    lines.map((line) => ({
      orderId: order._id,
      productId: line.productId,
      productNameAr: line.name,
      productNameEn: line.name,
      manufacturerAr: 'Acme',
      manufacturerEn: 'Acme',
      quantity: line.quantity,
      unitPrice: 100,
      discountPrice: 100,
      savingsUsd: 0,
    }))
  );
  return order;
}

test.before(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  await mongoose.connection.dropDatabase();

  const [pharmacyUser, otherPharmacyUser, warehouseUser] = await User.create([
    { name: 'Pharm', phone: '0932000001', role: 'pharmacy', status: 'active' },
    { name: 'Other Pharm', phone: '0932000002', role: 'pharmacy', status: 'active' },
    { name: 'WH', phone: '0942000001', role: 'warehouse', status: 'active' },
  ]);
  ids.pharmacyUser = pharmacyUser._id;

  const [pharmacy, otherPharmacy] = await Pharmacy.create([
    {
      userId: pharmacyUser._id, nameAr: 'ص', nameEn: 'Pharmacy', ownerName: 'O',
      address: 'a', city: 'Latakia', phone: '0932000001', addedBy: 'self',
    },
    {
      userId: otherPharmacyUser._id, nameAr: 'ص2', nameEn: 'Other Pharmacy', ownerName: 'O2',
      address: 'a', city: 'Latakia', phone: '0932000002', addedBy: 'self',
    },
  ]);
  const warehouse = await Warehouse.create({
    userId: warehouseUser._id, nameAr: 'مستودع', nameEn: 'Warehouse',
    address: 'r', city: 'Latakia', phone: '0942000001', deliveryType: 'self', isActive: true,
    discountRate: 0, commissionRate: 0,
  });
  ids.pharmacy = pharmacy._id;
  ids.otherPharmacy = otherPharmacy._id;
  ids.warehouse = warehouse._id;

  const p1 = await makeProduct(warehouse._id, { name: 'Alpha', price: 2 });
  const p2 = await makeProduct(warehouse._id, { name: 'Beta', price: 5 });
  const p3 = await makeProduct(warehouse._id, { name: 'Gamma', price: 7 });
  ids.p1 = p1._id;
  ids.p2 = p2._id;
  ids.p3 = p3._id;
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test.beforeEach(() => {
  emitted.length = 0;
});

// --- Successful preparation ------------------------------------------------

test('prepareReorder returns the warehouse and every ordered line with CURRENT prices + original quantities', async () => {
  const order = await makeDeliveredOrder(ids.pharmacy, ids.warehouse, [
    { productId: ids.p1, name: 'Alpha', quantity: 3 },
    { productId: ids.p2, name: 'Beta', quantity: 1 },
  ]);

  const prep = await orderService.prepareReorder(order._id.toString(), ids.pharmacy);

  assert.strictEqual(String(prep.warehouse._id), String(ids.warehouse));
  assert.strictEqual(prep.items.length, 2);
  assert.deepStrictEqual(prep.unavailableItems, []);

  const byId = new Map(prep.items.map((i) => [String(i.product._id), i]));
  // Quantity from the original order; price live from the catalog (not the
  // stored unitPrice of 100 on the OrderItem).
  assert.strictEqual(byId.get(String(ids.p1)).quantity, 3);
  assert.strictEqual(byId.get(String(ids.p1)).product.price, 2);
  assert.strictEqual(byId.get(String(ids.p2)).quantity, 1);
  assert.strictEqual(byId.get(String(ids.p2)).product.price, 5);
});

test('the reorder viewmodel emits the same product shape as the catalog browse, plus quantity, plus no order identity', async () => {
  const order = await makeDeliveredOrder(ids.pharmacy, ids.warehouse, [
    { productId: ids.p1, name: 'Alpha', quantity: 4 },
  ]);
  const prep = await orderService.prepareReorder(order._id.toString(), ids.pharmacy);
  const body = orderViewModel.toReorderResponse(prep);

  assert.ok(body.reorder);
  assert.strictEqual(String(body.reorder.warehouseId), String(ids.warehouse));
  const item = body.reorder.items[0];
  assert.strictEqual(item.quantity, 4);
  assert.strictEqual(item.priceUsd, 2);
  assert.ok('discountPriceUsd' in item);
  assert.ok('isAvailable' in item);
  // Reorder creates nothing - no order id / number / status leaks through.
  assert.ok(!('id' in body.reorder));
  assert.ok(!('orderNumber' in body.reorder));
  assert.ok(!('status' in body.reorder));
});

test('prepareReorder copies ALL products from a multi-line order', async () => {
  const order = await makeDeliveredOrder(ids.pharmacy, ids.warehouse, [
    { productId: ids.p1, name: 'Alpha', quantity: 1 },
    { productId: ids.p2, name: 'Beta', quantity: 2 },
    { productId: ids.p3, name: 'Gamma', quantity: 9 },
  ]);
  const prep = await orderService.prepareReorder(order._id.toString(), ids.pharmacy);
  assert.strictEqual(prep.items.length, 3);
  assert.strictEqual(prep.items.reduce((sum, i) => sum + i.quantity, 0), 12);
});

// --- The original order is never touched ---------------------------------

test('prepareReorder never mutates or duplicates the original order', async () => {
  const order = await makeDeliveredOrder(ids.pharmacy, ids.warehouse, [
    { productId: ids.p1, name: 'Alpha', quantity: 3 },
  ]);
  const ordersBefore = await Order.countDocuments();

  await orderService.prepareReorder(order._id.toString(), ids.pharmacy);

  const after = await Order.findById(order._id).lean();
  assert.strictEqual(after.status, 'delivered');
  assert.strictEqual(after.orderNumber, order.orderNumber);
  assert.strictEqual(await Order.countDocuments(), ordersBefore, 'no new order document created');
  assert.deepStrictEqual(emitted, [], 'reorder preparation emits nothing');
});

// --- Ownership / IDOR / eligibility -------------------------------------

test('a pharmacy cannot reorder another pharmacy order (IDOR)', async () => {
  const order = await makeDeliveredOrder(ids.otherPharmacy, ids.warehouse, [
    { productId: ids.p1, name: 'Alpha', quantity: 1 },
  ]);
  await assert.rejects(
    () => orderService.prepareReorder(order._id.toString(), ids.pharmacy),
    withCode('ORDER_NOT_FOUND')
  );
});

test('an unknown / malformed order id is rejected', async () => {
  await assert.rejects(
    () => orderService.prepareReorder('not-an-id', ids.pharmacy),
    withCode('ORDER_NOT_FOUND')
  );
  await assert.rejects(
    () => orderService.prepareReorder(new mongoose.Types.ObjectId().toString(), ids.pharmacy),
    withCode('ORDER_NOT_FOUND')
  );
});

test('a non-delivered order is not reorderable', async () => {
  for (const status of ['pending', 'confirmed', 'preparing', 'out_for_delivery', 'cancelled']) {
    const order = await Order.create({
      orderNumber: ++orderSeq, pharmacyId: ids.pharmacy, warehouseId: ids.warehouse, status,
      totalPrice: 1, discountAmount: 0, commissionAmount: 0, finalPrice: 1, statusHistory: [],
    });
    await OrderItem.create({
      orderId: order._id, productId: ids.p1, productNameAr: 'Alpha', productNameEn: 'Alpha',
      manufacturerAr: 'Acme', manufacturerEn: 'Acme', quantity: 1, unitPrice: 1, discountPrice: 1,
    });
    await assert.rejects(
      () => orderService.prepareReorder(order._id.toString(), ids.pharmacy),
      withCode('ORDER_NOT_REORDERABLE')
    );
  }
});

// --- Unavailable / removed products ------------------------------------

test('a product the warehouse no longer sells is reported, not forced into the cart', async () => {
  const removed = await makeProduct(ids.warehouse, { name: 'Removed', price: 3, isActive: false });
  const order = await makeDeliveredOrder(ids.pharmacy, ids.warehouse, [
    { productId: ids.p1, name: 'Alpha', quantity: 2 },
    { productId: removed._id, name: 'Removed', quantity: 5 },
  ]);

  const prep = await orderService.prepareReorder(order._id.toString(), ids.pharmacy);

  assert.strictEqual(prep.items.length, 1);
  assert.strictEqual(String(prep.items[0].product._id), String(ids.p1));
  assert.strictEqual(prep.unavailableItems.length, 1);
  assert.strictEqual(String(prep.unavailableItems[0].productId), String(removed._id));
  assert.strictEqual(prep.unavailableItems[0].quantity, 5);
});

test('a temporarily-unavailable product is still copied (checkout re-validates it)', async () => {
  const paused = await makeProduct(ids.warehouse, { name: 'Paused', price: 4, isAvailable: false });
  const order = await makeDeliveredOrder(ids.pharmacy, ids.warehouse, [
    { productId: paused._id, name: 'Paused', quantity: 1 },
  ]);
  const prep = await orderService.prepareReorder(order._id.toString(), ids.pharmacy);
  assert.strictEqual(prep.items.length, 1);
  assert.strictEqual(prep.items[0].product.isAvailable, false);
  assert.deepStrictEqual(prep.unavailableItems, []);
});

// --- Checkout after reorder creates a NEW order -----------------------

test('checkout after reorder creates a brand-new pending order and emits order.created exactly once', async () => {
  const original = await makeDeliveredOrder(ids.pharmacy, ids.warehouse, [
    { productId: ids.p1, name: 'Alpha', quantity: 3 },
    { productId: ids.p2, name: 'Beta', quantity: 2 },
  ]);
  const prep = await orderService.prepareReorder(original._id.toString(), ids.pharmacy);

  // The cart would edit these; here we submit them as-is via the normal path.
  const newOrder = await orderService.createOrder({
    userId: ids.pharmacyUser,
    pharmacyId: ids.pharmacy,
    warehouseId: String(prep.warehouse._id),
    items: prep.items.map((i) => ({ productId: String(i.product._id), quantity: i.quantity })),
  });

  assert.notStrictEqual(String(newOrder._id), String(original._id));
  assert.notStrictEqual(newOrder.orderNumber, original.orderNumber);
  assert.strictEqual(newOrder.status, 'pending');
  assert.strictEqual(newOrder.statusHistory[0].status, 'pending');

  // Original untouched.
  const originalAfter = await Order.findById(original._id).lean();
  assert.strictEqual(originalAfter.status, 'delivered');
  assert.strictEqual(originalAfter.orderNumber, original.orderNumber);

  // Exactly one order.created, for the new order, to its warehouse.
  const created = emitted.filter((e) => e.event === 'order.created');
  assert.strictEqual(created.length, 1);
  assert.strictEqual(created[0].payload.orderId, newOrder._id.toString());
  assert.strictEqual(created[0].room, `warehouse:${ids.warehouse}`);
});

test('a failed checkout (unavailable product) emits no order.created', async () => {
  const paused = await makeProduct(ids.warehouse, { name: 'Paused2', price: 4, isAvailable: false });
  const original = await makeDeliveredOrder(ids.pharmacy, ids.warehouse, [
    { productId: paused._id, name: 'Paused2', quantity: 1 },
  ]);
  const prep = await orderService.prepareReorder(original._id.toString(), ids.pharmacy);

  await assert.rejects(
    () =>
      orderService.createOrder({
        userId: ids.pharmacyUser,
        pharmacyId: ids.pharmacy,
        warehouseId: String(prep.warehouse._id),
        items: prep.items.map((i) => ({ productId: String(i.product._id), quantity: i.quantity })),
      }),
    withCode('STOCK_CHECK_FAILED')
  );
  assert.deepStrictEqual(emitted.filter((e) => e.event === 'order.created'), []);
});
