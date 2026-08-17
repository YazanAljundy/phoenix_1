const mongoose = require('mongoose');
const { ApiError } = require('../utils/ApiError');
const Review = require('../models/review.model');
const Order = require('../models/order.model');
const Warehouse = require('../models/warehouse.model');

// Section 8/13b: reviews a pharmacy received FROM warehouses - always
// visible immediately (only the reverse direction, pharmacy->warehouse, is
// gated behind the one-month rule). Scoped to the caller's own pharmacy,
// same IDOR pattern as every other pharmacist-facing list.
async function listReviewsForPharmacy(pharmacyId) {
  const reviews = await Review.find({ pharmacyId, reviewerType: 'warehouse' }).sort({ createdAt: -1 });
  if (reviews.length === 0) return { reviews: [], averageRating: 0 };

  const orderIds = [...new Set(reviews.map((r) => r.orderId.toString()))];
  const warehouseIds = [...new Set(reviews.map((r) => r.warehouseId.toString()))];
  const [orders, warehouses] = await Promise.all([
    Order.find({ _id: { $in: orderIds } }, 'orderNumber'),
    Warehouse.find({ _id: { $in: warehouseIds } }),
  ]);
  const orderById = new Map(orders.map((o) => [o._id.toString(), o]));
  const warehouseById = new Map(warehouses.map((w) => [w._id.toString(), w]));

  const rows = reviews.map((review) => ({
    review,
    order: orderById.get(review.orderId.toString()) ?? null,
    warehouse: warehouseById.get(review.warehouseId.toString()) ?? null,
  }));

  const averageRating = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
  return { reviews: rows, averageRating };
}

function validateRating(rating) {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw ApiError.badRequest('Rating must be a whole number from 1 to 5.', undefined, 'INVALID_RATING');
  }
}

// Section 13b's mirror: the pharmacy rates the warehouse once per delivered
// order. Unlike the reverse direction, this starts hidden (isVisible: false)
// and does NOT fold into Warehouse.averageRating/reviewsCount yet - both
// happen together, once, when the not-yet-built one-month cron job flips
// isVisible to true (see review.model.js).
async function createWarehouseReview(pharmacyId, userId, { orderId, rating, comment }) {
  if (typeof orderId !== 'string' || !mongoose.Types.ObjectId.isValid(orderId)) {
    throw ApiError.notFound('Order not found.', 'ORDER_NOT_FOUND');
  }
  const order = await Order.findOne({ _id: orderId, pharmacyId });
  if (!order) {
    throw ApiError.notFound('Order not found.', 'ORDER_NOT_FOUND');
  }
  if (order.status !== 'delivered') {
    throw ApiError.badRequest('This order has not been delivered yet.', undefined, 'ORDER_NOT_DELIVERED');
  }

  validateRating(rating);

  const existing = await Review.findOne({ orderId: order._id, reviewerType: 'pharmacy' });
  if (existing) {
    throw ApiError.conflict('This order has already been rated.', 'ALREADY_REVIEWED');
  }

  const review = await Review.create({
    orderId: order._id,
    pharmacyId,
    warehouseId: order.warehouseId,
    reviewerType: 'pharmacy',
    rating,
    comment: typeof comment === 'string' && comment.trim() ? comment.trim() : null,
    isVisible: false,
  });

  return review;
}

module.exports = { listReviewsForPharmacy, createWarehouseReview };
