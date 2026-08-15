const mongoose = require('mongoose');
const { ApiError } = require('../utils/ApiError');
const Return = require('../models/return.model');
const Order = require('../models/order.model');
const Pharmacy = require('../models/pharmacy.model');
const { createOrder } = require('./order.service');
const { attachOrderContext } = require('./return.service');

// Section 13b: the warehouse's own return queue - every return for its
// warehouse (not just pending), same shape as listOffersForWarehouse: the
// action queue and the history are the same list, filtered client-side.
async function listReturnsForWarehouse(warehouseId, status) {
  const filter = { warehouseId };
  if (status) {
    if (!Return.schema.path('status').enumValues.includes(status)) {
      throw ApiError.badRequest('Invalid status filter.', undefined, 'INVALID_STATUS_FILTER');
    }
    filter.status = status;
  }

  const returns = await Return.find(filter).sort({ createdAt: 1 });
  if (returns.length === 0) return [];

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

module.exports = { listReturnsForWarehouse, approveReturn, rejectReturn };
