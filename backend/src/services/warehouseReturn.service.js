const mongoose = require('mongoose');
const { ApiError } = require('../utils/ApiError');
const Return = require('../models/return.model');
const Order = require('../models/order.model');
const Pharmacy = require('../models/pharmacy.model');
const { createOrder } = require('./order.service');
const { attachOrderContext } = require('./return.service');

const WAREHOUSE_RETURNS_DEFAULT_LIMIT = 15;

function validateStatusFilter(status) {
  if (status && !Return.schema.path('status').enumValues.includes(status)) {
    throw ApiError.badRequest('Invalid status filter.', undefined, 'INVALID_STATUS_FILTER');
  }
}

async function attachContextAndPharmacy(returns) {
  const [withOrderContext, pharmacies] = await Promise.all([
    attachOrderContext(returns),
    Pharmacy.find({ _id: { $in: [...new Set(returns.map((r) => r.pharmacyId.toString()))] } }),
  ]);
  const pharmacyById = new Map(pharmacies.map((p) => [p._id.toString(), p]));

  return withOrderContext.map((row) => ({
    ...row,
    pharmacy: pharmacyById.get(row.returnRequest.pharmacyId.toString()) ?? null,
  }));
}

// Section 13b: the warehouse's own return queue - every return for its
// warehouse (not just pending), same shape as listOffersForWarehouse: the
// action queue and the history are the same list, filtered client-side.
async function listReturnsForWarehouse(warehouseId, status) {
  validateStatusFilter(status);
  const filter = { warehouseId };
  if (status) filter.status = status;

  const returns = await Return.find(filter).sort({ createdAt: 1 });
  if (returns.length === 0) return [];

  return attachContextAndPharmacy(returns);
}

// The Returns management page (unlike the callers of the unpaginated
// listReturnsForWarehouse above - WarehouseOrderDetailPage's "does this
// order already have a pending return" lookup, which needs every return)
// wants newest-first with "Load more". An ObjectId's embedded timestamp
// makes `_id` descending equivalent to `createdAt` descending.
async function listPaginatedReturnsForWarehouse(
  warehouseId,
  status,
  { limit = WAREHOUSE_RETURNS_DEFAULT_LIMIT, after = null } = {}
) {
  validateStatusFilter(status);
  const filter = { warehouseId };
  if (status) filter.status = status;
  if (after !== null) {
    filter._id = { $lt: after };
  }

  const returns = await Return.find(filter).sort({ _id: -1 }).limit(limit + 1);
  const hasMore = returns.length > limit;
  const page = hasMore ? returns.slice(0, limit) : returns;
  const nextCursor = page.length > 0 ? String(page[page.length - 1]._id) : null;

  if (page.length === 0) return { rows: [], hasMore: false, nextCursor: null };

  const rows = await attachContextAndPharmacy(page);
  return { rows, hasMore, nextCursor };
}

async function loadPendingReturnOrThrow(returnId, warehouseId) {
  if (!mongoose.Types.ObjectId.isValid(returnId)) {
    throw ApiError.notFound('Return not found.', 'RETURN_NOT_FOUND');
  }
  const returnRequest = await Return.findOne({ _id: returnId, warehouseId, status: 'pending' });
  if (!returnRequest) {
    throw ApiError.notFound('Return not found.', 'RETURN_NOT_FOUND');
  }
  return returnRequest;
}

// IDOR guard: scoped to warehouseId, same pattern as loadPendingReturnOrThrow
// above - but any status, not just pending, since the detail page also needs
// to show an already-approved/rejected return's final state.
async function findOwnReturnOrThrow(returnId, warehouseId) {
  if (!mongoose.Types.ObjectId.isValid(returnId)) {
    throw ApiError.notFound('Return not found.', 'RETURN_NOT_FOUND');
  }
  const returnRequest = await Return.findOne({ _id: returnId, warehouseId });
  if (!returnRequest) {
    throw ApiError.notFound('Return not found.', 'RETURN_NOT_FOUND');
  }
  return returnRequest;
}

// Read-only detail - reuses the same attachOrderContext (order/item
// snapshots) and pharmacy lookup as listReturnsForWarehouse above, plus the
// replacement order's number when one exists (only set once approved).
async function getReturnDetailForWarehouse(returnId, warehouseId) {
  const returnRequest = await findOwnReturnOrThrow(returnId, warehouseId);

  const [contextRows, pharmacy, replacementOrder] = await Promise.all([
    attachOrderContext([returnRequest]),
    Pharmacy.findById(returnRequest.pharmacyId),
    returnRequest.replacementOrderId
      ? Order.findById(returnRequest.replacementOrderId, 'orderNumber')
      : Promise.resolve(null),
  ]);
  const { order, orderItemById } = contextRows[0];

  return { returnRequest, order, orderItemById, pharmacy, replacementOrder };
}

// Section 6.9/8: approving always means "replace, at no extra charge" - no
// "refund" (meaningless under COD). Creates a brand-new order through the
// exact same order-creation path a normal order uses, just zero-priced, with
// the pharmacist's own returned items/quantities.
async function approveReturn(returnId, warehouseId, userId) {
  const returnRequest = await loadPendingReturnOrThrow(returnId, warehouseId);
  const originalOrder = await Order.findById(returnRequest.orderId);

  const replacementOrder = await createOrder({
    userId,
    pharmacyId: returnRequest.pharmacyId,
    warehouseId,
    items: returnRequest.items.map((item) => ({
      productId: item.productId.toString(),
      quantity: item.quantity,
    })),
    notes: `Replacement for return on order #${originalOrder?.orderNumber ?? ''}`,
    isReplacement: true,
  });

  returnRequest.status = 'approved';
  returnRequest.replacementOrderId = replacementOrder._id;
  returnRequest.resolvedBy = userId;
  returnRequest.resolvedAt = new Date();
  await returnRequest.save();

  return { returnRequest, replacementOrder };
}

async function rejectReturn(returnId, warehouseId, userId, rejectionNote) {
  const returnRequest = await loadPendingReturnOrThrow(returnId, warehouseId);

  const trimmedNote = typeof rejectionNote === 'string' ? rejectionNote.trim() : '';
  if (!trimmedNote) {
    throw ApiError.badRequest(
      'Please explain why this return is being rejected.',
      undefined,
      'REJECTION_NOTE_REQUIRED'
    );
  }

  returnRequest.status = 'rejected';
  returnRequest.rejectionNote = trimmedNote;
  returnRequest.resolvedBy = userId;
  returnRequest.resolvedAt = new Date();
  await returnRequest.save();

  return returnRequest;
}

module.exports = {
  listReturnsForWarehouse,
  listPaginatedReturnsForWarehouse,
  approveReturn,
  rejectReturn,
  getReturnDetailForWarehouse,
};
