// Warehouse "Invoices" list (formerly "Debts"): the listing now shows EVERY
// pharmacy that has purchased from this warehouse - not only the ones with an
// outstanding balance. The per-pharmacy detail, the balance calculation and
// the payment flow are all unchanged.
//
// Own database, dropped at the end - same pattern as payment.test.js.
process.env.MONGODB_URI = 'mongodb://localhost:27017/phoenix-invoices-test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-invoices-tests';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');

const User = require('../src/models/user.model');
const Pharmacy = require('../src/models/pharmacy.model');
const Warehouse = require('../src/models/warehouse.model');
const Order = require('../src/models/order.model');
const ExchangeRate = require('../src/models/exchangeRate.model');
const PharmacyBalance = require('../src/models/pharmacyBalance.model');

const balanceService = require('../src/services/pharmacyBalance.service');
const balanceViewModel = require('../src/viewmodels/pharmacyBalance.viewmodel');
const paymentService = require('../src/services/payment.service');

const ids = {};
let orderSeq = 80000;

async function makePharmacy(key, name, phone) {
  const user = await User.create({ name, phone, role: 'pharmacy', status: 'active' });
  const pharmacy = await Pharmacy.create({
    userId: user._id, nameAr: name, nameEn: name, ownerName: name,
    address: 'a', city: 'Latakia', phone, addedBy: 'self',
  });
  ids[key] = pharmacy._id;
  return pharmacy;
}

// A delivered order + a balance recompute, i.e. exactly what the app does when
// an order reaches 'delivered' (warehouseOrder.service.js).
async function deliverOrder(pharmacyId, warehouseId, finalPriceSyp) {
  await Order.create({
    orderNumber: ++orderSeq, pharmacyId, warehouseId, status: 'delivered',
    totalPrice: finalPriceSyp, discountAmount: 0, commissionAmount: 0, finalPrice: finalPriceSyp,
    statusHistory: [{ status: 'delivered', changedBy: ids.whUser, changedAt: new Date() }],
  });
  await balanceService.recomputeBalance(pharmacyId, warehouseId);
}

