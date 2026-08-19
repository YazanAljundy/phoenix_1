const mongoose = require('mongoose');
const { ApiError } = require('../utils/ApiError');
const Payment = require('../models/payment.model');
const Pharmacy = require('../models/pharmacy.model');
const { recomputeBalance } = require('./pharmacyBalance.service');

const EDIT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes, exactly

const CURRENCIES = ['USD', 'SYP'];

function validateAmount(amount) {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    throw ApiError.badRequest('Invalid payment amount.', undefined, 'INVALID_PAYMENT_AMOUNT');
  }
}

function validateCurrency(currency) {
  if (!CURRENCIES.includes(currency)) {
    throw ApiError.badRequest('Invalid currency.', undefined, 'INVALID_PAYMENT_CURRENCY');
  }
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

function assertWithinEditWindow(payment) {
  if (payment.canEditUntil <= new Date()) {
    throw ApiError.forbidden(
      'This payment can no longer be edited - the 5-minute window has expired.',
      'PAYMENT_EDIT_WINDOW_EXPIRED'
    );
  }
}

async function createPayment(warehouseId, recordedByUserId, data) {
  await validatePharmacyId(data.pharmacyId);
  validateAmount(data.amount);
  validateCurrency(data.currency);

  const now = new Date();
  const payment = await Payment.create({
    pharmacyId: data.pharmacyId,
    warehouseId,
    amount: data.amount,
    currency: data.currency,
    note: normalizeNote(data.note),
    recordedBy: recordedByUserId,
    canEditUntil: new Date(now.getTime() + EDIT_WINDOW_MS),
  });

  await recomputeBalance(payment.pharmacyId, warehouseId);
  return payment;
}

async function updatePayment(id, warehouseId, changes) {
  const payment = await findOwnedPaymentOrThrow(id, warehouseId);
  assertWithinEditWindow(payment);

  validateAmount(changes.amount);
  validateCurrency(changes.currency);

  payment.amount = changes.amount;
  payment.currency = changes.currency;
  payment.note = normalizeNote(changes.note);
  await payment.save();

  await recomputeBalance(payment.pharmacyId, warehouseId);
  return payment;
}

async function deletePayment(id, warehouseId) {
  const payment = await findOwnedPaymentOrThrow(id, warehouseId);
  assertWithinEditWindow(payment);

  await payment.deleteOne();
  await recomputeBalance(payment.pharmacyId, warehouseId);
}

module.exports = { createPayment, updatePayment, deletePayment };
