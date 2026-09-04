// Return requests - the "photo is optional" rule (Section 6.9), at the
// service layer.
//
// Runs against its own database (phoenix-return-test) and drops it at the
// end, same pattern as complaint.test.js / readpath.lean.test.js. The
// realtime layer is left as-is: emitToWarehouse tolerates a null io (no
// socket server booted here) and simply no-ops.
process.env.MONGODB_URI = 'mongodb://localhost:27017/phoenix-return-test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-return-tests';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');

const User = require('../src/models/user.model');
const Pharmacy = require('../src/models/pharmacy.model');
const Warehouse = require('../src/models/warehouse.model');
const Order = require('../src/models/order.model');
const OrderItem = require('../src/models/orderItem.model');
const Return = require('../src/models/return.model');

const returnService = require('../src/services/return.service');

const ids = {};
let orderSeq = 96000;

// The service raises ApiError with a stable `code`; assert.rejects matches on
// `message` by default, so assert the code explicitly instead.
function withCode(expected) {
  return (err) => {
    assert.strictEqual(err.code, expected, `expected error code ${expected}, got ${err.code}`);
    return true;
  };
}

// A fresh delivered order (inside the return window) plus its two line items,
// so each test owns an order that has never had a return attached.
async function makeDeliveredOrder() {
  const order = await Order.create({
    orderNumber: (orderSeq += 1),
    pharmacyId: ids.pharmacy,
    warehouseId: ids.warehouse,
    status: 'delivered',
    totalPrice: 1000,
    discountAmount: 0,
    commissionAmount: 0,
    finalPrice: 1000,
    statusHistory: [{ status: 'delivered', changedBy: ids.pharmacyUser, changedAt: new Date() }],
  });
  const [itemA, itemB] = await OrderItem.create([
    {
      orderId: order._id,
      productId: new mongoose.Types.ObjectId(),
      productNameAr: 'دواء أ',
      productNameEn: 'Drug A',
      manufacturerAr: 'شركة',
      quantity: 5,
      unitPrice: 100,
      discountPrice: 100,
    },
    {
      orderId: order._id,
      productId: new mongoose.Types.ObjectId(),
      productNameAr: 'دواء ب',
      productNameEn: 'Drug B',
      manufacturerAr: 'شركة',
      quantity: 3,
      unitPrice: 200,
      discountPrice: 200,
    },
  ]);
  return { order, itemA, itemB };
}