test.before(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await ExchangeRate.create({ _id: 'singleton', usdToSyp: 10000, source: 'manual' });

  const [whUser, otherWhUser] = await User.create([
    { name: 'WH', phone: '0942000301', role: 'warehouse', status: 'active' },
    { name: 'WH2', phone: '0942000302', role: 'warehouse', status: 'active' },
  ]);
  ids.whUser = whUser._id;
  const [warehouse, otherWarehouse] = await Warehouse.create([
    { userId: whUser._id, nameAr: 'م', nameEn: 'Warehouse', address: 'r', city: 'Latakia', phone: '0942000301', deliveryType: 'self', isActive: true },
    { userId: otherWhUser._id, nameAr: 'م2', nameEn: 'Warehouse 2', address: 'r', city: 'Latakia', phone: '0942000302', deliveryType: 'self', isActive: true },
  ]);
  ids.warehouse = warehouse._id;
  ids.otherWarehouse = otherWarehouse._id;

  await makePharmacy('inDebt', 'Pharmacy In Debt', '0932000301');
  await makePharmacy('paidOff', 'Pharmacy Paid Off', '0932000302');
  await makePharmacy('multiOrder', 'Pharmacy Multi Order', '0932000303');
  await makePharmacy('neverBought', 'Pharmacy Never Bought', '0932000304');
  await makePharmacy('otherWhOnly', 'Pharmacy Other Warehouse', '0932000305');
  await makePharmacy('credit', 'Pharmacy Credit', '0932000306');
  await makePharmacy('orphan', 'Pharmacy No Balance Row', '0932000307');
  await makePharmacy('pendingOnly', 'Pharmacy Pending Only', '0932000308');

  // inDebt: one 150,000 SYP delivered order, no payment -> balance 15 USD.
  await deliverOrder(ids.inDebt, ids.warehouse, 150000);

  // paidOff: one 100,000 SYP delivered order, then pays it fully -> balance 0.
  await deliverOrder(ids.paidOff, ids.warehouse, 100000);
  await paymentService.createPayment(ids.warehouse, ids.whUser, {
    pharmacyId: ids.paidOff.toString(), amount: 10, currency: 'USD',
  });

  // multiOrder: three delivered orders -> still ONE balance row.
  await deliverOrder(ids.multiOrder, ids.warehouse, 30000);
  await deliverOrder(ids.multiOrder, ids.warehouse, 20000);
  await deliverOrder(ids.multiOrder, ids.warehouse, 10000);

  // credit: owes 5 USD (50,000 SYP), pays 8 -> balance -3 (paid ahead).
  await deliverOrder(ids.credit, ids.warehouse, 50000);
  await paymentService.createPayment(ids.warehouse, ids.whUser, {
    pharmacyId: ids.credit.toString(), amount: 8, currency: 'USD',
  });

  // orphan: a delivered order, but its PharmacyBalance row is then removed -
  // the "purchased, no balance record" anomaly. Must still appear, with 0.
  await deliverOrder(ids.orphan, ids.warehouse, 40000);
  await PharmacyBalance.deleteOne({ pharmacyId: ids.orphan, warehouseId: ids.warehouse });

  // otherWhOnly: buys only from the OTHER warehouse.
  await deliverOrder(ids.otherWhOnly, ids.otherWarehouse, 50000);

  // pendingOnly: has an order here, but it never reached 'delivered'.
  await Order.create({
    orderNumber: ++orderSeq, pharmacyId: ids.pendingOnly, warehouseId: ids.warehouse, status: 'pending',
    totalPrice: 99999, discountAmount: 0, commissionAmount: 0, finalPrice: 99999, statusHistory: [],
  });

  // neverBought: no orders anywhere.
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

async function invoiceList(after = null) {
  const { rows, hasMore, nextCursor } = await balanceService.listPaginatedDebtorsForWarehouse(
    ids.warehouse,
    { limit: 50, after }
  );
  return { list: balanceViewModel.toDebtorListResponse(rows).pharmacies, hasMore, nextCursor };
}

test('a pharmacy with an unpaid balance appears', async () => {
  const { list } = await invoiceList();
  const row = list.find((p) => String(p.pharmacyId) === String(ids.inDebt));
  assert.ok(row, 'in-debt pharmacy is listed');
  assert.strictEqual(row.balanceUsd, 15);
});

test('a pharmacy with a ZERO balance but past purchases still appears', async () => {
  const { list } = await invoiceList();
  const row = list.find((p) => String(p.pharmacyId) === String(ids.paidOff));
  assert.ok(row, 'fully-paid pharmacy is still listed');
  assert.strictEqual(row.balanceUsd, 0);
  assert.strictEqual(row.totalOrdersUsd, 10);
  assert.strictEqual(row.totalPaidUsd, 10);
});

test('a pharmacy with a credit (negative) balance appears with the actual value', async () => {
  const { list } = await invoiceList();
  const row = list.find((p) => String(p.pharmacyId) === String(ids.credit));
  assert.ok(row, 'credit-balance pharmacy is listed');
  assert.strictEqual(row.balanceUsd, -3); // owed 5, paid 8
});

test('a pharmacy with purchases but NO PharmacyBalance record appears with 0', async () => {
  // The row was deleted after delivery - the list must not lose the pharmacy,
  // and must not recreate the record.
  assert.strictEqual(
    await PharmacyBalance.countDocuments({ pharmacyId: ids.orphan, warehouseId: ids.warehouse }),
    0
  );

  const { list } = await invoiceList();
  const row = list.find((p) => String(p.pharmacyId) === String(ids.orphan));
  assert.ok(row, 'no-balance-row pharmacy is still listed');
  assert.strictEqual(row.balanceUsd, 0);
  assert.strictEqual(row.totalOrdersUsd, 0);
  assert.strictEqual(row.totalPaidUsd, 0);

  // Still not persisted.
  assert.strictEqual(
    await PharmacyBalance.countDocuments({ pharmacyId: ids.orphan, warehouseId: ids.warehouse }),
    0
  );
});

test('a pharmacy with multiple orders appears exactly once', async () => {
  const { list } = await invoiceList();
  const matches = list.filter((p) => String(p.pharmacyId) === String(ids.multiOrder));
  assert.strictEqual(matches.length, 1);
  assert.strictEqual(matches[0].balanceUsd, 6); // (30k+20k+10k)/10000
});

test('a pharmacy that never purchased (or only has a pending order) does NOT appear', async () => {
  const { list } = await invoiceList();
  const listedIds = list.map((p) => String(p.pharmacyId));
  assert.ok(!listedIds.includes(String(ids.neverBought)), 'never-bought pharmacy excluded');
  assert.ok(!listedIds.includes(String(ids.otherWhOnly)), 'other-warehouse-only pharmacy excluded');
  assert.ok(!listedIds.includes(String(ids.pendingOnly)), 'pending-only (no delivered order) pharmacy excluded');
});

test('the list contains exactly the five pharmacies with a delivered purchase', async () => {
  const { list } = await invoiceList();
  const got = list.map((p) => String(p.pharmacyId)).sort();
  const want = [ids.inDebt, ids.paidOff, ids.multiOrder, ids.credit, ids.orphan].map(String).sort();
  assert.deepStrictEqual(got, want);
});

test('cursor pagination walks the whole list once, no repeats, no gaps', async () => {
  const seen = [];
  let cursor = null;
  for (let i = 0; i < 20; i += 1) {
    const { rows, hasMore, nextCursor } = await balanceService.listPaginatedDebtorsForWarehouse(
      ids.warehouse,
      { limit: 2, after: cursor }
    );
    seen.push(...rows.map((r) => String(r.balance.pharmacyId)));
    if (!hasMore) break;
    cursor = JSON.parse(nextCursor);
  }
  assert.strictEqual(seen.length, 5);
  assert.strictEqual(new Set(seen).size, 5);
  // Sorted by balance descending: 15, 6, 0, 0, -3.
  const { list } = await invoiceList();
  const balances = list.map((p) => p.balanceUsd);
  assert.deepStrictEqual([...balances].sort((a, b) => b - a), balances);
});

// --- The detail view + financial logic are untouched --------------------

test('clicking a pharmacy opens the same detail (orders + payments + balance)', async () => {
  const detail = await balanceService.getBalanceDetail(ids.paidOff, ids.warehouse);
  const response = balanceViewModel.toBalanceDetailResponse(detail, 'warehouse');

  assert.strictEqual(response.balanceUsd, 0);
  assert.strictEqual(response.totalOrdersUsd, 10);
  assert.strictEqual(response.totalPaidUsd, 10);
  assert.strictEqual(response.orders.length, 1);
  assert.strictEqual(response.payments.length, 1);
  assert.strictEqual(response.pharmacy.phone, '0932000302');
});

test('balance stays totalOrders - totalPaid after a further payment (calc unchanged)', async () => {
  await paymentService.createPayment(ids.warehouse, ids.whUser, {
    pharmacyId: ids.inDebt.toString(), amount: 5, currency: 'USD',
  });
  const detail = await balanceService.getBalanceDetail(ids.inDebt, ids.warehouse);
  assert.strictEqual(detail.balance.totalOrdersUsd, 15);
  assert.strictEqual(detail.balance.totalPaidUsd, 5);
  assert.strictEqual(detail.balance.balanceUsd, 10);

  // ...and it's still listed (now with balance 10).
  const { list } = await invoiceList();
  assert.strictEqual(
    list.find((p) => String(p.pharmacyId) === String(ids.inDebt)).balanceUsd,
    10
  );
});
