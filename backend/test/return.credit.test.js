// Money-Flow V2 - a return is worth money now.
//
// V1 approved a return by creating a zero-priced replacement order and moving
// nothing: a pharmacy that handed goods back kept the full bill, and if the
// product could not be reshipped the approval failed outright. V2 credits the
// account instead, and the credited figure has to be deterministic, derived
// only from figures frozen on the original order, and explainable.
//
// The invariant these tests exist to protect: crediting every unit of an order
// back sums to EXACTLY that order's finalPrice - no rounding remainder left
// behind as phantom debt.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-return-credit-pa';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');

const { startMemoryMongo, stopMemoryMongo, syncIndexes } = require('./helpers/mongo');

const User = require('../src/models/user.model');
const Pharmacy = require('../src/models/pharmacy.model');
const Warehouse = require('../src/models/warehouse.model');
const Order = require('../src/models/order.model');
const OrderItem = require('../src/models/orderItem.model');
const Return = require('../src/models/return.model');
const ExchangeRate = require('../src/models/exchangeRate.model');
const LedgerAccount = require('../src/models/ledgerAccount.model');
const LedgerEntry = require('../src/models/ledgerEntry.model');
const FinancialAuditLog = require('../src/models/financialAuditLog.model');

const ledger = require('../src/services/ledger.service');
const warehouseReturnService = require('../src/services/warehouseReturn.service');
const { computeCredit } = require('../src/services/returnCredit.service');
const { runInTransaction } = require('../src/utils/transaction');

const RATE = 10000;
const ids = {};
let orderSeq = 95000;

function withCode(expected) {
  return (err) => {
    assert.strictEqual(err.code, expected, `expected ${expected}, got ${err.code}`);
    return true;
  };
}

// A delivered order with its charge already on the ledger, plus its line items.
// `lines` are [{ unitPrice, discountPrice, quantity }].
async function deliveredOrder(lines, { platformDiscountRate = 0, advertisementDiscountSyp = 0 } = {}) {
  const subtotal = lines.reduce((sum, l) => sum + l.discountPrice * l.quantity, 0);
  const platformDiscount = Math.round((subtotal * platformDiscountRate) / 100);
  const finalPrice = subtotal - platformDiscount - advertisementDiscountSyp;

  const order = await Order.create({
    orderNumber: (orderSeq += 1),
    pharmacyId: ids.pharmacy,
    warehouseId: ids.warehouse,
    status: 'delivered',
    totalPrice: subtotal,
    discountAmount: platformDiscount,
    advertisementDiscountAmount: advertisementDiscountSyp,
    commissionAmount: 0,
    finalPrice,
    finalAmountUsd: Math.round((finalPrice / RATE) * 100) / 100,
    fx: { rate: RATE, source: 'manual', rateAsOf: new Date() },
    invoiceNumber: orderSeq,
    deliveredAt: new Date(),
    statusHistory: [{ status: 'delivered', changedBy: ids.whUser, changedAt: new Date() }],
  });

  const items = await OrderItem.create(
    lines.map((l, index) => ({
      orderId: order._id,
      productId: new mongoose.Types.ObjectId(),
      productNameAr: `دواء ${index}`,
      productNameEn: `Drug ${index}`,
      manufacturerAr: 'شركة',
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discountPrice: l.discountPrice,
      savingsUsd: 0,
      savingsSyp: Math.max(0, (l.unitPrice - l.discountPrice) * l.quantity),
    }))
  );

  const account = await ledger.resolveAccount(ids.pharmacy, ids.warehouse);
  await runInTransaction((session) =>
    ledger.postEntry(
      {
        account,
        kind: 'charge',
        amountSyp: finalPrice,
        amountUsd: order.finalAmountUsd,
        fx: order.fx,
        source: { orderId: order._id },
      },
      session
    )
  );

  return { order, items, account };
}

function makeReturn(order, items, picks) {
  return Return.create({
    orderId: order._id,
    pharmacyId: ids.pharmacy,
    warehouseId: ids.warehouse,
    items: picks.map(({ index, quantity }) => ({
      orderItemId: items[index]._id,
      productId: items[index].productId,
      quantity,
      reasonType: 'damaged',
    })),
  });
}

