const mongoose = require('mongoose');
const { ApiError } = require('../utils/ApiError');
const User = require('../models/user.model');
const Warehouse = require('../models/warehouse.model');
const { listReviewsForWarehouse } = require('./warehouseReview.service');

// Section 7: a warehouse only appears to pharmacists once its user has been
// admin-approved (users.status = 'active'), and warehouses.isActive lets an
// already-approved warehouse be temporarily paused without losing approval.
async function listAvailableWarehouses() {
  const activeWarehouseUsers = await User.find({ role: 'warehouse', status: 'active' })
    .select('_id')
    .lean();
  const userIds = activeWarehouseUsers.map((u) => u._id);

  // .lean(): these go straight to warehouse.viewmodel.js and are never saved.
  // .select(): warehouse.viewmodel.js's serializeWarehouse (the card shape)
  // reads exactly these seven fields plus _id; userId is only the join key
  // used just above, and address/rates/delivery windows/rating counters are
  // the profile screen's concern, not the list.
  return Warehouse.find({ userId: { $in: userIds }, isActive: true })
    .select('nameAr nameEn city phone logo minOrderAmountUsd maxOrderAmountUsd')
    .sort({ nameEn: 1 })
    .lean();
}

// Same availability rule as above, for a single warehouse - used by the
// products endpoint so a paused/unapproved warehouse's catalog can't be
// reached just by knowing its id (Section 15b, IDOR prevention).
async function isWarehouseAvailable(warehouseId) {
  if (!mongoose.Types.ObjectId.isValid(warehouseId)) {
    return false;
  }
  // Runs on every catalog, profile and order request. Both queries are pure
  // existence checks whose results are discarded (only `userId` is read on to
  // the second one), so nothing beyond those two fields needs to leave the
  // database, and nothing needs to become a Mongoose document.
  const warehouse = await Warehouse.findOne({ _id: warehouseId, isActive: true })
    .select('userId')
    .lean();
  if (!warehouse) {
    return false;
  }
  const user = await User.findOne({ _id: warehouse.userId, role: 'warehouse', status: 'active' })
    .select('_id')
    .lean();
  return Boolean(user);
}

// Section 17: the pharmacist's read-only "about this warehouse" screen -
// delivery info/hours (display only, never enforced against an actual
// order) plus the same visible reviews the warehouse's own web panel sees
// (warehouseReview.service.js), just capped to the 5 most recent.
// Warehouse.averageRating/reviewsCount aren't used here - they're not kept
// up to date as reviews come in, so the rating shown here is computed live
// from the actual visible reviews, same as listReviewsForWarehouse already
// does for the panel.
async function getWarehouseProfile(warehouseId) {
  const available = await isWarehouseAvailable(warehouseId);
  if (!available) {
    throw ApiError.notFound('Warehouse not found.', 'WAREHOUSE_NOT_FOUND');
  }

  // .lean(): read-only, straight into warehouse.viewmodel.js.
  // .select(): warehouse.viewmodel.js's toWarehouseProfileResponse reads
  // exactly these fields (averageRating/reviewsCount are computed live from
  // `reviews` here, not taken off the doc - see this function's own comment).
  const [warehouse, { reviews, averageRating }] = await Promise.all([
    Warehouse.findById(warehouseId)
      .select(
        'nameAr nameEn address city phone logo deliveryStartTime deliveryEndTime deliveryType minOrderAmountUsd maxOrderAmountUsd'
      )
      .lean(),
    listReviewsForWarehouse(warehouseId),
  ]);

  return {
    warehouse,
    averageRating,
    reviewsCount: reviews.length,
    recentReviews: reviews.slice(0, 5),
  };
}

module.exports = { listAvailableWarehouses, isWarehouseAvailable, getWarehouseProfile };
