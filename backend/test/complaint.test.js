// Complaint system - Section 16's required coverage, at the service layer.
//
// Runs against its own database (phoenix-complaint-test) and drops it at the
// end, same pattern as readpath.lean.test.js / notification.fanout.test.js.
// The realtime layer is left as-is: emitToWarehouse/emitToAdmins tolerate a
// null io (no socket server booted here) and simply no-op.
process.env.MONGODB_URI = 'mongodb://localhost:27017/phoenix-complaint-test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-complaint-tests';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');

const User = require('../src/models/user.model');
const Pharmacy = require('../src/models/pharmacy.model');
const Warehouse = require('../src/models/warehouse.model');
const Order = require('../src/models/order.model');
const Complaint = require('../src/models/complaint.model');
const Notification = require('../src/models/notification.model');

const complaintService = require('../src/services/complaint.service');
const warehouseComplaintService = require('../src/services/warehouseComplaint.service');
const adminComplaintService = require('../src/services/adminComplaint.service');
const orderService = require('../src/services/order.service');

const ids = {};

// The services raise ApiError with a stable `code`; the human `message` is
// secondary. assert.rejects matches against `message` by default, so assert
// the code explicitly instead.
function withCode(expected) {
  return (err) => {
    assert.strictEqual(err.code, expected, `expected error code ${expected}, got ${err.code}`);
    return true;
  };
}

