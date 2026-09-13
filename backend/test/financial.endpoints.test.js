// Money-Flow V2 - the HTTP contract every financial screen actually consumes.
//
// Grepping the frontends proves nothing about what the server returns. This
// drives the real Express app over HTTP and asserts the exact fields each
// screen reads, so a read path that quietly falls back to the retired
// PharmacyBalance cache - or drops a field a screen depends on - fails here
// rather than in someone's browser.
//
// One test per screen, named after it.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-endpoints-paddin';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const { startMemoryMongo, stopMemoryMongo, syncIndexes } = require('./helpers/mongo');

const app = require('../src/app');
const env = require('../src/config/env');

const User = require('../src/models/user.model');
const Pharmacy = require('../src/models/pharmacy.model');
const Warehouse = require('../src/models/warehouse.model');
const Product = require('../src/models/product.model');
const Order = require('../src/models/order.model');
const OrderItem = require('../src/models/orderItem.model');
const Return = require('../src/models/return.model');
const ExchangeRate = require('../src/models/exchangeRate.model');
const LedgerAccount = require('../src/models/ledgerAccount.model');
const LedgerEntry = require('../src/models/ledgerEntry.model');

const orderService = require('../src/services/order.service');
const warehouseOrderService = require('../src/services/warehouseOrder.service');
const warehouseReturnService = require('../src/services/warehouseReturn.service');

const RATE = 10000;
const ids = {};
const tokens = {};
let server;
let baseUrl;

function tokenFor(userId) {
  return jwt.sign({ sub: String(userId) }, env.jwtSecret, { expiresIn: '1h' });
}

async function call(method, path, { token, body } = {}) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: response.status, body: json, headers: response.headers };
}

async function deliver(order) {
  let current = order;
  for (let i = 0; i < 4; i += 1) {
    current = await warehouseOrderService.advanceOrderStatus(
      current._id.toString(),
      ids.warehouse,
      ids.whUser
    );
  }
  return current;
}

test.before(async () => {
  await startMemoryMongo({ dbName: 'feniq-endpoints-test' });
  await syncIndexes(LedgerEntry, LedgerAccount, Order, Return);
  await ExchangeRate.create({ _id: 'singleton', usdToSyp: RATE, source: 'manual' });

  const [phUser, whUser, adminUser] = await User.create([
    { name: 'PH', phone: '0932002001', role: 'pharmacy', status: 'active' },
    { name: 'WH', phone: '0942002001', role: 'warehouse', status: 'active' },
    { name: 'AD', phone: '0952002001', role: 'admin', status: 'active' },
  ]);
  ids.phUser = phUser._id;
  ids.whUser = whUser._id;
  tokens.pharmacy = tokenFor(phUser._id);
  tokens.warehouse = tokenFor(whUser._id);
  tokens.admin = tokenFor(adminUser._id);

  const pharmacy = await Pharmacy.create({
    userId: phUser._id, nameAr: 'ص', nameEn: 'Pharmacy', ownerName: 'O',
    address: 'a', city: 'Latakia', areaType: 'city', phone: '0932002001', addedBy: 'self',
  });
  ids.pharmacy = pharmacy._id;

  const warehouse = await Warehouse.create({
    userId: whUser._id, nameAr: 'م', nameEn: 'Warehouse', address: 'r', city: 'Latakia',
    phone: '0942002001', deliveryType: 'self', isActive: true, discountRate: 4, commissionRate: 1,
  });
  ids.warehouse = warehouse._id;

  const product = await Product.create({
    warehouseId: warehouse._id, nameAr: 'دواء', nameEn: 'Drug', manufacturerAr: 'شركة',
    price: 100, unitAr: 'علبة', unitEn: 'box', isAvailable: true, isActive: true,
  });
  ids.product = product._id;

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;

  // One delivered order, one payment, one credited return - enough for every
  // screen below to have something real to render.
  const order = await orderService.createOrder({
    userId: ids.phUser, pharmacyId: ids.pharmacy, warehouseId: ids.warehouse,
    items: [{ productId: ids.product.toString(), quantity: 2 }], notes: null,
  });
  ids.order = (await deliver(order))._id;

  await call('POST', '/warehouse/payments', {
    token: tokens.warehouse,
    body: { pharmacyId: ids.pharmacy.toString(), amount: 100000, currency: 'SYP', method: 'cash' },
  });

  const [item] = await OrderItem.find({ orderId: ids.order });
  const returnRequest = await Return.create({
    orderId: ids.order, pharmacyId: ids.pharmacy, warehouseId: ids.warehouse,
    items: [{ orderItemId: item._id, productId: item.productId, quantity: 1, reasonType: 'damaged' }],
  });
  await warehouseReturnService.approveReturn(
    returnRequest._id.toString(), ids.warehouse, ids.whUser
  );
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await stopMemoryMongo();
});

