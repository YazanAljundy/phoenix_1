const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const Pharmacy = require('../models/pharmacy.model');
const reviewService = require('../services/review.service');
const reviewViewModel = require('../viewmodels/review.viewmodel');

async function loadPharmacyOrThrow(userId) {
  const pharmacy = await Pharmacy.findOne({ userId });
  if (!pharmacy) {
    throw ApiError.notFound('Pharmacy profile not found.', 'PHARMACY_NOT_FOUND');
  }
  return pharmacy;
}

const list = asyncHandler(async (req, res) => {
  const pharmacy = await loadPharmacyOrThrow(req.user._id);
  const result = await reviewService.listReviewsForPharmacy(pharmacy._id);
  res.json({ success: true, ...reviewViewModel.toReviewsResponse(result) });
});

module.exports = { list };
