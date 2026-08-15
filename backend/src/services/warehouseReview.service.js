const mongoose = require('mongoose');
const { ApiError } = require('../utils/ApiError');
const Review = require('../models/review.model');
const Order = require('../models/order.model');
const Pharmacy = require('../models/pharmacy.model');

// Section 8/13c: reviews the warehouse RECEIVED from pharmacies. Only
// isVisible ones - pharmacy->warehouse reviews start hidden and a separate
// (not-yet-built) cron job flips them visible after a month; that job's
// absence just means this list stays empty until it exists, which is
// correct, not a bug to work around here.
async function listReviewsForWarehouse(warehouseId) {
  const reviews = await Review.find({
    warehouseId,
    reviewerType: 'pharmacy',
    isVisible: true,
  }).sort({ createdAt: -1 });
  if (reviews.length === 0) return { reviews: [], averageRating: 0 };

  const orderIds = [...new Set(reviews.map((r) => r.orderId.toString()))];
  const pharmacyIds = [...new Set(reviews.map((r) => r.pharmacyId.toString()))];
  const [orders, pharmacies] = await Promise.all([
    Order.find({ _id: { $in: orderIds } }, 'orderNumber'),
    Pharmacy.find({ _id: { $in: pharmacyIds } }),
  ]);
  const orderById = new Map(orders.map((o) => [o._id.toString(), o]));
  const pharmacyById = new Map(pharmacies.map((p) => [p._id.toString(), p]));

  const rows = reviews.map((review) => ({
    review,
    order: orderById.get(review.orderId.toString()) ?? null,
    pharmacy: pharmacyById.get(review.pharmacyId.toString()) ?? null,
  }));

  const averageRating = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
  return { reviews: rows, averageRating };
}

function validateRating(rating) {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw ApiError.badRequest('Rating must be a whole number from 1 to 5.', undefined, 'INVALID_RATING');
  }
}

// Section 13b: the warehouse rates the pharmacy once per delivered order -
// visible immediately (unlike the reverse direction), and folds straight
// into the pharmacy's averageRating/reviewsCount (Section 8) rather than
// leaving those to be recomputed elsewhere.
async function createPharmacyReview(warehouseId, userId, { orderId, rating, comment }) {
  if (typeof orderId !== 'string' || !mongoose.Types.ObjectId.isValid(orderId)) {
    throw ApiError.notFound('Order not found.', 'ORDER_NOT_FOUND');
  }
  const order = await Order.findOne({ _id: orderId, warehouseId });
  if (!order) {
    throw ApiError.notFound('Order not found.', 'ORDER_NOT_FOUND');
  }
  if (order.status !== 'delivered') {
    throw ApiError.badRequest('This order has not been delivered yet.', undefined, 'ORDER_NOT_DELIVERED');
  }

  validateRating(rating);

  const existing = await Review.findOne({ orderId: order._id, reviewerType: 'warehouse' });
  if (existing) {
    throw ApiError.conflict('This order has already been rated.', 'ALREADY_REVIEWED');
  }

  const review = await Review.create({
    orderId: order._id,
    pharmacyId: order.pharmacyId,
    warehouseId,
    reviewerType: 'warehouse',
    rating,
    comment: typeof comment === 'string' && comment.trim() ? comment.trim() : null,
    isVisible: true,
  });

  const pharmacy = await Pharmacy.findById(order.pharmacyId);
  const newCount = pharmacy.reviewsCount + 1;
  pharmacy.averageRating = (pharmacy.averageRating * pharmacy.reviewsCount + rating) / newCount;
  pharmacy.reviewsCount = newCount;
  await pharmacy.save();

  return review;
}

module.exports = { listReviewsForWarehouse, createPharmacyReview };
