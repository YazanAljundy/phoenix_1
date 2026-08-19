const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const Warehouse = require('../models/warehouse.model');
const paymentService = require('../services/payment.service');
const paymentViewModel = require('../viewmodels/payment.viewmodel');

async function loadWarehouseOrThrow(userId) {
  const warehouse = await Warehouse.findOne({ userId });
  if (!warehouse) {
    throw ApiError.notFound('Warehouse profile not found.', 'WAREHOUSE_PROFILE_NOT_FOUND');
  }
  return warehouse;
}

const create = asyncHandler(async (req, res) => {
  const warehouse = await loadWarehouseOrThrow(req.user._id);
  const payment = await paymentService.createPayment(warehouse._id, req.user._id, req.body);
  res.status(201).json({
    success: true,
    message: 'Payment recorded.',
    ...paymentViewModel.toPaymentResponse(payment),
  });
});

const update = asyncHandler(async (req, res) => {
  const warehouse = await loadWarehouseOrThrow(req.user._id);
  const payment = await paymentService.updatePayment(req.params.id, warehouse._id, req.body);
  res.json({
    success: true,
    message: 'Payment updated.',
    ...paymentViewModel.toPaymentResponse(payment),
  });
});

const remove = asyncHandler(async (req, res) => {
  const warehouse = await loadWarehouseOrThrow(req.user._id);
  await paymentService.deletePayment(req.params.id, warehouse._id);
  res.json({ success: true, message: 'Payment removed.' });
});

module.exports = { create, update, remove };