// --- the retired cache ------------------------------------------------------

test('the retired PharmacyBalance cache is gone and nothing recreated it', async () => {
  // V1's balance lived in `pharmacybalances`, recomputed from scratch on every
  // delivery and payment. The ledger replaced it; this guards against a write
  // path quietly resurrecting the collection.
  const collections = await mongoose.connection.db
    .listCollections({ name: 'pharmacybalances' })
    .toArray();
  assert.strictEqual(collections.length, 0, 'the cache collection was recreated');

  // ...and every figure above was produced without it.
  const { body } = await call('GET', '/warehouse/balances', { token: tokens.warehouse });
  assert.ok(body.pharmacies.length > 0);
  assert.strictEqual(typeof body.pharmacies[0].balanceSyp, 'number');
});

// --- warehouse panel: Invoices list -----------------------------------------

test('GET /warehouse/balances returns the ledger-backed account list', async () => {
  const { status, body } = await call('GET', '/warehouse/balances', { token: tokens.warehouse });
  assert.strictEqual(status, 200);

  const [row] = body.pharmacies;
  // Exactly what WarehouseDebtsPage's table renders.
  for (const field of ['pharmacyId', 'nameEn', 'phone', 'balanceSyp', 'lastActivityAt']) {
    assert.ok(field in row, `missing ${field}`);
  }
  assert.strictEqual(typeof row.balanceSyp, 'number');
  // The V1 cache fields must be gone - a screen still reading them would
  // silently render undefined.
  assert.ok(!('totalOrdersUsd' in row), 'V1 cache field leaked');
  assert.ok(!('totalPaidUsd' in row), 'V1 cache field leaked');
  assert.ok(body.pagination, 'the list paginates');
});

// --- warehouse panel: account statement -------------------------------------

test('GET /warehouse/balances/:pharmacyId returns a statement plus payments', async () => {
  const { status, body } = await call(
    `GET`, `/warehouse/balances/${ids.pharmacy}`, { token: tokens.warehouse }
  );
  assert.strictEqual(status, 200);

  const { statement, payments } = body;
  // WarehouseDebtDetail's summary cards and table.
  for (const field of ['period', 'opening', 'closing', 'summary', 'outstandingDebtSyp', 'creditBalanceSyp', 'rows']) {
    assert.ok(field in statement, `missing statement.${field}`);
  }
  assert.ok(statement.pharmacy, 'the warehouse sees the other party');
  assert.strictEqual(statement.warehouse, undefined, 'and not itself');

  // A charge, a payment and a return credit, in business-date order.
  const kinds = statement.rows.map((r) => r.kind);
  assert.deepStrictEqual(kinds, ['charge', 'payment', 'return_credit']);
  for (const row of statement.rows) {
    for (const field of ['id', 'kind', 'effectiveAt', 'debitSyp', 'creditSyp', 'balanceSyp', 'reference']) {
      assert.ok(field in row, `missing row.${field}`);
    }
  }
  // The running balance ends where the closing figure says it does.
  assert.strictEqual(statement.rows.at(-1).balanceSyp, statement.closing.syp);

  // PaymentRow needs the lifecycle to decide whether to offer "Reverse".
  const [payment] = payments;
  for (const field of ['id', 'paymentNumber', 'amount', 'currency', 'method', 'kind', 'status', 'paidAt']) {
    assert.ok(field in payment, `missing payment.${field}`);
  }
});

// --- warehouse panel: order detail ------------------------------------------

