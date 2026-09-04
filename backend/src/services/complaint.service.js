const mongoose = require('mongoose');
const { ApiError } = require('../utils/ApiError');
const Complaint = require('../models/complaint.model');
const Counter = require('../models/counter.model');
const Order = require('../models/order.model');
const Warehouse = require('../models/warehouse.model');
const Pharmacy = require('../models/pharmacy.model');
const User = require('../models/user.model');
const { isWarehouseAvailable } = require('./warehouse.service');
const { emitToWarehouse, emitToAdmins, EVENTS } = require('../realtime');

const COMPLAINTS_DEFAULT_LIMIT = 15;
const SUBJECT_MAX = 200;
const DESCRIPTION_MAX = 5000;
const EXTRA_DETAILS_MAX = 2000;

// Same atomic sequence issuance as order.service.js's nextOrderNumber - one
// counters document, $inc, upsert, safe under concurrent creation.
async function nextComplaintNumber() {
  const counter = await Counter.findOneAndUpdate(
    { _id: 'complaint_number' },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );
  return counter.seq;
}

// Trim + "must not be only whitespace" + length cap, shared by subject and
// description (Section 2's validation rules). Returns the trimmed value.
function requireText(value, { field, code, max }) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) {
    throw ApiError.badRequest(`${field} is required.`, undefined, code);
  }
  if (trimmed.length > max) {
    throw ApiError.badRequest(
      `${field} must be at most ${max} characters.`,
      { max },
      `${code}_TOO_LONG`
    );
  }
  return trimmed;
}

function cleanOptionalExtra(extraDetails) {
  if (typeof extraDetails !== 'string' || !extraDetails.trim()) return null;
  const trimmed = extraDetails.trim();
  if (trimmed.length > EXTRA_DETAILS_MAX) {
    throw ApiError.badRequest(
      `Additional details must be at most ${EXTRA_DETAILS_MAX} characters.`,
      { max: EXTRA_DETAILS_MAX },
      'COMPLAINT_EXTRA_TOO_LONG'
    );
  }
  return trimmed;
}

// Section 4/7: resolves the warehouse this complaint is against from the
// CONTEXT the client sent - never trusting warehouse/order details blindly.
//
//   order context    -> the order is looked up, checked to belong to THIS
//                        pharmacy, and its own warehouseId is what gets stored
//                        (a client-sent warehouseId that disagrees is a hard
//                        error, not silently corrected - Section 5).
//   warehouse context-> the warehouse id is re-validated against the same
//                        availability rule the rest of the app uses.
//   general context  -> nothing to resolve.
async function resolveContext({ pharmacyId, warehouseId, relatedOrderId }) {
  // --- order context ------------------------------------------------------
  if (relatedOrderId !== undefined && relatedOrderId !== null && relatedOrderId !== '') {
    if (typeof relatedOrderId !== 'string' || !mongoose.Types.ObjectId.isValid(relatedOrderId)) {
      throw ApiError.notFound('Order not found.', 'COMPLAINT_ORDER_NOT_FOUND');
    }
    // Scoped to pharmacyId: an order that exists but belongs to another
    // pharmacy is a 404 here, exactly like getOrderForPharmacy - a pharmacy
    // can never attach a complaint to someone else's order.
    const order = await Order.findOne({ _id: relatedOrderId, pharmacyId })
      .select('_id orderNumber warehouseId')
      .lean();
    if (!order) {
      throw ApiError.notFound('Order not found.', 'COMPLAINT_ORDER_NOT_FOUND');
    }
    // Section 5: never reconcile a contradiction silently.
    if (
      typeof warehouseId === 'string' &&
      warehouseId &&
      String(warehouseId) !== String(order.warehouseId)
    ) {
      throw ApiError.badRequest(
        'The order and warehouse in this complaint do not match.',
        undefined,
        'COMPLAINT_CONTEXT_MISMATCH'
      );
    }
    const warehouse = await Warehouse.findById(order.warehouseId).select('_id userId').lean();
    return {
      warehouseId: order.warehouseId,
      warehouseUserId: warehouse ? warehouse.userId : null,
      relatedOrderId: order._id,
      relatedOrderNumber: order.orderNumber,
    };
  }

  // --- warehouse context -------------------------------------------------
  if (warehouseId !== undefined && warehouseId !== null && warehouseId !== '') {
    if (typeof warehouseId !== 'string' || !mongoose.Types.ObjectId.isValid(warehouseId)) {
      throw ApiError.badRequest('Invalid warehouse.', undefined, 'COMPLAINT_INVALID_WAREHOUSE');
    }
    const available = await isWarehouseAvailable(warehouseId);
    if (!available) {
      throw ApiError.notFound('This warehouse is not available.', 'WAREHOUSE_NOT_FOUND');
    }
    const warehouse = await Warehouse.findById(warehouseId).select('_id userId').lean();
    return {
      warehouseId: warehouse._id,
      warehouseUserId: warehouse.userId,
      relatedOrderId: null,
      relatedOrderNumber: null,
    };
  }

  // --- general context -------------------------------------------------
  return { warehouseId: null, warehouseUserId: null, relatedOrderId: null, relatedOrderNumber: null };
}

