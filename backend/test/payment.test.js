// Manual payment recording (Section 16) after the 5-minute edit window was
// removed: a warehouse can correct or delete any payment it owns at any time,
// regardless of how old the payment is. The only remaining gates are the
// existing ones - ownership (IDOR) and amount/currency validation.
//
// Own database, dropped at the end - same pattern as projection.select.test.js.
process.env.MONGODB_URI = 'mongodb://localhost:27017/phoenix-payment-test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-payment-tests';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');

const User = require('../src/models/user.model');
const Pharmacy = require('../src/models/pharmacy.model');
const Warehouse = require('../src/models/warehouse.model');
const Order = require('../src/models/order.model');
const Payment = require('../src/models/payment.model');
const ExchangeRate = require('../src/models/exchangeRate.model');
const PharmacyBalance = require('../src/models/pharmacyBalance.model');

const paymentService = require('../src/services/payment.service');
const paymentViewModel = require('../src/viewmodels/payment.viewmodel');

function withCode(expected) {
  return (err) => {
    assert.strictEqual(err.code, expected, `expected error code ${expected}, got ${err.code}`);
    return true;
  };
}

const ids = {};

async function backdate(paymentId, ageMs) {
  // Raw write so nothing (timestamps middleware included) resets createdAt.
  await Payment.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(paymentId) },
    { $set: { createdAt: new Date(Date.now() - ageMs) } }
  );
}