test('GET /warehouse/orders/:id exposes the commission and the net', async () => {
  const { status, body } = await call('GET', `/warehouse/orders/${ids.order}`, {
    token: tokens.warehouse,
  });
  assert.strictEqual(status, 200);
  const { order } = body;
  assert.strictEqual(typeof order.commissionAmount, 'number');
  assert.strictEqual(
    order.warehouseNetSyp,
    order.finalPrice - order.commissionAmount,
    'what the warehouse actually keeps'
  );
});

// --- warehouse panel: settlement --------------------------------------------

test('GET /warehouse/settlement returns totals and per-order rows', async () => {
  const { status, body } = await call('GET', '/warehouse/settlement', { token: tokens.warehouse });
  assert.strictEqual(status, 200);

  const { totals, orders } = body.settlement;
  for (const field of [
    'orderCount', 'grossSalesSyp', 'creditedSalesSyp', 'netSalesSyp',
    'grossCommissionSyp', 'commissionClawbackSyp', 'netCommissionSyp', 'warehouseNetSyp',
  ]) {
    assert.ok(field in totals, `missing totals.${field}`);
  }
  assert.ok(totals.commissionClawbackSyp > 0, 'the credited return clawed commission back');
  assert.ok(orders.length > 0);
});

// --- warehouse panel: return credit preview ---------------------------------

test('GET /warehouse/returns/:id/credit-preview reports the credited figure', async () => {
  const returnRequest = await Return.findOne({ orderId: ids.order });
  const { status, body } = await call(
    'GET', `/warehouse/returns/${returnRequest._id}/credit-preview`, { token: tokens.warehouse }
  );
  assert.strictEqual(status, 200);
  assert.strictEqual(body.preview.alreadyResolved, true);
  assert.strictEqual(typeof body.preview.creditSyp, 'number');
});

// --- pharmacy app: Account History ------------------------------------------

test('GET /pharmacy/debts returns debt, credit and net plus every account', async () => {
  const { status, body } = await call('GET', '/pharmacy/debts', { token: tokens.pharmacy });
  assert.strictEqual(status, 200);

  // The three headline figures the app used to fold client-side.
  for (const field of ['totalDebtSyp', 'totalCreditSyp', 'netPositionSyp', 'accounts']) {
    assert.ok(field in body, `missing ${field}`);
  }
  assert.strictEqual(typeof body.totalDebtSyp, 'number');

  const [account] = body.accounts;
  for (const field of ['warehouseId', 'nameAr', 'phone', 'balanceSyp', 'outstandingDebtSyp', 'creditBalanceSyp']) {
    assert.ok(field in account, `missing account.${field}`);
  }
  // V1 returned `warehouses`, not `accounts` - a client on the old shape would
  // render an empty list rather than fail loudly, so assert it is gone.
  assert.strictEqual(body.warehouses, undefined, 'V1 response shape leaked');
});

test('GET /orders/savings-summary returns the full breakdown in frozen SYP', async () => {
  const { status, body } = await call('GET', '/orders/savings-summary', {
    token: tokens.pharmacy,
  });
  assert.strictEqual(status, 200);

  const { savings } = body;
  for (const field of [
    'offerAndManufacturerSyp', 'advertisementSyp', 'platformDiscountSyp',
    'totalSavingsSyp', 'totalSavingsUsd',
  ]) {
    assert.ok(field in savings, `missing savings.${field}`);
  }
  // The platform discount is real money the pharmacy did not pay, and V1
  // omitted it entirely.
  assert.ok(savings.platformDiscountSyp > 0);
  assert.strictEqual(
    savings.totalSavingsSyp,
    savings.offerAndManufacturerSyp + savings.advertisementSyp + savings.platformDiscountSyp
  );
});

// --- pharmacy app: account statement ----------------------------------------

test('GET /pharmacy/debts/:warehouseId returns the pharmacy-side statement', async () => {
  const { status, body } = await call('GET', `/pharmacy/debts/${ids.warehouse}`, {
    token: tokens.pharmacy,
  });
  assert.strictEqual(status, 200);

  const { statement } = body;
  assert.ok(statement.warehouse, 'the pharmacy sees the other party');
  assert.strictEqual(statement.pharmacy, undefined, 'and not itself');
  assert.ok(statement.rows.length > 0);
  assert.strictEqual(typeof statement.closing.syp, 'number');

  // V1's shape - two disconnected lists under separately computed cards.
  assert.strictEqual(body.orders, undefined, 'V1 response shape leaked');
  assert.strictEqual(body.balanceUsd, undefined, 'V1 response shape leaked');
});