test.before(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  await mongoose.connection.dropDatabase();

  const [phUserA, phUserB, whUserA, whUserB, adminUser] = await User.create([
    { name: 'Pharm A', phone: '0930000001', role: 'pharmacy', status: 'active' },
    { name: 'Pharm B', phone: '0930000002', role: 'pharmacy', status: 'active' },
    { name: 'WH A', phone: '0930000003', role: 'warehouse', status: 'active' },
    { name: 'WH B', phone: '0930000004', role: 'warehouse', status: 'active' },
    { name: 'Admin', phone: '0930000005', role: 'admin', status: 'active' },
  ]);
  ids.adminUser = adminUser._id;
  ids.phUserA = phUserA._id;

  const [pharmA, pharmB] = await Pharmacy.create([
    {
      userId: phUserA._id, nameAr: 'صيدلية أ', nameEn: 'Pharmacy A', ownerName: 'Owner A',
      address: 'addr', city: 'Latakia', phone: '0930000001', addedBy: 'self',
    },
    {
      userId: phUserB._id, nameAr: 'صيدلية ب', nameEn: 'Pharmacy B', ownerName: 'Owner B',
      address: 'addr', city: 'Latakia', phone: '0930000002', addedBy: 'self',
    },
  ]);
  ids.pharmA = pharmA._id;
  ids.pharmB = pharmB._id;

  const [whA, whB] = await Warehouse.create([
    {
      userId: whUserA._id, nameAr: 'مستودع أ', nameEn: 'Warehouse A',
      address: 'addr', city: 'Latakia', phone: '0930000003', isActive: true,
    },
    {
      userId: whUserB._id, nameAr: 'مستودع ب', nameEn: 'Warehouse B',
      address: 'addr', city: 'Latakia', phone: '0930000004', isActive: true,
    },
  ]);
  ids.whA = whA._id;
  ids.whB = whB._id;

  // An order for pharmacy A at warehouse A, and one for pharmacy B at
  // warehouse A - used to prove a pharmacy can't attach a complaint to
  // another pharmacy's order.
  const [orderA, orderB] = await Order.create([
    {
      orderNumber: 91001, pharmacyId: pharmA._id, warehouseId: whA._id,
      status: 'delivered', totalPrice: 10, discountAmount: 0, commissionAmount: 0, finalPrice: 10,
    },
    {
      orderNumber: 91002, pharmacyId: pharmB._id, warehouseId: whA._id,
      status: 'delivered', totalPrice: 10, discountAmount: 0, commissionAmount: 0, finalPrice: 10,
    },
  ]);
  ids.orderId = orderA._id;
  ids.orderNumber = orderA.orderNumber;
  ids.orderBId = orderB._id;
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

// ---------------------------------------------------------------------------
// Context is derived from what the client sends (Sections 1-5, 17)
// ---------------------------------------------------------------------------

test('GENERAL context: no warehouseId, no relatedOrderId -> a warehouse-less complaint', async () => {
  const complaint = await complaintService.createComplaint({
    pharmacyId: ids.pharmA,
    pharmacyUserId: ids.phUserA,
    subject: 'App feedback',
    description: 'The catalog search is slow.',
    extraDetails: '  extra context  ',
  });

  assert.ok(complaint.complaintNumber > 0, 'a sequential number is issued');
  assert.strictEqual(complaint.status, 'pending');
  assert.strictEqual(complaint.warehouseId, null);
  assert.strictEqual(complaint.warehouseUserId, null);
  assert.strictEqual(complaint.relatedOrderId, null);
  assert.strictEqual(complaint.relatedOrderNumber, null);
  assert.strictEqual(complaint.extraDetails, 'extra context', 'trimmed');
  ids.generalComplaint = complaint._id;
});

test('WAREHOUSE context: warehouseId only -> stored + verified, no order', async () => {
  const complaint = await complaintService.createComplaint({
    pharmacyId: ids.pharmA,
    pharmacyUserId: ids.phUserA,
    warehouseId: ids.whA.toString(),
    subject: 'Late delivery',
    description: 'The order arrived two days late.',
  });

  assert.strictEqual(String(complaint.warehouseId), String(ids.whA));
  assert.strictEqual(
    String(complaint.warehouseUserId),
    String((await Warehouse.findById(ids.whA)).userId)
  );
  assert.strictEqual(complaint.relatedOrderId, null);
  assert.strictEqual(complaint.relatedOrderNumber, null);
  ids.complaintA = complaint._id;
});

test('ORDER context: relatedOrderId only -> warehouse resolved FROM the order', async () => {
  const complaint = await complaintService.createComplaint({
    pharmacyId: ids.pharmA,
    pharmacyUserId: ids.phUserA,
    relatedOrderId: ids.orderId.toString(),
    subject: 'Wrong item in this order',
    description: 'Item X was missing.',
  });

  assert.strictEqual(String(complaint.relatedOrderId), String(ids.orderId));
  assert.strictEqual(complaint.relatedOrderNumber, ids.orderNumber, 'number snapshot from the order');
  assert.strictEqual(
    String(complaint.warehouseId),
    String(ids.whA),
    'warehouse came from the order, not the client'
  );
  assert.ok(complaint.warehouseUserId, 'warehouseUserId resolved too');
  ids.orderComplaint = complaint._id;
});

test('the viewmodel reports the derived contextType for each', async () => {
  const complaintViewModel = require('../src/viewmodels/complaint.viewmodel');
  const general = await complaintService.getComplaintForPharmacy(ids.generalComplaint.toString(), ids.pharmA);
  const warehouse = await complaintService.getComplaintForPharmacy(ids.complaintA.toString(), ids.pharmA);
  const order = await complaintService.getComplaintForPharmacy(ids.orderComplaint.toString(), ids.pharmA);
  assert.strictEqual(complaintViewModel.toPharmacyComplaintResponse(general).complaint.contextType, 'general');
  assert.strictEqual(complaintViewModel.toPharmacyComplaintResponse(warehouse).complaint.contextType, 'warehouse');
  assert.strictEqual(complaintViewModel.toPharmacyComplaintResponse(order).complaint.contextType, 'order');
  assert.strictEqual(general.warehouse, null, 'general carries no warehouse block');
});

test('a blank subject or description is rejected (any context)', async () => {
  await assert.rejects(
    () =>
      complaintService.createComplaint({
        pharmacyId: ids.pharmA, pharmacyUserId: ids.phUserA,
        subject: '   ', description: 'x',
      }),
    withCode('COMPLAINT_SUBJECT_REQUIRED')
  );
  await assert.rejects(
    () =>
      complaintService.createComplaint({
        pharmacyId: ids.pharmA, pharmacyUserId: ids.phUserA, warehouseId: ids.whA.toString(),
        subject: 'ok', description: '   ',
      }),
    withCode('COMPLAINT_DESCRIPTION_REQUIRED')
  );
});

test('an over-long field is rejected', async () => {
  await assert.rejects(
    () =>
      complaintService.createComplaint({
        pharmacyId: ids.pharmA, pharmacyUserId: ids.phUserA,
        subject: 'a'.repeat(201), description: 'x',
      }),
    withCode('COMPLAINT_SUBJECT_REQUIRED_TOO_LONG')
  );
});

test('WAREHOUSE context: an invalid or unavailable warehouse is rejected', async () => {
  await assert.rejects(
    () =>
      complaintService.createComplaint({
        pharmacyId: ids.pharmA, pharmacyUserId: ids.phUserA, warehouseId: 'not-an-id',
        subject: 'ok', description: 'ok',
      }),
    withCode('COMPLAINT_INVALID_WAREHOUSE')
  );
  await assert.rejects(
    () =>
      complaintService.createComplaint({
        pharmacyId: ids.pharmA, pharmacyUserId: ids.phUserA,
        warehouseId: new mongoose.Types.ObjectId().toString(),
        subject: 'ok', description: 'ok',
      }),
    withCode('WAREHOUSE_NOT_FOUND')
  );
});

test('ORDER context: a pharmacy cannot attach a complaint to another pharmacy\'s order', async () => {
  await assert.rejects(
    () =>
      complaintService.createComplaint({
        pharmacyId: ids.pharmA, pharmacyUserId: ids.phUserA,
        relatedOrderId: ids.orderBId.toString(), // orderB belongs to pharmacy B
        subject: 'ok', description: 'ok',
      }),
    withCode('COMPLAINT_ORDER_NOT_FOUND')
  );
  await assert.rejects(
    () =>
      complaintService.createComplaint({
        pharmacyId: ids.pharmA, pharmacyUserId: ids.phUserA,
        relatedOrderId: new mongoose.Types.ObjectId().toString(),
        subject: 'ok', description: 'ok',
      }),
    withCode('COMPLAINT_ORDER_NOT_FOUND')
  );
});

test('data contradiction: relatedOrderId of an order at WH_A + warehouseId WH_B -> rejected, not corrected', async () => {
  await assert.rejects(
    () =>
      complaintService.createComplaint({
        pharmacyId: ids.pharmA, pharmacyUserId: ids.phUserA,
        relatedOrderId: ids.orderId.toString(), // order is at warehouse A
        warehouseId: ids.whB.toString(), // ...but client claims warehouse B
        subject: 'ok', description: 'ok',
      }),
    withCode('COMPLAINT_CONTEXT_MISMATCH')
  );
  // A matching warehouseId alongside the order is fine (it's just redundant).
  const ok = await complaintService.createComplaint({
    pharmacyId: ids.pharmA, pharmacyUserId: ids.phUserA,
    relatedOrderId: ids.orderId.toString(), warehouseId: ids.whA.toString(),
    subject: 'ok', description: 'redundant but consistent',
  });
  assert.strictEqual(String(ok.warehouseId), String(ids.whA));
  assert.strictEqual(String(ok.relatedOrderId), String(ids.orderId));
});

test('ORDER context: the complaint shows up on the order-tracking detail response', async () => {
  const { complaints } = await orderService.getOrderForPharmacy(ids.orderId.toString(), ids.pharmA);
  assert.ok(Array.isArray(complaints));
  assert.ok(
    complaints.some((c) => String(c._id) === String(ids.orderComplaint)),
    'the order-context complaint is listed on its order'
  );
  const row = complaints.find((c) => String(c._id) === String(ids.orderComplaint));
  assert.strictEqual(row.subject, 'Wrong item in this order');
  assert.ok('complaintNumber' in row && 'status' in row);

  // Another pharmacy's order-detail never carries this pharmacy's complaints.
  const other = await orderService.getOrderForPharmacy(ids.orderBId.toString(), ids.pharmB);
  assert.deepStrictEqual(other.complaints, []);
});

// ---------------------------------------------------------------------------
// Pharmacy visibility / IDOR (Section 16)
// ---------------------------------------------------------------------------

test('a pharmacy sees its own complaints and not another pharmacy\'s', async () => {
  const bForA = await complaintService.createComplaint({
    pharmacyId: ids.pharmB, pharmacyUserId: (await Pharmacy.findById(ids.pharmB)).userId,
    warehouseId: ids.whA.toString(), subject: 'B complaint', description: 'from pharmacy B',
  });

  const { rows } = await complaintService.listComplaintsForPharmacy(ids.pharmA, {});
  assert.ok(rows.length >= 1);
  assert.ok(rows.every((r) => String(r.complaint.pharmacyId) === String(ids.pharmA)));
  assert.ok(!rows.some((r) => String(r.complaint._id) === String(bForA._id)));
});

test('a pharmacy cannot open another pharmacy\'s complaint by id', async () => {
  await assert.rejects(
    () => complaintService.getComplaintForPharmacy(ids.complaintA.toString(), ids.pharmB),
    withCode('COMPLAINT_NOT_FOUND')
  );
  const own = await complaintService.getComplaintForPharmacy(ids.complaintA.toString(), ids.pharmA);
  assert.strictEqual(String(own.complaint._id), String(ids.complaintA));
  assert.strictEqual(own.warehouse.nameEn, 'Warehouse A');
});

// ---------------------------------------------------------------------------
// Warehouse visibility / IDOR (Section 16)
// ---------------------------------------------------------------------------

test('a warehouse sees only complaints against itself', async () => {
  await complaintService.createComplaint({
    pharmacyId: ids.pharmA, pharmacyUserId: ids.phUserA, warehouseId: ids.whB.toString(),
    subject: 'against B', description: 'this one is for warehouse B',
  });

  const { rows } = await warehouseComplaintService.listComplaintsForWarehouse(ids.whA, {});
  assert.ok(rows.length >= 1);
  assert.ok(rows.every((r) => String(r.complaint.warehouseId) === String(ids.whA)));
  assert.ok(rows.every((r) => r.pharmacy), 'the pharmacy contact is attached for the warehouse view');
  // Section 10: a general complaint never reaches any warehouse's queue.
  assert.ok(
    !rows.some((r) => String(r.complaint._id) === String(ids.generalComplaint)),
    'the general complaint is not visible to the warehouse'
  );
  // ...but the order-context complaint (warehouse resolved from the order) is.
  assert.ok(rows.some((r) => String(r.complaint._id) === String(ids.orderComplaint)));
});

test('a warehouse cannot open a complaint filed against a different warehouse', async () => {
  await assert.rejects(
    () => warehouseComplaintService.getComplaintForWarehouse(ids.complaintA.toString(), ids.whB),
    withCode('COMPLAINT_NOT_FOUND')
  );
  const ok = await warehouseComplaintService.getComplaintForWarehouse(ids.complaintA.toString(), ids.whA);
  assert.strictEqual(ok.pharmacy.nameEn, 'Pharmacy A');
});

// ---------------------------------------------------------------------------
// Admin: list, respond, status (Sections 8-10, 16)
// ---------------------------------------------------------------------------

test('admin sees every complaint with per-status counts', async () => {
  const { rows, counts } = await adminComplaintService.listComplaints({});
  assert.ok(rows.length >= 3);
  assert.ok(counts.all >= 3);
  assert.strictEqual(counts.all, await Complaint.countDocuments({}));
  assert.ok('pending' in counts && 'in_review' in counts && 'resolved' in counts && 'closed' in counts);

  const filtered = await adminComplaintService.listComplaints({ status: 'pending' });
  assert.ok(filtered.rows.every((r) => r.complaint.status === 'pending'));
});

test('admin list rows carry the derived contextType (Section 11)', async () => {
  const complaintViewModel = require('../src/viewmodels/complaint.viewmodel');
  const { rows, counts } = await adminComplaintService.listComplaints({ limit: 100 });
  const payload = complaintViewModel.toAdminComplaintListResponse(rows, counts).complaints;
  const byId = new Map(payload.map((c) => [String(c.id), c]));
  assert.strictEqual(byId.get(String(ids.generalComplaint)).contextType, 'general');
  assert.strictEqual(byId.get(String(ids.orderComplaint)).contextType, 'order');
  assert.strictEqual(byId.get(String(ids.orderComplaint)).warehouse.nameEn, 'Warehouse A');
  assert.strictEqual(byId.get(String(ids.orderComplaint)).relatedOrderNumber, ids.orderNumber);
  assert.strictEqual(byId.get(String(ids.generalComplaint)).warehouse, null);
  assert.strictEqual(byId.get(String(ids.generalComplaint)).relatedOrderNumber, null);
});

test('admin responding to a complaint resolves it, records the responder, and notifies only that pharmacy', async () => {
  await Notification.deleteMany({});
  const updated = await adminComplaintService.respondToComplaint(ids.complaintA.toString(), ids.adminUser, {
    response: '  We have refunded the delivery fee.  ',
  });

  assert.strictEqual(updated.status, 'resolved');
  assert.strictEqual(updated.adminResponse, 'We have refunded the delivery fee.');
  assert.strictEqual(String(updated.respondedByAdminId), String(ids.adminUser));
  assert.ok(updated.respondedAt instanceof Date);

  const rows = await Notification.find({}).lean();
  assert.strictEqual(rows.length, 1, 'exactly one notification is written');
  assert.strictEqual(String(rows[0].userId), String(ids.phUserA), 'to the filing pharmacy only');
  assert.strictEqual(rows[0].type, 'complaint');
  assert.strictEqual(String(rows[0].relatedComplaintId), String(ids.complaintA));
});

test('an empty admin response is rejected', async () => {
  await assert.rejects(
    () => adminComplaintService.respondToComplaint(ids.complaintA.toString(), ids.adminUser, { response: '   ' }),
    withCode('COMPLAINT_RESPONSE_REQUIRED')
  );
});

test('admin status transitions are validated and applied', async () => {
  await assert.rejects(
    () => adminComplaintService.updateComplaintStatus(ids.complaintA.toString(), ids.adminUser, 'banana'),
    withCode('COMPLAINT_INVALID_STATUS')
  );

  const closed = await adminComplaintService.updateComplaintStatus(
    ids.complaintA.toString(), ids.adminUser, 'closed'
  );
  assert.strictEqual(closed.status, 'closed');

  const reopened = await adminComplaintService.updateComplaintStatus(
    ids.complaintA.toString(), ids.adminUser, 'in_review'
  );
  assert.strictEqual(reopened.status, 'in_review');
});

test('a status change alone writes no notification', async () => {
  await Notification.deleteMany({});
  await adminComplaintService.updateComplaintStatus(ids.complaintA.toString(), ids.adminUser, 'resolved');
  assert.strictEqual(await Notification.countDocuments({}), 0);
});

test('the admin detail view carries pharmacy, warehouse and responder context', async () => {
  // complaintA is a WAREHOUSE-context complaint - warehouse present, no order.
  const row = await adminComplaintService.getComplaint(ids.complaintA.toString());
  assert.strictEqual(row.pharmacy.nameEn, 'Pharmacy A');
  assert.strictEqual(row.warehouse.nameEn, 'Warehouse A');
  assert.strictEqual(row.responder.name, 'Admin');
  assert.strictEqual(row.relatedOrder, null);

  // the ORDER-context complaint additionally resolves the order.
  const orderRow = await adminComplaintService.getComplaint(ids.orderComplaint.toString());
  assert.strictEqual(orderRow.warehouse.nameEn, 'Warehouse A');
  assert.strictEqual(orderRow.relatedOrder.orderNumber, ids.orderNumber);

  // the GENERAL complaint resolves neither.
  const generalRow = await adminComplaintService.getComplaint(ids.generalComplaint.toString());
  assert.strictEqual(generalRow.warehouse, null);
  assert.strictEqual(generalRow.relatedOrder, null);
});

test('complaint numbers are sequential and unique', async () => {
  const all = await Complaint.find({}).sort({ complaintNumber: 1 }).lean();
  const numbers = all.map((c) => c.complaintNumber);
  assert.deepStrictEqual(numbers, [...new Set(numbers)], 'no duplicates');
  for (let i = 1; i < numbers.length; i += 1) {
    assert.ok(numbers[i] > numbers[i - 1], 'strictly increasing');
  }
});

test('Section 14: "complaints for this order" query is an index scan, not a collection scan', async () => {
  await Complaint.syncIndexes();
  const cursor = new mongoose.Types.ObjectId();
  const explain = await Complaint.find({ relatedOrderId: ids.orderId, _id: { $lt: cursor } })
    .sort({ _id: -1 })
    .limit(15)
    .explain('executionStats');
  const flat = JSON.stringify(explain.queryPlanner.winningPlan);
  assert.ok(flat.includes('IXSCAN'), 'must use an index');
  assert.ok(!flat.includes('COLLSCAN'), 'must not fall back to a collection scan');
  assert.ok(!flat.includes('"stage":"SORT"'), 'the index also covers the newest-first order');
  assert.match(flat, /relatedOrderId_1__id_-1/, 'uses the { relatedOrderId, _id } index');
});

// ---------------------------------------------------------------------------
// Concurrency: two simultaneous responses to the same complaint (Section 10)
// ---------------------------------------------------------------------------

test('two simultaneous responses: exactly one wins, one 409s, one notification', async () => {
  await Notification.deleteMany({});

  const [adminOne, adminTwo] = await User.create([
    { name: 'Admin One', phone: '0939000010', role: 'admin', status: 'active' },
    { name: 'Admin Two', phone: '0939000011', role: 'admin', status: 'active' },
  ]);

  // A fresh, unanswered complaint.
  const complaint = await complaintService.createComplaint({
    pharmacyId: ids.pharmA,
    pharmacyUserId: ids.phUserA,
    warehouseId: ids.whA.toString(),
    subject: 'Race target',
    description: 'Two admins answer this at the same instant.',
  });
  const cid = complaint._id.toString();

  // Fire both response requests concurrently, each with a distinct admin and
  // reply text, so we can prove which one actually landed.
  const settled = await Promise.allSettled([
    adminComplaintService.respondToComplaint(cid, adminOne._id, {
      response: 'Handled by admin one.',
      status: 'resolved',
    }),
    adminComplaintService.respondToComplaint(cid, adminTwo._id, {
      response: 'Handled by admin two.',
      status: 'closed',
    }),
  ]);

  const fulfilled = settled.filter((r) => r.status === 'fulfilled');
  const rejected = settled.filter((r) => r.status === 'rejected');
  assert.strictEqual(fulfilled.length, 1, 'exactly one response request succeeds');
  assert.strictEqual(rejected.length, 1, 'exactly one response request fails');
  assert.strictEqual(
    rejected[0].reason.code,
    'COMPLAINT_ALREADY_RESPONDED',
    'the loser gets the already-responded conflict, not a 500'
  );
  assert.strictEqual(rejected[0].reason.statusCode, 409);

  const winner = fulfilled[0].value;

  // The complaint carries exactly one final response - the winner's.
  const stored = await Complaint.findById(cid).lean();
  assert.strictEqual(stored.adminResponse, winner.adminResponse);
  assert.strictEqual(String(stored.respondedByAdminId), String(winner.respondedByAdminId));
  assert.ok(
    [String(adminOne._id), String(adminTwo._id)].includes(String(stored.respondedByAdminId)),
    'respondedByAdminId belongs to one of the two racing admins'
  );
  assert.ok(stored.respondedAt instanceof Date, 'respondedAt is set exactly once');
  assert.strictEqual(
    stored.status,
    winner.status,
    'the status is the winner\'s target, not a mix of both'
  );

  // Exactly one notification, to the filing pharmacy, for this complaint.
  const notifications = await Notification.find({ relatedComplaintId: complaint._id }).lean();
  assert.strictEqual(notifications.length, 1, 'no duplicate notification from the losing request');
  assert.strictEqual(String(notifications[0].userId), String(ids.phUserA));
  assert.strictEqual(notifications[0].type, 'complaint');
  assert.strictEqual(
    await Notification.countDocuments({}),
    1,
    'the whole run generated exactly one notification'
  );
});

test('a status-only change on an unanswered complaint leaves it answerable, and sends nothing', async () => {
  await Notification.deleteMany({});

  const complaint = await complaintService.createComplaint({
    pharmacyId: ids.pharmA,
    pharmacyUserId: ids.phUserA,
    warehouseId: ids.whA.toString(),
    subject: 'Status first, then reply',
    description: 'Admin marks it in_review before writing anything.',
  });
  const cid = complaint._id.toString();

  const moved = await adminComplaintService.updateComplaintStatus(cid, ids.adminUser, 'in_review');
  assert.strictEqual(moved.status, 'in_review');
  const afterStatus = await Complaint.findById(cid).lean();
  assert.strictEqual(afterStatus.respondedAt, null, 'a status change must not mark the complaint responded');
  assert.strictEqual(afterStatus.adminResponse, null);
  assert.strictEqual(await Notification.countDocuments({}), 0, 'a status change alone notifies nobody');

  // The response path still works afterwards - the atomic guard still matched.
  const answered = await adminComplaintService.respondToComplaint(cid, ids.adminUser, {
    response: 'Now here is the actual answer.',
  });
  assert.strictEqual(answered.adminResponse, 'Now here is the actual answer.');
  assert.strictEqual(answered.status, 'resolved', 'answering an in_review complaint resolves it');
  assert.strictEqual(await Notification.countDocuments({ relatedComplaintId: complaint._id }), 1);

  // And a second attempt is now refused.
  await assert.rejects(
    () => adminComplaintService.respondToComplaint(cid, ids.adminUser, { response: 'again' }),
    withCode('COMPLAINT_ALREADY_RESPONDED')
  );
});
