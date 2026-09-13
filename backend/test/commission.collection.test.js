// Admin commission collection - who owes the platform, and recording when a
// warehouse pays.
//
// Built on the Step 6 settlement computation rather than restating it: what is
// new here is the collection layer and the outstanding arithmetic on top.
//
// Deliberately NOT a ledger event. Commission is warehouse↔platform; a
// LedgerAccount is pharmacy↔warehouse. These tests pin that separation - a
// collection must never touch a pharmacy's balance.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-commission-paddi';
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
const CommissionCollection = require('../src/models/commissionCollection.model');
const FinancialAuditLog = require('../src/models/financialAuditLog.model');

const orderService = require('../src/services/order.service');
const warehouseOrderService = require('../src/services/warehouseOrder.service');
const warehouseReturnService = require('../src/services/warehouseReturn.service');
const commissionService = require('../src/services/commissionCollection.service');

const RATE = 10000;
const DAY = 24 * 60 * 60 * 1000;
const ids = {};
const tokens = {};
let server;
let baseUrl;

function withCode(expected) {
  return (err) => {
    assert.strictEqual(err.code, expected, `expected ${expected}, got ${err.code}`);
    return true;
  };
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
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

// A delivered order on warehouse A, through the real transitions so the charge
// and its frozen commission are posted by the code that actually posts them.
async function deliverOrder(quantity = 1) {
  const order = await orderService.createOrder({
    userId: ids.phUser,
    pharmacyId: ids.pharmacy,
    warehouseId: ids.warehouseA,
    items: [{ productId: ids.productA.toString(), quantity }],
    notes: null,
  });
  let current = order;
  for (let i = 0; i < 4; i += 1) {
    current = await warehouseOrderService.advanceOrderStatus(
      current._id.toString(), ids.warehouseA, ids.whAUser
    );
  }
  return current;
}

function wideRange() {
  return { from: new Date(Date.now() - 30 * DAY), to: new Date(Date.now() + DAY) };
}

async function overview(range = wideRange()) {
  return commissionService.getCommissionOverview(range);
}

function rowFor(data, warehouseId) {
  return data.rows.find((r) => String(r.warehouseId) === String(warehouseId));
}

function record(overrides = {}) {
  const range = wideRange();
  return commissionService.recordCollection({
    warehouseId: ids.warehouseA.toString(),
    periodFrom: range.from,
    periodTo: range.to,
    amountSyp: 1000,
    method: 'cash',
    actorId: ids.adminUser,
    ...overrides,
  });
}

test.before(async () => {
  await startMemoryMongo({ dbName: 'feniq-commission-test' });
  await syncIndexes(LedgerEntry, LedgerAccount, Order, Return, CommissionCollection);
  await ExchangeRate.create({ _id: 'singleton', usdToSyp: RATE, source: 'manual' });

  const [adminUser, phUser, whAUser, whBUser] = await User.create([
    { name: 'AD', phone: '0951003001', role: 'admin', status: 'active' },
    { name: 'PH', phone: '0932003001', role: 'pharmacy', status: 'active' },
    { name: 'WA', phone: '0942003001', role: 'warehouse', status: 'active' },
    { name: 'WB', phone: '0942003002', role: 'warehouse', status: 'active' },
  ]);
  ids.adminUser = adminUser._id;
  ids.phUser = phUser._id;
  ids.whAUser = whAUser._id;
  tokens.admin = jwt.sign({ sub: String(adminUser._id) }, env.jwtSecret, { expiresIn: '1h' });
  tokens.warehouse = jwt.sign({ sub: String(whAUser._id) }, env.jwtSecret, { expiresIn: '1h' });
  tokens.pharmacy = jwt.sign({ sub: String(phUser._id) }, env.jwtSecret, { expiresIn: '1h' });

  const pharmacy = await Pharmacy.create({
    userId: phUser._id, nameAr: 'ص', nameEn: 'Pharmacy', ownerName: 'O',
    address: 'a', city: 'Latakia', areaType: 'city', phone: '0932003001', addedBy: 'self',
  });
  ids.pharmacy = pharmacy._id;

  // discountRate 0 keeps the arithmetic readable: finalPrice == subtotal, so
  // commission is a clean 1% of the order total.
  const [warehouseA, warehouseB] = await Warehouse.create([
    {
      userId: whAUser._id, nameAr: 'أ', nameEn: 'Warehouse A', address: 'r', city: 'Latakia',
      phone: '0942003001', deliveryType: 'self', isActive: true, discountRate: 0, commissionRate: 1,
    },
    {
      userId: whBUser._id, nameAr: 'ب', nameEn: 'Warehouse B', address: 'r', city: 'Latakia',
      phone: '0942003002', deliveryType: 'self', isActive: true, discountRate: 0, commissionRate: 1,
    },
  ]);
  ids.warehouseA = warehouseA._id;
  ids.warehouseB = warehouseB._id;

  const product = await Product.create({
    warehouseId: warehouseA._id, nameAr: 'دواء', nameEn: 'Drug', manufacturerAr: 'شركة',
    price: 100, unitAr: 'علبة', unitEn: 'box', isAvailable: true, isActive: true,
  });
  ids.productA = product._id;

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await stopMemoryMongo();
});

test.beforeEach(async () => {
  await Promise.all([
    Order.deleteMany({}), OrderItem.deleteMany({}), Return.deleteMany({}),
    LedgerEntry.deleteMany({}), LedgerAccount.deleteMany({}),
    CommissionCollection.deleteMany({}), FinancialAuditLog.deleteMany({}),
  ]);
});

// --- the overview -----------------------------------------------------------

test('every warehouse is listed, including one that sold nothing', async () => {
  await deliverOrder();
  const data = await overview();

  assert.strictEqual(data.rows.length, 2, 'both warehouses appear');
  const b = rowFor(data, ids.warehouseB);
  assert.strictEqual(b.salesSyp, 0);
  assert.strictEqual(b.commissionOwedSyp, 0);
  assert.strictEqual(b.outstandingSyp, 0, 'a zero is visibly zero, not absent');
});

test('a delivered order produces sales and commission owed', async () => {
  await deliverOrder(); // $100 at 10,000 -> 1,000,000 SYP, 1% commission
  const a = rowFor(await overview(), ids.warehouseA);

  assert.strictEqual(a.orderCount, 1);
  assert.strictEqual(a.salesSyp, 1000000);
  assert.strictEqual(a.returnsSyp, 0);
  assert.strictEqual(a.commissionOwedSyp, 10000);
  assert.strictEqual(a.alreadyCollectedSyp, 0);
  assert.strictEqual(a.outstandingSyp, 10000);
});

test('a credited return reduces both sales and the commission owed', async () => {
  const order = await deliverOrder(2); // 2,000,000 SYP, commission 20,000
  const [item] = await OrderItem.find({ orderId: order._id });
  const returnRequest = await Return.create({
    orderId: order._id, pharmacyId: ids.pharmacy, warehouseId: ids.warehouseA,
    items: [{ orderItemId: item._id, productId: item.productId, quantity: 1, reasonType: 'damaged' }],
  });
  await warehouseReturnService.approveReturn(
    returnRequest._id.toString(), ids.warehouseA, ids.whAUser
  );

  const a = rowFor(await overview(), ids.warehouseA);
  assert.strictEqual(a.salesSyp, 2000000, 'sales is what was charged');
  assert.strictEqual(a.returnsSyp, 1000000, 'half came back');
  assert.strictEqual(
    a.commissionOwedSyp,
    10000,
    'the pro-rata clawback from Step 6 flows straight through'
  );
});

test('the list is sorted by outstanding, most-owing first', async () => {
  await deliverOrder(3); // warehouse A owes 30,000
  const data = await overview();
  assert.strictEqual(String(data.rows[0].warehouseId), String(ids.warehouseA));
  assert.ok(data.rows[0].outstandingSyp > data.rows[1].outstandingSyp);
});

test('the overview totals sum the rows', async () => {
  await deliverOrder(2);
  const data = await overview();
  assert.strictEqual(data.totals.salesSyp, 2000000);
  assert.strictEqual(data.totals.commissionOwedSyp, 20000);
  assert.strictEqual(data.totals.outstandingSyp, 20000);
});

// --- outstanding = owed - collected -----------------------------------------

test('recording a collection reduces the outstanding amount', async () => {
  await deliverOrder(); // owes 10,000
  await record({ amountSyp: 4000 });

  const a = rowFor(await overview(), ids.warehouseA);
  assert.strictEqual(a.commissionOwedSyp, 10000, 'what is owed does not change');
  assert.strictEqual(a.alreadyCollectedSyp, 4000);
  assert.strictEqual(a.outstandingSyp, 6000);
});

test('several collections in the range sum', async () => {
  await deliverOrder();
  await record({ amountSyp: 3000 });
  await record({ amountSyp: 2500 });

  const a = rowFor(await overview(), ids.warehouseA);
  assert.strictEqual(a.alreadyCollectedSyp, 5500);
  assert.strictEqual(a.outstandingSyp, 4500);
});

test('over-collection reports a negative outstanding rather than hiding it', async () => {
  await deliverOrder(); // owes 10,000
  await record({ amountSyp: 15000 });

  const a = rowFor(await overview(), ids.warehouseA);
  assert.strictEqual(a.outstandingSyp, -5000, 'an overpayment is information, not a zero');
});

test('one warehouse collection never affects another', async () => {
  await deliverOrder();
  await record({ warehouseId: ids.warehouseB.toString(), amountSyp: 9000 });

  const data = await overview();
  assert.strictEqual(rowFor(data, ids.warehouseA).alreadyCollectedSyp, 0);
  assert.strictEqual(rowFor(data, ids.warehouseB).alreadyCollectedSyp, 9000);
});

// --- period overlap ---------------------------------------------------------

test('a collection counts only when its window overlaps the range being viewed', async () => {
  await deliverOrder();
  // Paid for a window that ended well before the range under test.
  await record({
    amountSyp: 7000,
    periodFrom: new Date(Date.now() - 200 * DAY),
    periodTo: new Date(Date.now() - 150 * DAY),
  });

  const inside = rowFor(await overview(), ids.warehouseA);
  assert.strictEqual(inside.alreadyCollectedSyp, 0, 'an unrelated window does not count');

  const spanning = rowFor(
    await overview({ from: new Date(Date.now() - 210 * DAY), to: new Date(Date.now() + DAY) }),
    ids.warehouseA
  );
  assert.strictEqual(spanning.alreadyCollectedSyp, 7000, 'a range that reaches it does');
});

test('a collection whose window merely touches the range still counts', async () => {
  await deliverOrder();
  const from = new Date(Date.now() - 10 * DAY);
  await record({
    amountSyp: 2000,
    periodFrom: new Date(Date.now() - 40 * DAY),
    periodTo: from, // ends exactly where the viewed range starts
  });

  const a = rowFor(await overview({ from, to: new Date(Date.now() + DAY) }), ids.warehouseA);
  assert.strictEqual(a.alreadyCollectedSyp, 2000, 'the bounds are inclusive');
});

// --- reversal ---------------------------------------------------------------

test('a reversed collection stops counting and the outstanding goes back up', async () => {
  await deliverOrder(); // owes 10,000
  const collection = await record({ amountSyp: 4000 });
  assert.strictEqual(rowFor(await overview(), ids.warehouseA).outstandingSyp, 6000);

  const reversed = await commissionService.reverseCollection({
    collectionId: collection._id.toString(),
    reason: 'the transfer bounced',
    actorId: ids.adminUser,
  });

  assert.strictEqual(reversed.status, 'reversed');
  assert.strictEqual(reversed.reversalReason, 'the transfer bounced');
  assert.ok(reversed.reversedAt instanceof Date);

  const a = rowFor(await overview(), ids.warehouseA);
  assert.strictEqual(a.alreadyCollectedSyp, 0);
  assert.strictEqual(a.outstandingSyp, 10000, 'back to the full amount owed');
});

test('the reversed row is kept, not deleted, and stays in the history', async () => {
  const collection = await record({ amountSyp: 4000 });
  await commissionService.reverseCollection({
    collectionId: collection._id.toString(), reason: 'duplicate entry', actorId: ids.adminUser,
  });

  assert.strictEqual(await CommissionCollection.countDocuments(), 1, 'nothing was deleted');
  const {
    rows: [row],
  } = await commissionService.listCollectionsForWarehouse(ids.warehouseA);
  assert.strictEqual(row.status, 'reversed');
  assert.strictEqual(row.reversalReason, 'duplicate entry');
});

test('a collection can be reversed at most once', async () => {
  const collection = await record();
  await commissionService.reverseCollection({
    collectionId: collection._id.toString(), reason: 'first', actorId: ids.adminUser,
  });

  await assert.rejects(
    () =>
      commissionService.reverseCollection({
        collectionId: collection._id.toString(), reason: 'second', actorId: ids.adminUser,
      }),
    withCode('COLLECTION_ALREADY_REVERSED')
  );

  // The first reversal's reason and actor survive the second attempt.
  const reread = await CommissionCollection.findById(collection._id).lean();
  assert.strictEqual(reread.reversalReason, 'first');
});

test('a reversal requires a reason', async () => {
  const collection = await record();
  await assert.rejects(
    () =>
      commissionService.reverseCollection({
        collectionId: collection._id.toString(), reason: '   ', actorId: ids.adminUser,
      }),
    withCode('REASON_REQUIRED')
  );
  assert.strictEqual((await CommissionCollection.findById(collection._id)).status, 'recorded');
});

// --- validation -------------------------------------------------------------

test('validation rejects a bad amount, an inverted period and an unknown warehouse', async () => {
  await assert.rejects(() => record({ amountSyp: 0 }), withCode('INVALID_COLLECTION_AMOUNT'));
  await assert.rejects(() => record({ amountSyp: -5 }), withCode('INVALID_COLLECTION_AMOUNT'));
  await assert.rejects(
    () => record({ periodFrom: new Date(), periodTo: new Date(Date.now() - DAY) }),
    withCode('INVALID_COLLECTION_PERIOD')
  );
  await assert.rejects(
    () => record({ warehouseId: new mongoose.Types.ObjectId().toString() }),
    withCode('WAREHOUSE_NOT_FOUND')
  );
  await assert.rejects(() => record({ method: 'crypto' }), withCode('INVALID_PAYMENT_METHOD'));
});

test('a single-day period is valid', async () => {
  const day = new Date(Date.now() - DAY);
  const collection = await record({ periodFrom: day, periodTo: day, amountSyp: 100 });
  assert.strictEqual(collection.status, 'recorded');
});

// --- it is NOT a ledger event -----------------------------------------------

test('recording a collection touches no LedgerEntry and no pharmacy balance', async () => {
  await deliverOrder();
  const entriesBefore = await LedgerEntry.countDocuments();
  const account = await LedgerAccount.findOne({ warehouseId: ids.warehouseA });
  const balanceBefore = account.balanceCache.syp;

  await record({ amountSyp: 10000 });

  assert.strictEqual(await LedgerEntry.countDocuments(), entriesBefore, 'no entry was posted');
  const after = await LedgerAccount.findById(account._id);
  assert.strictEqual(
    after.balanceCache.syp,
    balanceBefore,
    "commission is warehouse-to-platform - it must never move a pharmacy's balance"
  );
});

// --- audit ------------------------------------------------------------------

test('recording and reversing both write an audit record', async () => {
  const collection = await record({ amountSyp: 4000, reference: 'TRX-1' });

  const created = await FinancialAuditLog.findOne({ action: 'commission.collected' }).lean();
  assert.ok(created, 'the creation is audited');
  assert.strictEqual(String(created.entityId), String(collection._id));
  assert.strictEqual(created.entityType, 'CommissionCollection');
  assert.strictEqual(String(created.actorId), String(ids.adminUser));
  assert.strictEqual(String(created.onBehalfOfWarehouseId), String(ids.warehouseA));
  assert.strictEqual(created.after.amountSyp, 4000);

  await commissionService.reverseCollection({
    collectionId: collection._id.toString(), reason: 'cheque bounced', actorId: ids.adminUser,
  });

  const reversed = await FinancialAuditLog.findOne({
    action: 'commission.collection_reversed',
  }).lean();
  assert.ok(reversed, 'the reversal is audited');
  assert.strictEqual(reversed.reason, 'cheque bounced');
  assert.strictEqual(reversed.before.status, 'recorded');
  assert.strictEqual(reversed.after.status, 'reversed');
});

// --- the warehouse detail ---------------------------------------------------

test('the detail view carries the settlement breakdown and the full history', async () => {
  await deliverOrder(2);
  const collection = await record({ amountSyp: 5000 });
  await commissionService.reverseCollection({
    collectionId: collection._id.toString(), reason: 'wrong warehouse', actorId: ids.adminUser,
  });
  await record({ amountSyp: 8000 });

  const detail = await commissionService.getWarehouseCommissionDetail(ids.warehouseA.toString(), {});

  assert.strictEqual(detail.summary.commissionOwedSyp, 20000);
  assert.strictEqual(detail.summary.alreadyCollectedSyp, 8000, 'the reversed one is excluded');
  assert.strictEqual(detail.summary.outstandingSyp, 12000);
  assert.strictEqual(detail.orders.length, 1, 'the per-order breakdown is there');
  assert.strictEqual(detail.collections.length, 2, 'both the reversal and the live one show');
});

// --- HTTP: permissions ------------------------------------------------------

test('every commission endpoint is admin-only', async () => {
  const collection = await record();
  const paths = [
    ['GET', '/admin/commission/overview'],
    ['GET', `/admin/commission/warehouses/${ids.warehouseA}`],
    ['POST', '/admin/commission/collections'],
    ['POST', `/admin/commission/collections/${collection._id}/reverse`],
  ];

  for (const [method, path] of paths) {
    const body = method === 'POST' ? {} : undefined;
    for (const role of ['warehouse', 'pharmacy']) {
      const { status } = await call(method, path, { token: tokens[role], body });
      assert.strictEqual(status, 403, `${role} reached ${method} ${path}`);
    }
    const anonymous = await call(method, path, { body });
    assert.strictEqual(anonymous.status, 401, `anonymous reached ${method} ${path}`);
  }
});

// --- HTTP: the happy path ---------------------------------------------------

test('the admin can drive the whole flow over HTTP', async () => {
  await deliverOrder(); // owes 10,000
  const range = wideRange();
  const qs = `?from=${range.from.toISOString()}&to=${range.to.toISOString()}`;

  const before = await call('GET', `/admin/commission/overview${qs}`, { token: tokens.admin });
  assert.strictEqual(before.status, 200);
  const rowBefore = before.body.overview.warehouses.find(
    (w) => String(w.warehouseId) === String(ids.warehouseA)
  );
  assert.strictEqual(rowBefore.outstandingSyp, 10000);
  assert.strictEqual(before.body.overview.warehouses[0].outstandingSyp, 10000, 'sorted desc');

  const recorded = await call('POST', '/admin/commission/collections', {
    token: tokens.admin,
    body: {
      warehouseId: ids.warehouseA.toString(),
      periodFrom: range.from.toISOString(),
      periodTo: range.to.toISOString(),
      amountSyp: 6000,
      method: 'bank_transfer',
      reference: 'TRX-778',
    },
  });
  assert.strictEqual(recorded.status, 201);
  assert.strictEqual(recorded.body.collection.status, 'recorded');
  assert.strictEqual(recorded.body.collection.method, 'bank_transfer');

  const after = await call('GET', `/admin/commission/overview${qs}`, { token: tokens.admin });
  const rowAfter = after.body.overview.warehouses.find(
    (w) => String(w.warehouseId) === String(ids.warehouseA)
  );
  assert.strictEqual(rowAfter.alreadyCollectedSyp, 6000);
  assert.strictEqual(rowAfter.outstandingSyp, 4000);

  const reversal = await call(
    'POST', `/admin/commission/collections/${recorded.body.collection.id}/reverse`,
    { token: tokens.admin, body: { reason: 'recorded against the wrong warehouse' } }
  );
  assert.strictEqual(reversal.status, 200);
  assert.strictEqual(reversal.body.collection.status, 'reversed');

  const restored = await call('GET', `/admin/commission/overview${qs}`, { token: tokens.admin });
  const rowRestored = restored.body.overview.warehouses.find(
    (w) => String(w.warehouseId) === String(ids.warehouseA)
  );
  assert.strictEqual(rowRestored.outstandingSyp, 10000, 'back where it started');
});

test('a reversal over HTTP without a reason is refused', async () => {
  const collection = await record();
  const { status, body } = await call(
    'POST', `/admin/commission/collections/${collection._id}/reverse`,
    { token: tokens.admin, body: {} }
  );
  assert.strictEqual(status, 400);
  assert.strictEqual(body.code ?? body.error?.code, 'REASON_REQUIRED');
});