// --- invoices ---------------------------------------------------------------

test('GET /orders/:id/invoice renders line maths that multiplies out', async () => {
  const { status, body } = await call('GET', `/orders/${ids.order}/invoice`, {
    token: tokens.pharmacy,
  });
  assert.strictEqual(status, 200);

  const { invoice } = body;
  assert.ok(invoice.invoiceNumber > 0);
  const [line] = invoice.items;
  assert.strictEqual(line.unitPriceSyp * line.quantity, line.lineTotalSyp);
  // The pharmacy's copy never shows the platform's cut.
  assert.strictEqual(invoice.commissionSyp, undefined);
  assert.ok(invoice.credits.length > 0, 'the credited return is shown against it');
});

test('the warehouse copy of the invoice adds the commission and net', async () => {
  const { status, body } = await call('GET', `/warehouse/orders/${ids.order}/invoice`, {
    token: tokens.warehouse,
  });
  assert.strictEqual(status, 200);
  assert.strictEqual(typeof body.invoice.commissionSyp, 'number');
  assert.strictEqual(typeof body.invoice.warehouseNetSyp, 'number');
});

// --- retired routes ---------------------------------------------------------

test('the V1 payment edit and delete routes are gone', async () => {
  const edit = await call('PATCH', '/warehouse/payments/000000000000000000000000', {
    token: tokens.warehouse,
    body: { amount: 1 },
  });
  const remove = await call('DELETE', '/warehouse/payments/000000000000000000000000', {
    token: tokens.warehouse,
  });
  assert.strictEqual(edit.status, 404, 'PATCH is no longer routed');
  assert.strictEqual(remove.status, 404, 'DELETE is no longer routed');
});

// --- authorization ----------------------------------------------------------

test('a pharmacy cannot reach any warehouse financial endpoint', async () => {
  for (const path of ['/warehouse/balances', '/warehouse/settlement']) {
    const { status } = await call('GET', path, { token: tokens.pharmacy });
    assert.strictEqual(status, 403, `${path} should be forbidden`);
  }
  const post = await call('POST', '/warehouse/payments', {
    token: tokens.pharmacy,
    body: { pharmacyId: ids.pharmacy.toString(), amount: 1 },
  });
  assert.strictEqual(post.status, 403, 'a pharmacy can never record a payment');
});

test('manual adjustments are admin-only', async () => {
  const body = {
    pharmacyId: ids.pharmacy.toString(),
    warehouseId: ids.warehouse.toString(),
    direction: 'credit',
    amountSyp: 1000,
    reason: 'test',
  };
  assert.strictEqual((await call('POST', '/admin/ledger/adjustments', { token: tokens.warehouse, body })).status, 403);
  assert.strictEqual((await call('POST', '/admin/ledger/adjustments', { token: tokens.pharmacy, body })).status, 403);
  assert.strictEqual((await call('POST', '/admin/ledger/adjustments', { token: tokens.admin, body })).status, 201);
});

test('an adjustment without a reason is refused over HTTP too', async () => {
  const { status, body } = await call('POST', '/admin/ledger/adjustments', {
    token: tokens.admin,
    body: {
      pharmacyId: ids.pharmacy.toString(),
      warehouseId: ids.warehouse.toString(),
      direction: 'debit',
      amountSyp: 500,
    },
  });
  assert.strictEqual(status, 400);
  assert.strictEqual(body.code ?? body.error?.code, 'REASON_REQUIRED');
});

// --- idempotency over the wire ----------------------------------------------

test('a replayed payment returns 200 with the Idempotent-Replay header', async () => {
  const body = {
    pharmacyId: ids.pharmacy.toString(),
    amount: 5000,
    currency: 'SYP',
    idempotencyKey: 'http-replay-key-1',
  };
  const first = await call('POST', '/warehouse/payments', { token: tokens.warehouse, body });
  const second = await call('POST', '/warehouse/payments', { token: tokens.warehouse, body });

  assert.strictEqual(first.status, 201);
  assert.strictEqual(second.status, 200);
  assert.strictEqual(second.headers.get('idempotent-replay'), 'true');
  assert.strictEqual(second.body.payment.id, first.body.payment.id);
});
