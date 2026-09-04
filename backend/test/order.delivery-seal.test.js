// Optional delivery seal photo - decided PER ORDER (order.requiresDeliverySealPhoto),
// seeded at creation from the warehouse's own default (warehouse.requireDeliverySealPhoto)
// and owned by the order from then on.
//
// Own database, dropped at the end; realtime / notification / balance are
// stubbed through require.cache exactly like order.status.test.js so advancing
// to 'delivered' needs no socket or FCM.
process.env.MONGODB_URI = 'mongodb://localhost:27017/phoenix-delivery-seal-test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-delivery-seal-tests';
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
stubModule('services/notification.service.js', {
  sendToUser: async () => {},
  sendToAll: async () => {},
});
stubModule('services/pharmacyBalance.service.js', {
  recomputeBalance: async () => {},
});

const User = require('../src/models/user.model');
const Pharmacy = require('../src/models/pharmacy.model');
const Warehouse = require('../src/models/warehouse.model');
const Product = require('../src/models/product.model');
const Order = require('../src/models/order.model');
const ExchangeRate = require('../src/models/exchangeRate.model');

const orderService = require('../src/services/order.service');
const warehouseOrderService = require('../src/services/warehouseOrder.service');
const warehouseSettingsService = require('../src/services/warehouseSettings.service');

function withCode(expected) {
  return (err) => {
    assert.strictEqual(err.code, expected, `expected error code ${expected}, got ${err.code}`);
    return true;
  };
}

const ids = {};
let orderSeq = 71000;

async function makeOrder(status, extra = {}) {
  return Order.create({
    orderNumber: (orderSeq += 1),
    pharmacyId: ids.pharmacy,
    warehouseId: ids.warehouse,
    status,
    totalPrice: 1000,
    discountAmount: 0,
    commissionAmount: 0,
    finalPrice: 1000,
    statusHistory: [{ status, changedBy: ids.pharmacyUser, changedAt: new Date() }],
    ...extra,
  });
}

// A real createOrder run - the only way to exercise the "seed from warehouse
// default" path. Uses one live product and today's rate.
function createRealOrder() {
  return orderService.createOrder({
    userId: ids.pharmacyUser,
    pharmacyId: ids.pharmacy,
    warehouseId: ids.warehouse,
    items: [{ productId: ids.product.toString(), quantity: 1 }],
    notes: null,
  });
}

async function setWarehouseDefault(value) {
  await Warehouse.updateOne({ _id: ids.warehouse }, { $set: { requireDeliverySealPhoto: value } });
}