// Section 1-7: the pharmacy files a complaint. Its TYPE is decided entirely by
// the context the client sent (`warehouseId` / `relatedOrderId` / neither) -
// there is no "complaint type" field. `pharmacyId`/`pharmacyUserId` always come
// from the authenticated user (the controller), never the body.
async function createComplaint({
  pharmacyId,
  pharmacyUserId,
  warehouseId,
  relatedOrderId,
  subject,
  description,
  extraDetails,
}) {
  const cleanSubject = requireText(subject, {
    field: 'Subject',
    code: 'COMPLAINT_SUBJECT_REQUIRED',
    max: SUBJECT_MAX,
  });
  const cleanDescription = requireText(description, {
    field: 'Description',
    code: 'COMPLAINT_DESCRIPTION_REQUIRED',
    max: DESCRIPTION_MAX,
  });
  const cleanExtra = cleanOptionalExtra(extraDetails);

  const context = await resolveContext({ pharmacyId, warehouseId, relatedOrderId });

  const complaintNumber = await nextComplaintNumber();

  const complaint = await Complaint.create({
    complaintNumber,
    pharmacyId,
    pharmacyUserId,
    warehouseId: context.warehouseId,
    warehouseUserId: context.warehouseUserId,
    subject: cleanSubject,
    description: cleanDescription,
    relatedOrderId: context.relatedOrderId,
    relatedOrderNumber: context.relatedOrderNumber,
    extraDetails: cleanExtra,
  });

  // The admin triage queue always gets the signal. The warehouse room only
  // gets it when a warehouse is actually involved (warehouse/order context) -
  // emitToWarehouse(null, ...) is a guarded no-op for a general complaint.
  const payload = {
    complaintId: complaint._id.toString(),
    complaintNumber: complaint.complaintNumber,
    warehouseId: complaint.warehouseId ? complaint.warehouseId.toString() : null,
    status: complaint.status,
  };
  emitToAdmins(EVENTS.COMPLAINT_CREATED, payload);
  if (complaint.warehouseId) {
    emitToWarehouse(complaint.warehouseId, EVENTS.COMPLAINT_CREATED, payload);
  }

  return complaint;
}

// --- Read helpers shared with the warehouse/admin services ------------------

