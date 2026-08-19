const mongoose = require('mongoose');
const { ApiError } = require('../utils/ApiError');
const User = require('../models/user.model');
const Warehouse = require('../models/warehouse.model');
const { listReviewsForWarehouse } = require('./warehouseReview.service');

// Section 7: a warehouse only appears to pharmacists once its user has been
// admin-approved (users.status = 'active'), and warehouses.isActive lets an
// already-approved warehouse be temporarily paused without losing approval.
async function listAvailableWarehouses() {
  const activeWarehouseUsers = await User.find({ role: 'warehouse', status: 'active' }).select('_id');
  const userIds = activeWarehouseUsers.map((u) => u._id);

  return Warehouse.find({ userId: { $in: userIds }, isActive: true }).sort({ nameEn: 1 });
}

// Same availability rule as above, for a single warehouse - used by the
// products endpoint so a paused/unapproved warehouse's catalog can't be
// reached just by knowing its id (Section 15b, IDOR prevention).
async function isWarehouseAvailable(warehouseId) {
  if (!mongoose.Types.ObjectId.isValid(warehouseId)) {
    return false;
  }
  const warehouse = await Warehouse.findOne({ _id: warehouseId, isActive: true });
  if (!warehouse) {
    return false;
  }
  const user = await User.findOne({ _id: warehouse.userId, role: 'warehouse', status: 'active' });
  return Boolean(user);
}

// Section 17: the pharmacist's read-only "about this warehouse" screen -
// delivery info/hours (display only, never enforced against an actual
// order) plus the same visible reviews the warehouse's own web panel sees
// (warehouseReview.service.js), just capped to the 5 most recent.
// Warehouse.averageRating/reviewsCount aren't used here - they're not kept
// up to date yet (see review.service.js's createWarehouseReview comment),
// so the rating shown here is computed live from the actual visible
// reviews, same as listReviewsForWarehouse already does for the panel.
async function getWarehouseProfile(warehouseId) {
  const available = await isWarehouseAvailable(warehouseId);
  if (!available) {
    throw ApiError.notFound('Warehouse not found.', 'WAREHOUSE_NOT_FOUND');
  }

  const [warehouse, { reviews, averageRating }] = await Promise.all([
    Warehouse.findById(warehouseId),
    listReviewsForWarehouse(warehouseId),
  ]);

  return {
    warehouse,
    averageRating,
    reviewsCount: reviews.length,
    recentReviews: reviews.slice(0, 5).map((row) => row.review),
  };
}

module.exports = { listAvailableWarehouses, isWarehouseAvailable, getWarehouseProfile };