test.before(async () => {
  await startMemoryMongo({ dbName: 'feniq-return-credit-test' });
  await syncIndexes(LedgerEntry, LedgerAccount, Return);
  await ExchangeRate.create({ _id: 'singleton', usdToSyp: RATE, source: 'manual' });

  const [phUser, whUser] = await User.create([
    { name: 'Ph', phone: '0931000301', role: 'pharmacy', status: 'active' },
    { name: 'WH', phone: '0941000301', role: 'warehouse', status: 'active' },
  ]);
  ids.whUser = whUser._id;

  const pharmacy = await Pharmacy.create({
    userId: phUser._id, nameAr: 'ص', nameEn: 'Pharmacy', ownerName: 'O',
    address: 'a', city: 'Latakia', phone: '0931000301', addedBy: 'self',
  });
  ids.pharmacy = pharmacy._id;

  const warehouse = await Warehouse.create({
    userId: whUser._id, nameAr: 'م', nameEn: 'Warehouse', address: 'r', city: 'Latakia',
    phone: '0941000301', deliveryType: 'self', isActive: true,
  });
  ids.warehouse = warehouse._id;
});

test.after(async () => {
  await stopMemoryMongo();
});

test.beforeEach(async () => {
  await Promise.all([
    Order.deleteMany({}),
    OrderItem.deleteMany({}),
    Return.deleteMany({}),
    LedgerEntry.deleteMany({}),
    LedgerAccount.deleteMany({}),
    FinancialAuditLog.deleteMany({}),
  ]);
});

// --- the valuation, as a pure function --------------------------------------

test('a partial return credits the line price less its share of the order discounts', () => {
  // The worked example from the V2 spec: two lines, 4% platform discount.
  //   line A 100,000 x 2, line B 50,000 x 4 -> subtotal 400,000
  //   platform discount 16,000 -> finalPrice 384,000
  //   return 1 x line A: gross 100,000, share of discount 4,000 -> credit 96,000
  const order = {
    _id: 'o1', orderNumber: 1, totalPrice: 400000, discountAmount: 16000,
    advertisementDiscountAmount: 0, finalPrice: 384000, fx: { rate: 12000 },
  };
  const items = [
    { _id: 'a', productId: 'pa', quantity: 2, discountPrice: 100000, productNameAr: 'A' },
    { _id: 'b', productId: 'pb', quantity: 4, discountPrice: 50000, productNameAr: 'B' },
  ];

  const { creditSyp, creditUsd, breakdown } = computeCredit({
    order, orderItems: items, returnItems: [{ orderItemId: 'a', quantity: 1 }],
  });

  assert.strictEqual(breakdown.returnedGrossSyp, 100000);
  assert.strictEqual(breakdown.reductionShareSyp, 4000);
  assert.strictEqual(creditSyp, 96000);
  assert.strictEqual(creditUsd, 8); // 96,000 / 12,000 - the ORDER's rate
  assert.strictEqual(breakdown.isFinalReturn, false);
});

test('returning every unit credits exactly the order final price', () => {
  const order = {
    _id: 'o1', orderNumber: 1, totalPrice: 400000, discountAmount: 16000,
    advertisementDiscountAmount: 0, finalPrice: 384000, fx: { rate: 12000 },
  };
  const items = [
    { _id: 'a', productId: 'pa', quantity: 2, discountPrice: 100000 },
    { _id: 'b', productId: 'pb', quantity: 4, discountPrice: 50000 },
  ];

  const { creditSyp, breakdown } = computeCredit({
    order,
    orderItems: items,
    returnItems: [
      { orderItemId: 'a', quantity: 2 },
      { orderItemId: 'b', quantity: 4 },
    ],
  });

  assert.strictEqual(breakdown.isFinalReturn, true);
  assert.strictEqual(creditSyp, 384000, 'exactly the finalPrice, no rounding remainder');
});