// Batch-loads the warehouse, pharmacy and related-order rows a page of
// complaints references, and returns a { complaint, warehouse, pharmacy,
// relatedOrder } row per complaint - no query per row (Section 15's N+1 rule).
async function attachComplaintContext(complaints, { withPharmacy = false } = {}) {
  if (complaints.length === 0) return [];

  // warehouseId is null for a general complaint - only the ones that have a
  // warehouse contribute an id to look up.
  const warehouseIds = [
    ...new Set(complaints.filter((c) => c.warehouseId).map((c) => c.warehouseId.toString())),
  ];
  const orderIds = [
    ...new Set(complaints.filter((c) => c.relatedOrderId).map((c) => c.relatedOrderId.toString())),
  ];
  const pharmacyIds = withPharmacy
    ? [...new Set(complaints.map((c) => c.pharmacyId.toString()))]
    : [];

  const [warehouses, orders, pharmacies] = await Promise.all([
    Warehouse.find({ _id: { $in: warehouseIds } })
      .select('_id nameAr nameEn phone city address logo')
      .lean(),
    orderIds.length
      ? Order.find({ _id: { $in: orderIds } })
          .select('_id orderNumber deliverySealPhoto deliverySealConfirmedAt')
          .lean()
      : Promise.resolve([]),
    pharmacyIds.length
      ? Pharmacy.find({ _id: { $in: pharmacyIds } })
          .select('_id nameAr nameEn phone city address ownerName')
          .lean()
      : Promise.resolve([]),
  ]);

  const warehouseById = new Map(warehouses.map((w) => [w._id.toString(), w]));
  const orderById = new Map(orders.map((o) => [o._id.toString(), o]));
  const pharmacyById = new Map(pharmacies.map((p) => [p._id.toString(), p]));

  return complaints.map((complaint) => ({
    complaint,
    warehouse: complaint.warehouseId
      ? warehouseById.get(complaint.warehouseId.toString()) ?? null
      : null,
    pharmacy: withPharmacy ? pharmacyById.get(complaint.pharmacyId.toString()) ?? null : null,
    relatedOrder: complaint.relatedOrderId
      ? orderById.get(complaint.relatedOrderId.toString()) ?? null
      : null,
  }));
}

// Cursor pagination on `_id` descending - identical shape to
// return.service.js's listReturnsForPharmacy. `_id` doubles as the newest-
// first sort key and the cursor, so no separate createdAt index is needed for
// this path (the { pharmacyId, createdAt } compound index still covers the
// filter + ordering).
async function paginateComplaints(filter, { limit = COMPLAINTS_DEFAULT_LIMIT, after = null }, attachOpts) {
  const query = { ...filter };
  if (after) query._id = { $lt: after };

  const rows = await Complaint.find(query).sort({ _id: -1 }).limit(limit + 1).lean();
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = page.length > 0 ? page[page.length - 1]._id.toString() : null;

  const contextRows = await attachComplaintContext(page, attachOpts);
  return { rows: contextRows, hasMore, nextCursor };
}

// Section 6: a pharmacy sees only its own complaints - the filter is the
// pharmacy resolved from the JWT, never anything the client sent.
async function listComplaintsForPharmacy(pharmacyId, opts = {}) {
  return paginateComplaints({ pharmacyId }, opts, { withPharmacy: false });
}

// IDOR guard: a complaint the caller's own pharmacy doesn't own is a 404, not
// a 403 - same "doesn't exist as far as you're concerned" shape as
// return.service.js.
async function getComplaintForPharmacy(complaintId, pharmacyId) {
  if (!mongoose.Types.ObjectId.isValid(complaintId)) {
    throw ApiError.notFound('Complaint not found.', 'COMPLAINT_NOT_FOUND');
  }
  const complaint = await Complaint.findOne({ _id: complaintId, pharmacyId }).lean();
  if (!complaint) {
    throw ApiError.notFound('Complaint not found.', 'COMPLAINT_NOT_FOUND');
  }
  const [row] = await attachComplaintContext([complaint], { withPharmacy: false });
  const responder = await loadResponder(complaint);
  return { ...row, responder };
}

// The admin who answered, for "responded by" on the detail screens. Null
// while unanswered.
async function loadResponder(complaint) {
  if (!complaint.respondedByAdminId) return null;
  return User.findById(complaint.respondedByAdminId).select('_id name').lean();
}

module.exports = {
  createComplaint,
  listComplaintsForPharmacy,
  getComplaintForPharmacy,
  attachComplaintContext,
  paginateComplaints,
  loadResponder,
  COMPLAINTS_DEFAULT_LIMIT,
};
