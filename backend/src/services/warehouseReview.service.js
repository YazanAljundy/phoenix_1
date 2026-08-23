const mongoose = require('mongoose');
const { ApiError } = require('../utils/ApiError');
const Review = require('../models/review.model');
const Order = require('../models/order.model');
const Pharmacy = require('../models/pharmacy.model');

const WAREHOUSE_REVIEWS_DEFAULT_LIMIT = 15;
const RECEIVED_REVIEW_FILTER_FIELDS = { reviewerType: 'pharmacy', isVisible: true };

// averageRating/totalCount/the 1-5 star distribution must always reflect
// EVERY visible review, never just whatever page happens to be loaded (the
// Reviews page's summary card and its distribution bars break otherwise) -
// one cheap $group aggregate rather than fetching every review's full
// document just to sum ratings.
async function getReviewStatsForWarehouse(warehouseId) {
  const grouped = await Review.aggregate([
    { $match: { warehouseId, ...RECEIVED_REVIEW_FILTER_FIELDS } },
    { $group: { _id: '$rating', count: { $sum: 1 } } },
  ]);
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let totalCount = 0;
  let ratingSum = 0;
  for (const { _id: rating, count } of grouped) {
    distribution[rating] = count;
    totalCount += count;
    ratingSum += rating * count;
  }
  return {
    averageRating: totalCount > 0 ? ratingSum / totalCount : 0,
    totalCount,
    distribution,
  };
}

// Section 8/13c: reviews the warehouse RECEIVED from pharmacies - visible
// immediately, same as the reverse direction. Still filtered on isVisible
// (rather than dropping the clause) so a future moderation need can hide a
// review without a schema change.
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

// The Reviews management page (unlike getWarehouseProfile above - the
// Flutter app's "about this warehouse" screen, which needs the full list to
// compute reviewsCount/recentReviews) wants newest-first with "Load more".
// averageRating/totalCount/distribution come from getReviewStatsForWarehouse
// above, not from this page's rows, so they stay correct regardless of how
// many pages have been loaded.
async function listPaginatedReviewsForWarehouse(
  warehouseId,
  { limit = WAREHOUSE_REVIEWS_DEFAULT_LIMIT, after = null } = {}
) {
  const filter = { warehouseId, ...RECEIVED_REVIEW_FILTER_FIELDS };
  if (after !== null) {
    filter._id = { $lt: after };
  }

  const [reviews, stats] = await Promise.all([
    Review.find(filter).sort({ _id: -1 }).limit(limit + 1),
    getReviewStatsForWarehouse(warehouseId),
  ]);
  const hasMore = reviews.length > limit;
  const page = hasMore ? reviews.slice(0, limit) : reviews;
  const nextCursor = page.length > 0 ? String(page[page.length - 1]._id) : null;

  if (page.length === 0) return { rows: [], hasMore: false, nextCursor: null, ...stats };

  const orderIds = [...new Set(page.map((r) => r.orderId.toString()))];
  const pharmacyIds = [...new Set(page.map((r) => r.pharmacyId.toString()))];
  const [orders, pharmacies] = await Promise.all([
    Order.find({ _id: { $in: orderIds } }, 'orderNumber'),
    Pharmacy.find({ _id: { $in: pharmacyIds } }),
  ]);
  const orderById = new Map(orders.map((o) => [o._id.toString(), o]));
  const pharmacyById = new Map(pharmacies.map((p) => [p._id.toString(), p]));

  const rows = page.map((review) => ({
    review,
    order: orderById.get(review.orderId.toString()) ?? null,
    pharmacy: pharmacyById.get(review.pharmacyId.toString()) ?? null,
  }));

  return { rows, hasMore, nextCursor, ...stats };
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

module.exports = { listReviewsForWarehouse, listPaginatedReviewsForWarehouse, createPharmacyReview };
