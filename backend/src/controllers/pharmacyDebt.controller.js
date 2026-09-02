const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const Pharmacy = require('../models/pharmacy.model');
const balanceService = require('../services/pharmacyBalance.service');
const balanceViewModel = require('../viewmodels/pharmacyBalance.viewmodel');

async function loadPharmacyOrThrow(userId) {
  // Runs on every order/return/review/debt request and only ever yields
  // `pharmacy._id` to its callers, so neither the rest of the document nor
  // Mongoose hydration is needed.
  const pharmacy = await Pharmacy.findOne({ userId }).select('_id').lean();
  if (!pharmacy) {
    throw ApiError.notFound('Pharmacy profile not found.', 'PHARMACY_NOT_FOUND');
  }
  return pharmacy;
}

const list = asyncHandler(async (req, res) => {
  const pharmacy = await loadPharmacyOrThrow(req.user._id);
  const rows = await balanceService.listDebtsForPharmacy(pharmacy._id);
  res.json({ success: true, ...balanceViewModel.toDebtListResponse(rows) });
});

// Read-only - the pharmacist has no endpoints to create/edit/delete a
// payment, only the warehouse that recorded it does (warehousePayment
// routes).
const getOne = asyncHandler(async (req, res) => {
  const pharmacy = await loadPharmacyOrThrow(req.user._id);
  const detail = await balanceService.getBalanceDetail(pharmacy._id, req.params.warehouseId);
  res.json({ success: true, ...balanceViewModel.toBalanceDetailResponse(detail, 'pharmacy') });
});

module.exports = { list, getOne };
