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

module.exports = { listReviewsForPharmacy };
