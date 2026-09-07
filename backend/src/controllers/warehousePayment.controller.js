const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const Warehouse = require('../models/warehouse.model');
const paymentService = require('../services/payment.service');
const paymentViewModel = require('../viewmodels/payment.viewmodel');

// Money-Flow V2. Payments are append-only: this controller exposes recording
// and reversing, and nothing else. The V1 update/delete handlers are gone -
// see payment.service.js for why.

async function loadWarehouseOrThrow(userId) {
  const warehouse = await Warehouse.findOne({ userId });
  if (!warehouse) {
    throw ApiError.notFound('Warehouse profile not found.', 'WAREHOUSE_PROFILE_NOT_FOUND');
  }
  return warehouse;
}

// A client-generated UUID. A retried request carrying the same key returns the
// payment the first attempt created rather than crediting the pharmacy twice.
function parseIdempotencyKey(value, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) {
      throw ApiError.badRequest(
        'An idempotency key is required.',
        undefined,
        'IDEMPOTENCY_KEY_REQUIRED'
      );
    }
    return null;
  }
  if (typeof value !== 'string' || value.length > 100) {
    throw ApiError.badRequest('Invalid idempotency key.', undefined, 'INVALID_IDEMPOTENCY_KEY');
  }
  return value;
}

// A replay returns 200 rather than 201 and says so in a header, so the client
// can tell "already recorded" from "just recorded".
function respond(res, payment, { createdStatus = 201, message }) {
  const isReplay = Boolean(payment.$locals && payment.$locals.idempotentReplay);
  if (isReplay) res.set('Idempotent-Replay', 'true');
  res.status(isReplay ? 200 : createdStatus).json({
    success: true,
    message,
    ...paymentViewModel.toPaymentResponse(payment),
  });
}

const create = asyncHandler(async (req, res) => {
  const warehouse = await loadWarehouseOrThrow(req.user._id);
  const payment = await paymentService.createPayment(warehouse._id, req.user._id, {
    ...req.body,
    idempotencyKey: parseIdempotencyKey(req.body.idempotencyKey),
  });
  respond(res, payment, { message: 'Payment recorded.' });
});

// Reversal replaces the V1 edit/delete pair. A reason is mandatory and is
// stored on both payments and in the financial audit log.
const reverse = asyncHandler(async (req, res) => {
  const warehouse = await loadWarehouseOrThrow(req.user._id);
  const reversal = await paymentService.reversePayment(req.params.id, warehouse._id, req.user._id, {
    reason: req.body.reason,
    idempotencyKey: parseIdempotencyKey(req.body.idempotencyKey),
  });
  respond(res, reversal, { createdStatus: 201, message: 'Payment reversed.' });
});

module.exports = { create, reverse };