test.before(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await ExchangeRate.create({ _id: 'singleton', usdToSyp: 10000, source: 'manual' });

  const [pharmacyUser, warehouseUser] = await User.create([
    { name: 'Pharm', phone: '0931222222', role: 'pharmacy', status: 'active' },
    { name: 'WH', phone: '0941222222', role: 'warehouse', status: 'active' },
  ]);
  ids.pharmacyUser = pharmacyUser._id;
  ids.warehouseUser = warehouseUser._id;

  const pharmacy = await Pharmacy.create({
    userId: pharmacyUser._id, nameAr: 'صيدلية', nameEn: 'Pharmacy', ownerName: 'Owner',
    address: 'a', city: 'Latakia', phone: '0931222222', addedBy: 'self',
  });
  const warehouse = await Warehouse.create({
    userId: warehouseUser._id, nameAr: 'مستودع', nameEn: 'Warehouse',
    address: 'r', city: 'Latakia', phone: '0941222222', deliveryType: 'self', isActive: true,
    discountRate: 0, commissionRate: 0,
  });
  ids.pharmacy = pharmacy._id;
  ids.warehouse = warehouse._id;

  const product = await Product.create({
    warehouseId: warehouse._id, nameAr: 'دواء', nameEn: 'Drug',
    manufacturerAr: 'شركة', manufacturerEn: 'Pharma', price: 10,
    unitAr: 'علبة', unitEn: 'box', isAvailable: true, isActive: true,
  });
  ids.product = product._id;
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test.beforeEach(async () => {
  emitted.length = 0;
  await setWarehouseDefault(false);
});

// --- Schema + warehouse default -----------------------------------------

test('Order.requiresDeliverySealPhoto defaults to false (pre-existing orders unaffected)', () => {
  assert.strictEqual(Order.schema.path('requiresDeliverySealPhoto').defaultValue, false);
});

test('the warehouse default is still toggleable through its own settings service', async () => {
  const updated = await warehouseSettingsService.updateOrderLimits(ids.warehouse, {
    requireDeliverySealPhoto: true,
  });
  assert.strictEqual(updated.requireDeliverySealPhoto, true);
});

// --- Seeding at order creation -----------------------------------------

test('a new order inherits requiresDeliverySealPhoto=true when the warehouse default is on', async () => {
  await setWarehouseDefault(true);
  const order = await createRealOrder();
  assert.strictEqual(order.requiresDeliverySealPhoto, true);
});

test('a new order inherits requiresDeliverySealPhoto=false when the warehouse default is off', async () => {
  await setWarehouseDefault(false);
  const order = await createRealOrder();
  assert.strictEqual(order.requiresDeliverySealPhoto, false);
});

test('changing the warehouse default AFTER an order is created never touches that order', async () => {
  await setWarehouseDefault(true);
  const order = await createRealOrder();
  assert.strictEqual(order.requiresDeliverySealPhoto, true);

  await setWarehouseDefault(false);

  const reloaded = await Order.findById(order._id);
  assert.strictEqual(reloaded.requiresDeliverySealPhoto, true);
});

// --- The delivery gate (reads order.requiresDeliverySealPhoto) ----------

test('order NOT requiring a seal photo advances to delivered exactly as before', async () => {
  const order = await makeOrder('out_for_delivery', { requiresDeliverySealPhoto: false });
  const updated = await warehouseOrderService.advanceOrderStatus(
    order._id.toString(), ids.warehouse, ids.warehouseUser
  );
  assert.strictEqual(updated.status, 'delivered');
  assert.strictEqual(emitted.length, 1);
});

test('order requiring a seal photo, with none uploaded, is blocked from delivered', async () => {
  const order = await makeOrder('out_for_delivery', { requiresDeliverySealPhoto: true });

  await assert.rejects(
    () => warehouseOrderService.advanceOrderStatus(order._id.toString(), ids.warehouse, ids.warehouseUser),
    withCode('DELIVERY_SEAL_PHOTO_REQUIRED')
  );

  assert.strictEqual((await Order.findById(order._id)).status, 'out_for_delivery');
  assert.deepStrictEqual(emitted, []);
});

test('order requiring a seal photo, with one uploaded, advances to delivered', async () => {
  const order = await makeOrder('out_for_delivery', {
    requiresDeliverySealPhoto: true,
    deliverySealPhoto: 'https://res.cloudinary.com/demo/image/upload/v1/delivery-seals/x.jpg',
    deliverySealConfirmedAt: new Date(),
  });
  const updated = await warehouseOrderService.advanceOrderStatus(
    order._id.toString(), ids.warehouse, ids.warehouseUser
  );
  assert.strictEqual(updated.status, 'delivered');
});

test('requiring a seal photo does not affect the earlier transitions', async () => {
  const order = await makeOrder('pending', { requiresDeliverySealPhoto: true });
  for (const expected of ['confirmed', 'preparing', 'out_for_delivery']) {
    const updated = await warehouseOrderService.advanceOrderStatus(
      order._id.toString(), ids.warehouse, ids.warehouseUser
    );
    assert.strictEqual(updated.status, expected);
  }
});

// --- The per-order toggle (warehouseOrder.service.setDeliverySealRequirement)

test('the warehouse flips one order\'s requirement without touching anything else', async () => {
  const order = await makeOrder('preparing', { requiresDeliverySealPhoto: false });

  const on = await warehouseOrderService.setDeliverySealRequirement(
    order._id.toString(), ids.warehouse, true
  );
  assert.strictEqual(on.requiresDeliverySealPhoto, true);
  assert.strictEqual(on.status, 'preparing');

  const off = await warehouseOrderService.setDeliverySealRequirement(
    order._id.toString(), ids.warehouse, false
  );
  assert.strictEqual(off.requiresDeliverySealPhoto, false);
});

test('setDeliverySealRequirement is scoped to the owning warehouse (IDOR)', async () => {
  const order = await makeOrder('out_for_delivery');
  const otherWarehouseId = new mongoose.Types.ObjectId();
  await assert.rejects(
    () => warehouseOrderService.setDeliverySealRequirement(order._id.toString(), otherWarehouseId, true),
    withCode('ORDER_NOT_FOUND')
  );
});

test('setDeliverySealRequirement is locked once the order is delivered or cancelled', async () => {
  for (const status of ['delivered', 'cancelled']) {
    const order = await makeOrder(status);
    await assert.rejects(
      () => warehouseOrderService.setDeliverySealRequirement(order._id.toString(), ids.warehouse, true),
      withCode('ORDER_SEAL_REQUIREMENT_LOCKED')
    );
  }
});

// --- attachDeliverySealPhoto (unchanged - pharmacy-side confirm) --------

const SEAL_URL = 'https://res.cloudinary.com/demo/image/upload/v1/delivery-seals/seal.jpg';

test('attachDeliverySealPhoto records the photo + timestamp and never changes the status', async () => {
  const order = await makeOrder('out_for_delivery', { requiresDeliverySealPhoto: true });
  const before = Date.now();

  const { order: updated } = await orderService.attachDeliverySealPhoto(
    order._id.toString(), ids.pharmacy, SEAL_URL
  );

  assert.strictEqual(updated.status, 'out_for_delivery');
  assert.strictEqual(updated.deliverySealPhoto, SEAL_URL);
  assert.ok(updated.deliverySealConfirmedAt.getTime() >= before);
});

test('attachDeliverySealPhoto rejects an order that is not out for delivery', async () => {
  for (const status of ['pending', 'confirmed', 'preparing', 'delivered']) {
    const order = await makeOrder(status);
    await assert.rejects(
      () => orderService.attachDeliverySealPhoto(order._id.toString(), ids.pharmacy, SEAL_URL),
      withCode('ORDER_NOT_AWAITING_DELIVERY')
    );
  }
});

test('attachDeliverySealPhoto is scoped to the owning pharmacy (IDOR)', async () => {
  const order = await makeOrder('out_for_delivery');
  const otherPharmacyId = new mongoose.Types.ObjectId();
  await assert.rejects(
    () => orderService.attachDeliverySealPhoto(order._id.toString(), otherPharmacyId, SEAL_URL),
    withCode('ORDER_NOT_FOUND')
  );
  assert.strictEqual((await Order.findById(order._id)).deliverySealPhoto, null);
});