test('a full return over awkward numbers still lands exactly on finalPrice', () => {
  // Deliberately chosen so the proportional share does not divide evenly - the
  // isFinalReturn pin is what absorbs the remainder.
  const order = {
    _id: 'o1', orderNumber: 1, totalPrice: 333333, discountAmount: 13333,
    advertisementDiscountAmount: 7777, finalPrice: 312223, fx: { rate: 11111 },
  };
  const items = [
    { _id: 'a', productId: 'pa', quantity: 3, discountPrice: 77777 },
    { _id: 'b', productId: 'pb', quantity: 2, discountPrice: 50001 },
  ];

  const partial = computeCredit({
    order, orderItems: items, returnItems: [{ orderItemId: 'a', quantity: 1 }],
  });
  const full = computeCredit({
    order,
    orderItems: items,
    returnItems: [{ orderItemId: 'a', quantity: 3 }, { orderItemId: 'b', quantity: 2 }],
  });

  assert.ok(partial.creditSyp > 0 && partial.creditSyp < order.finalPrice);
  assert.strictEqual(full.creditSyp, 312223);
});

test('an advertisement package discount is prorated like the platform discount', () => {
  const order = {
    _id: 'o1', orderNumber: 1, totalPrice: 670000, discountAmount: 0,
    advertisementDiscountAmount: 270000, finalPrice: 400000, fx: { rate: 10000 },
  };
  const items = [
    { _id: 'a', productId: 'pa', quantity: 1, discountPrice: 300000 },
    { _id: 'b', productId: 'pb', quantity: 1, discountPrice: 250000 },
    { _id: 'c', productId: 'pc', quantity: 1, discountPrice: 120000 },
  ];

  const { creditSyp, breakdown } = computeCredit({
    order, orderItems: items, returnItems: [{ orderItemId: 'a', quantity: 1 }],
  });

  // 300,000 gross, share of the 270,000 package discount = 270000*300000/670000
  assert.strictEqual(breakdown.reductionShareSyp, Math.round((270000 * 300000) / 670000));
  assert.strictEqual(creditSyp, 300000 - breakdown.reductionShareSyp);
  assert.ok(creditSyp < 300000, 'the package benefit is not refunded on top');
});

test('the credit is never negative, even if the discounts exceed the line', () => {
  const order = {
    _id: 'o1', orderNumber: 1, totalPrice: 1000, discountAmount: 1000,
    advertisementDiscountAmount: 0, finalPrice: 0, fx: { rate: 10000 },
  };
  const items = [{ _id: 'a', productId: 'pa', quantity: 1, discountPrice: 1000 }];

  const { creditSyp } = computeCredit({
    order, orderItems: items, returnItems: [{ orderItemId: 'a', quantity: 1 }],
  });
  assert.strictEqual(creditSyp, 0);
});

test('an item that is not on the order is refused', () => {
  const order = {
    _id: 'o1', orderNumber: 1, totalPrice: 1000, discountAmount: 0,
    advertisementDiscountAmount: 0, finalPrice: 1000, fx: { rate: 10000 },
  };
  assert.throws(
    () => computeCredit({ order, orderItems: [], returnItems: [{ orderItemId: 'x', quantity: 1 }] }),
    withCode('RETURN_ITEM_NOT_ON_ORDER')
  );
});

// --- approval posts the credit ----------------------------------------------

test('approving a return credits the account and links the entry', async () => {
  const { order, items, account } = await deliveredOrder(
    [{ unitPrice: 100000, discountPrice: 100000, quantity: 2 }],
    { platformDiscountRate: 4 }
  );
  assert.strictEqual((await LedgerAccount.findById(account._id)).balanceCache.syp, 192000);

  const returnRequest = await makeReturn(order, items, [{ index: 0, quantity: 1 }]);
  const { returnRequest: approved, creditEntry } = await warehouseReturnService.approveReturn(
    returnRequest._id.toString(), ids.warehouse, ids.whUser
  );

  assert.strictEqual(approved.status, 'approved');
  assert.strictEqual(approved.creditSyp, 96000); // 100,000 less its 4,000 share
  assert.strictEqual(approved.creditUsd, 9.6);
  assert.ok(approved.creditEntryId, 'the return links to the credit entry');
  assert.ok(approved.creditValuation, 'the working is frozen onto the return');

  assert.strictEqual(creditEntry.kind, 'return_credit');
  assert.strictEqual(creditEntry.direction, 'credit');
  assert.strictEqual(creditEntry.fx.rate, RATE, 'valued at the ORDER rate');

  const balance = await LedgerAccount.findById(account._id);
  assert.strictEqual(balance.balanceCache.syp, 96000, '192,000 owed - 96,000 credited');
});

