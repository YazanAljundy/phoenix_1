const mongoose = require('mongoose');
const { ApiError } = require('../utils/ApiError');
const Payment = require('../models/payment.model');
const Pharmacy = require('../models/pharmacy.model');
const { recomputeBalance } = require('./pharmacyBalance.service');

const CURRENCIES = ['USD', 'SYP'];
// SYP is Phoenix's default currency - a request that omits `currency`
// entirely records a Syrian-pound payment. An explicitly wrong value (e.g.
// 'EUR') is still rejected.
const DEFAULT_CURRENCY = 'SYP';

function validateAmount(amount) {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    throw ApiError.badRequest('Invalid payment amount.', undefined, 'INVALID_PAYMENT_AMOUNT');
  }
}

function resolveCurrency(currency) {
  if (currency === undefined || currency === null) return DEFAULT_CURRENCY;
  if (!CURRENCIES.includes(currency)) {
    throw ApiError.badRequest('Invalid currency.', undefined, 'INVALID_PAYMENT_CURRENCY');
  }
  return currency;
}

function normalizeNote(note) {
  return typeof note === 'string' && note.trim() ? note.trim() : null;
}

async function validatePharmacyId(pharmacyId) {
  if (typeof pharmacyId !== 'string' || !mongoose.Types.ObjectId.isValid(pharmacyId)) {
    throw ApiError.badRequest('Invalid pharmacy.', undefined, 'INVALID_PHARMACY');
  }
  const exists = await Pharmacy.exists({ _id: pharmacyId });
  if (!exists) {
    throw ApiError.badRequest('Invalid pharmacy.', undefined, 'INVALID_PHARMACY');
  }
}

// IDOR guard: scoped to warehouseId, same pattern as every other
// warehouse-owned resource in this codebase (e.g. findOwnedDiscountOrThrow) -
// a warehouse can never edit or delete another warehouse's payment.
async function findOwnedPaymentOrThrow(id, warehouseId) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw ApiError.notFound('Payment not found.', 'PAYMENT_NOT_FOUND');
  }
  const payment = await Payment.findOne({ _id: id, warehouseId });
  if (!payment) {
    throw ApiError.notFound('Payment not found.', 'PAYMENT_NOT_FOUND');
  }
  return payment;
}

async function createPayment(warehouseId, recordedByUserId, data) {
  await validatePharmacyId(data.pharmacyId);
  validateAmount(data.amount);
  const currency = resolveCurrency(data.currency);

  const payment = await Payment.create({
    pharmacyId: data.pharmacyId,
    warehouseId,
    amount: data.amount,
    currency,
    note: normalizeNote(data.note),
    recordedBy: recordedByUserId,
  });

  await recomputeBalance(payment.pharmacyId, warehouseId);
  return payment;
}

// A recorded payment can be corrected or removed at any time - it is a manual
// bookkeeping entry, not a system transaction, and the balance is always
// recomputed from scratch afterwards (recomputeBalance), so there is no drift
// to protect against. (The former 5-minute edit window was removed.) The only
// gate is ownership: findOwnedPaymentOrThrow scopes to the caller's warehouse.
async function updatePayment(id, warehouseId, changes) {
  const payment = await findOwnedPaymentOrThrow(id, warehouseId);

  validateAmount(changes.amount);
  payment.amount = changes.amount;
  payment.currency = resolveCurrency(changes.currency);
  payment.note = normalizeNote(changes.note);
  await payment.save();

  await recomputeBalance(payment.pharmacyId, warehouseId);
  return payment;
}

async function deletePayment(id, warehouseId) {
  const payment = await findOwnedPaymentOrThrow(id, warehouseId);

  await payment.deleteOne();
  await recomputeBalance(payment.pharmacyId, warehouseId);
}

module.exports = { createPayment, updatePayment, deletePayment };