test.before(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  await mongoose.connection.dropDatabase();

  const [phUser, whUser] = await User.create([
    { name: 'Pharm', phone: '0940000001', role: 'pharmacy', status: 'active' },
    { name: 'WH', phone: '0940000002', role: 'warehouse', status: 'active' },
  ]);
  ids.pharmacyUser = phUser._id;

  const pharmacy = await Pharmacy.create({
    userId: phUser._id, nameAr: 'صيدلية', nameEn: 'Pharmacy', ownerName: 'Owner',
    address: 'addr', city: 'Latakia', phone: '0940000001', addedBy: 'self',
  });
  ids.pharmacy = pharmacy._id;

  const warehouse = await Warehouse.create({
    userId: whUser._id, nameAr: 'مستودع', nameEn: 'Warehouse',
    address: 'addr', city: 'Latakia', phone: '0940000002', isActive: true,
  });
  ids.warehouse = warehouse._id;
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

// ---------------------------------------------------------------------------
// Section 6.9: the photo is optional
// ---------------------------------------------------------------------------

test('createReturn with NO images succeeds and stores an empty images array', async () => {
  const { order, itemA } = await makeDeliveredOrder();

  const { returnRequest } = await returnService.createReturn({
    pharmacyId: ids.pharmacy,
    orderId: order._id.toString(),
    items: [{ orderItemId: itemA._id.toString(), quantity: 2, reasonType: 'damaged' }],
    notes: 'box arrived crushed',
  });

  assert.strictEqual(returnRequest.status, 'pending');
  assert.deepStrictEqual(returnRequest.images, [], 'no photos -> empty array, not an error');
  assert.strictEqual(returnRequest.notes, 'box arrived crushed');

  const stored = await Return.findById(returnRequest._id).lean();
  assert.deepStrictEqual(stored.images, []);
});

test('createReturn with images still works exactly as before', async () => {
  const { order, itemA, itemB } = await makeDeliveredOrder();
  const photos = [
    'https://res.cloudinary.com/demo/image/upload/returns/a.jpg',
    'https://res.cloudinary.com/demo/image/upload/returns/b.jpg',
  ];

  const { returnRequest } = await returnService.createReturn({
    pharmacyId: ids.pharmacy,
    orderId: order._id.toString(),
    items: [
      { orderItemId: itemA._id.toString(), quantity: 1, reasonType: 'wrong_item' },
      { orderItemId: itemB._id.toString(), quantity: 3, reasonType: 'other', customReason: 'expired' },
    ],
    notes: null,
    images: photos,
  });

  assert.deepStrictEqual(returnRequest.images, photos, 'the attached photo URLs are persisted unchanged');
  assert.strictEqual(returnRequest.items.length, 2);
});

test('createReturn with an empty images array is accepted (same as omitting it)', async () => {
  const { order, itemA } = await makeDeliveredOrder();

  const { returnRequest } = await returnService.createReturn({
    pharmacyId: ids.pharmacy,
    orderId: order._id.toString(),
    items: [{ orderItemId: itemA._id.toString(), quantity: 1, reasonType: 'damaged' }],
    images: [],
  });

  assert.deepStrictEqual(returnRequest.images, []);
});

test('a photo-less return can still be edited without being forced to add one', async () => {
  const { order, itemA, itemB } = await makeDeliveredOrder();
  const { returnRequest } = await returnService.createReturn({
    pharmacyId: ids.pharmacy,
    orderId: order._id.toString(),
    items: [{ orderItemId: itemA._id.toString(), quantity: 1, reasonType: 'damaged' }],
  });

  const { returnRequest: updated } = await returnService.updateReturn({
    pharmacyId: ids.pharmacy,
    returnId: returnRequest._id.toString(),
    items: [{ orderItemId: itemB._id.toString(), quantity: 2, reasonType: 'wrong_item' }],
    notes: 'actually it was the other item',
    keepImageUrls: [],
    newImages: [],
  });

  assert.deepStrictEqual(updated.images, [], 'still no photos, still no error');
  assert.strictEqual(updated.items[0].orderItemId.toString(), itemB._id.toString());
});

test('the other return rules are untouched: non-delivered order is still refused', async () => {
  const order = await Order.create({
    orderNumber: (orderSeq += 1),
    pharmacyId: ids.pharmacy,
    warehouseId: ids.warehouse,
    status: 'preparing',
    totalPrice: 10, discountAmount: 0, commissionAmount: 0, finalPrice: 10,
    statusHistory: [],
  });
  const item = await OrderItem.create({
    orderId: order._id, productId: new mongoose.Types.ObjectId(),
    productNameAr: 'دواء', manufacturerAr: 'شركة', quantity: 1, unitPrice: 10, discountPrice: 10,
  });

  await assert.rejects(
    () =>
      returnService.createReturn({
        pharmacyId: ids.pharmacy,
        orderId: order._id.toString(),
        items: [{ orderItemId: item._id.toString(), quantity: 1, reasonType: 'damaged' }],
      }),
    withCode('ORDER_NOT_DELIVERED')
  );
});

test('the other return rules are untouched: an empty items list is still refused', async () => {
  const { order } = await makeDeliveredOrder();

  await assert.rejects(
    () =>
      returnService.createReturn({
        pharmacyId: ids.pharmacy,
        orderId: order._id.toString(),
        items: [],
      }),
    withCode('RETURN_ITEMS_EMPTY')
  );
});