test('approving a full return brings a wholly-returned order to zero', async () => {
  const { order, items, account } = await deliveredOrder(
    [
      { unitPrice: 100000, discountPrice: 90000, quantity: 2 },
      { unitPrice: 50000, discountPrice: 50000, quantity: 3 },
    ],
    { platformDiscountRate: 4 }
  );
  const charged = (await Order.findById(order._id)).finalPrice;
  assert.strictEqual((await LedgerAccount.findById(account._id)).balanceCache.syp, charged);

  const returnRequest = await makeReturn(order, items, [
    { index: 0, quantity: 2 },
    { index: 1, quantity: 3 },
  ]);
  const { returnRequest: approved } = await warehouseReturnService.approveReturn(
    returnRequest._id.toString(), ids.warehouse, ids.whUser
  );

  assert.strictEqual(approved.creditSyp, charged);
  assert.strictEqual(
    (await LedgerAccount.findById(account._id)).balanceCache.syp,
    0,
    'the pharmacy owes nothing for goods it handed back'
  );
});

test('no replacement order is created any more', async () => {
  const { order, items } = await deliveredOrder([
    { unitPrice: 100000, discountPrice: 100000, quantity: 1 },
  ]);
  const ordersBefore = await Order.countDocuments();

  const returnRequest = await makeReturn(order, items, [{ index: 0, quantity: 1 }]);
  const { returnRequest: approved } = await warehouseReturnService.approveReturn(
    returnRequest._id.toString(), ids.warehouse, ids.whUser
  );

  assert.strictEqual(await Order.countDocuments(), ordersBefore, 'no new order was spun up');
  assert.strictEqual(approved.replacementOrderId, undefined, 'the field is gone from the model');
});

test('approval writes an audit record', async () => {
  const { order, items } = await deliveredOrder([
    { unitPrice: 100000, discountPrice: 100000, quantity: 1 },
  ]);
  const returnRequest = await makeReturn(order, items, [{ index: 0, quantity: 1 }]);
  await warehouseReturnService.approveReturn(returnRequest._id.toString(), ids.warehouse, ids.whUser);

  const audit = await FinancialAuditLog.findOne({ action: 'return.approved' }).lean();
  assert.strictEqual(String(audit.entityId), String(returnRequest._id));
  assert.strictEqual(audit.after.creditSyp, 100000);
  assert.strictEqual(audit.ledgerEntryIds.length, 1);
});

// --- preview ----------------------------------------------------------------

test('the preview reports the same figure approval would post, and creates nothing', async () => {
  const { order, items } = await deliveredOrder(
    [{ unitPrice: 100000, discountPrice: 100000, quantity: 2 }],
    { platformDiscountRate: 4 }
  );
  const returnRequest = await makeReturn(order, items, [{ index: 0, quantity: 1 }]);

  const preview = await warehouseReturnService.previewReturnCredit(
    returnRequest._id.toString(), ids.warehouse
  );
  assert.strictEqual(preview.creditSyp, 96000);
  assert.strictEqual(preview.alreadyResolved, false);
  assert.strictEqual(await LedgerEntry.countDocuments({ kind: 'return_credit' }), 0);

  const { returnRequest: approved } = await warehouseReturnService.approveReturn(
    returnRequest._id.toString(), ids.warehouse, ids.whUser
  );
  assert.strictEqual(approved.creditSyp, preview.creditSyp, 'preview and approval agree');
});

test('previewing an already-approved return reports what it actually credited', async () => {
  const { order, items } = await deliveredOrder([
    { unitPrice: 100000, discountPrice: 100000, quantity: 1 },
  ]);
  const returnRequest = await makeReturn(order, items, [{ index: 0, quantity: 1 }]);
  await warehouseReturnService.approveReturn(returnRequest._id.toString(), ids.warehouse, ids.whUser);

  const preview = await warehouseReturnService.previewReturnCredit(
    returnRequest._id.toString(), ids.warehouse
  );
  assert.strictEqual(preview.alreadyResolved, true);
  assert.strictEqual(preview.creditSyp, 100000);
});

// --- concurrency & conflicts ------------------------------------------------

