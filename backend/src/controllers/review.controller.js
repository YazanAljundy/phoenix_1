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

const create = asyncHandler(async (req, res) => {
  const pharmacy = await loadPharmacyOrThrow(req.user._id);
  const review = await reviewService.createWarehouseReview(pharmacy._id, req.user._id, req.body);
  res.status(201).json({
    success: true,
    message: 'Rating submitted.',
    ...reviewViewModel.toCreatedReviewResponse(review),
  });
});

module.exports = { list, create };