test.before(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  await mongoose.connection.dropDatabase();

  await ExchangeRate.create({ _id: 'singleton', usdToSyp: 10000, source: 'manual' });

  const [whUser, otherWhUser] = await User.create([
    { name: 'WH', phone: '0942000101', role: 'warehouse', status: 'active' },
    { name: 'WH2', phone: '0942000102', role: 'warehouse', status: 'active' },
  ]);
  ids.whUser = whUser._id;
  const pharmacyUser = await User.create({ name: 'Ph', phone: '0932000101', role: 'pharmacy', status: 'active' });

  const pharmacy = await Pharmacy.create({
    userId: pharmacyUser._id, nameAr: 'ص', nameEn: 'Pharmacy', ownerName: 'O',
    address: 'a', city: 'Latakia', phone: '0932000101', addedBy: 'self',
  });
  const [warehouse, otherWarehouse] = await Warehouse.create([
    { userId: whUser._id, nameAr: 'م', nameEn: 'Warehouse', address: 'r', city: 'Latakia', phone: '0942000101', deliveryType: 'self', isActive: true },
    { userId: otherWhUser._id, nameAr: 'م2', nameEn: 'Warehouse 2', address: 'r', city: 'Latakia', phone: '0942000102', deliveryType: 'self', isActive: true },
  ]);
  ids.pharmacy = pharmacy._id;
  ids.warehouse = warehouse._id;
  ids.otherWarehouse = otherWarehouse._id;

  // One delivered order => the pharmacy owes 10 USD (100,000 SYP / 10,000).
  await Order.create({
    orderNumber: 90001, pharmacyId: pharmacy._id, warehouseId: warehouse._id, status: 'delivered',
    totalPrice: 100000, discountAmount: 0, commissionAmount: 0, finalPrice: 100000, statusHistory: [],
  });
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test.beforeEach(async () => {
  await Payment.deleteMany({});
});

// --- Recording ----------------------------------------------------------

test('createPayment records the payment and the serialized shape has no edit-window fields', async () => {
  const payment = await paymentService.createPayment(ids.warehouse, ids.whUser, {
    pharmacyId: ids.pharmacy.toString(),
    amount: 4,
    currency: 'USD',
    note: 'cash',
  });

  assert.strictEqual(payment.amount, 4);
  assert.strictEqual(payment.canEditUntil, undefined, 'canEditUntil is no longer stored');

  const serialized = paymentViewModel.serializePayment(payment);
  assert.ok(!('canEdit' in serialized), 'no canEdit flag in the API shape');
  assert.ok(!('canEditUntil' in serialized), 'no canEditUntil in the API shape');

  const balance = await PharmacyBalance.findOne({ pharmacyId: ids.pharmacy, warehouseId: ids.warehouse });
  assert.strictEqual(balance.balanceUsd, 6); // 10 owed - 4 paid
});

test('createPayment still rejects a non-positive amount and an unknown currency', async () => {
  const base = { pharmacyId: ids.pharmacy.toString(), currency: 'USD' };
  await assert.rejects(
    () => paymentService.createPayment(ids.warehouse, ids.whUser, { ...base, amount: 0 }),
    withCode('INVALID_PAYMENT_AMOUNT')
  );
  await assert.rejects(
    () => paymentService.createPayment(ids.warehouse, ids.whUser, { ...base, amount: -5 }),
    withCode('INVALID_PAYMENT_AMOUNT')
  );
  await assert.rejects(
    () => paymentService.createPayment(ids.warehouse, ids.whUser, { pharmacyId: ids.pharmacy.toString(), amount: 5, currency: 'EUR' }),
    withCode('INVALID_PAYMENT_CURRENCY')
  );
});

test('a payment recorded without an explicit currency defaults to SYP', async () => {
  const payment = await paymentService.createPayment(ids.warehouse, ids.whUser, {
    pharmacyId: ids.pharmacy.toString(),
    amount: 50000,
  });
  assert.strictEqual(payment.currency, 'SYP');

  // An update that omits currency also keeps SYP as the default.
  const updated = await paymentService.updatePayment(payment._id.toString(), ids.warehouse, {
    amount: 60000,
  });
  assert.strictEqual(updated.currency, 'SYP');

  // USD stays fully supported when explicitly chosen.
  const usdPayment = await paymentService.createPayment(ids.warehouse, ids.whUser, {
    pharmacyId: ids.pharmacy.toString(),
    amount: 3,
    currency: 'USD',
  });
  assert.strictEqual(usdPayment.currency, 'USD');
});

// --- Editing / deleting at ANY age (the removed 5-minute window) -------

test('updatePayment succeeds on a payment recorded well over 5 minutes ago', async () => {
  const payment = await paymentService.createPayment(ids.warehouse, ids.whUser, {
    pharmacyId: ids.pharmacy.toString(), amount: 3, currency: 'USD',
  });
  await backdate(payment._id.toString(), 6 * 60 * 1000); // 6 minutes old

  const updated = await paymentService.updatePayment(payment._id.toString(), ids.warehouse, {
    amount: 7, currency: 'USD', note: 'corrected',
  });
  assert.strictEqual(updated.amount, 7);

  const balance = await PharmacyBalance.findOne({ pharmacyId: ids.pharmacy, warehouseId: ids.warehouse });
  assert.strictEqual(balance.balanceUsd, 3); // 10 - 7
});

test('updatePayment succeeds on a payment recorded 10 days ago', async () => {
  const payment = await paymentService.createPayment(ids.warehouse, ids.whUser, {
    pharmacyId: ids.pharmacy.toString(), amount: 2, currency: 'USD',
  });
  await backdate(payment._id.toString(), 10 * 24 * 60 * 60 * 1000);

  const updated = await paymentService.updatePayment(payment._id.toString(), ids.warehouse, {
    amount: 9, currency: 'USD',
  });
  assert.strictEqual(updated.amount, 9);
});

test('deletePayment succeeds on a payment recorded 3 weeks ago', async () => {
  const payment = await paymentService.createPayment(ids.warehouse, ids.whUser, {
    pharmacyId: ids.pharmacy.toString(), amount: 5, currency: 'USD',
  });
  await backdate(payment._id.toString(), 21 * 24 * 60 * 60 * 1000);

  await paymentService.deletePayment(payment._id.toString(), ids.warehouse);
  assert.strictEqual(await Payment.countDocuments(), 0);

  const balance = await PharmacyBalance.findOne({ pharmacyId: ids.pharmacy, warehouseId: ids.warehouse });
  assert.strictEqual(balance.balanceUsd, 10); // back to the full debt
});

// --- Ownership still enforced (unchanged) -----------------------------

test('a warehouse cannot edit or delete another warehouse payment (IDOR unchanged)', async () => {
  const payment = await paymentService.createPayment(ids.warehouse, ids.whUser, {
    pharmacyId: ids.pharmacy.toString(), amount: 5, currency: 'USD',
  });
  await backdate(payment._id.toString(), 60 * 60 * 1000);

  await assert.rejects(
    () => paymentService.updatePayment(payment._id.toString(), ids.otherWarehouse, { amount: 1, currency: 'USD' }),
    withCode('PAYMENT_NOT_FOUND')
  );
  await assert.rejects(
    () => paymentService.deletePayment(payment._id.toString(), ids.otherWarehouse),
    withCode('PAYMENT_NOT_FOUND')
  );
});

// --- Overpayment still allowed (existing "credit" behavior, unchanged) -

test('a payment larger than the outstanding balance is still accepted and becomes a credit', async () => {
  await paymentService.createPayment(ids.warehouse, ids.whUser, {
    pharmacyId: ids.pharmacy.toString(), amount: 25, currency: 'USD', // owes 10
  });
  const balance = await PharmacyBalance.findOne({ pharmacyId: ids.pharmacy, warehouseId: ids.warehouse });
  assert.strictEqual(balance.balanceUsd, -15); // paid ahead => negative == credit
});