test('two concurrent approvals produce one credit and one conflict', async () => {
  const { order, items, account } = await deliveredOrder([
    { unitPrice: 100000, discountPrice: 100000, quantity: 1 },
  ]);
  const returnRequest = await makeReturn(order, items, [{ index: 0, quantity: 1 }]);

  const attempt = () =>
    warehouseReturnService
      .approveReturn(returnRequest._id.toString(), ids.warehouse, ids.whUser)
      .then(() => 'ok')
      .catch((err) => err.code);

  const results = await Promise.all([attempt(), attempt()]);

  assert.strictEqual(results.filter((r) => r === 'ok').length, 1);
  assert.strictEqual(await LedgerEntry.countDocuments({ kind: 'return_credit' }), 1);
  assert.strictEqual((await LedgerAccount.findById(account._id)).balanceCache.syp, 0);
});

test('an approved return cannot then be rejected', async () => {
  const { order, items } = await deliveredOrder([
    { unitPrice: 100000, discountPrice: 100000, quantity: 1 },
  ]);
  const returnRequest = await makeReturn(order, items, [{ index: 0, quantity: 1 }]);
  await warehouseReturnService.approveReturn(returnRequest._id.toString(), ids.warehouse, ids.whUser);

  await assert.rejects(
    () =>
      warehouseReturnService.rejectReturn(
        returnRequest._id.toString(), ids.warehouse, ids.whUser, 'changed my mind'
      ),
    withCode('RETURN_NOT_FOUND')
  );
});

test('rejecting moves no money but is still audited with its reason', async () => {
  const { order, items, account } = await deliveredOrder([
    { unitPrice: 100000, discountPrice: 100000, quantity: 1 },
  ]);
  const returnRequest = await makeReturn(order, items, [{ index: 0, quantity: 1 }]);

  const rejected = await warehouseReturnService.rejectReturn(
    returnRequest._id.toString(), ids.warehouse, ids.whUser, 'goods show no damage'
  );

  assert.strictEqual(rejected.status, 'rejected');
  assert.strictEqual(await LedgerEntry.countDocuments({ kind: 'return_credit' }), 0);
  assert.strictEqual((await LedgerAccount.findById(account._id)).balanceCache.syp, 100000);

  const audit = await FinancialAuditLog.findOne({ action: 'return.rejected' }).lean();
  assert.strictEqual(audit.reason, 'goods show no damage');
});

test('a rejection with no reason is refused', async () => {
  const { order, items } = await deliveredOrder([
    { unitPrice: 100000, discountPrice: 100000, quantity: 1 },
  ]);
  const returnRequest = await makeReturn(order, items, [{ index: 0, quantity: 1 }]);

  await assert.rejects(
    () => warehouseReturnService.rejectReturn(returnRequest._id.toString(), ids.warehouse, ids.whUser, '  '),
    withCode('REJECTION_NOTE_REQUIRED')
  );
});

// --- integrity --------------------------------------------------------------

test('the balance cache still equals a replay after charge + credit', async () => {
  const { order, items, account } = await deliveredOrder(
    [{ unitPrice: 60000, discountPrice: 55000, quantity: 3 }],
    { platformDiscountRate: 4 }
  );
  const returnRequest = await makeReturn(order, items, [{ index: 0, quantity: 2 }]);
  await warehouseReturnService.approveReturn(returnRequest._id.toString(), ids.warehouse, ids.whUser);

  const check = await ledger.verifyAccount(account._id);
  assert.strictEqual(check.ok, true);
});

test('a credited return leaves the original order untouched', async () => {
  const { order, items } = await deliveredOrder([
    { unitPrice: 100000, discountPrice: 100000, quantity: 2 },
  ]);
  const before = await Order.findById(order._id).lean();

  const returnRequest = await makeReturn(order, items, [{ index: 0, quantity: 1 }]);
  await warehouseReturnService.approveReturn(returnRequest._id.toString(), ids.warehouse, ids.whUser);

  const after = await Order.findById(order._id).lean();
  assert.strictEqual(after.finalPrice, before.finalPrice, 'the invoice is immutable');
  assert.strictEqual(after.totalPrice, before.totalPrice);
  assert.strictEqual(after.status, 'delivered');
  assert.strictEqual(after.invoiceNumber, before.invoiceNumber);
});
