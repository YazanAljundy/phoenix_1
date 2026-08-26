// Section 6.4: warehouse cards only need logo, name, city, and a visible
// fixed phone number - keep the payload to exactly that.
function serializeWarehouse(warehouse) {
  return {
    id: warehouse._id,
    nameAr: warehouse.nameAr,
    nameEn: warehouse.nameEn,
    city: warehouse.city,
    phone: warehouse.phone,
    logo: warehouse.logo,
    // Order-size limits travel with the card so the cart can gate against
    // them without a second request (warehouse.model.js: 0 = no minimum,
    // null = no maximum).
    minOrderAmountUsd: warehouse.minOrderAmountUsd,
    maxOrderAmountUsd: warehouse.maxOrderAmountUsd,
  };
}

function toWarehouseListResponse(warehouses) {
  return { warehouses: warehouses.map(serializeWarehouse) };
}

// Fallback shown whenever the reviewer's name can't be resolved (record
// deleted, or a legacy review predating this field) - never leave the
// reviewer name blank in the UI.
const FALLBACK_REVIEWER_NAME = 'مستخدم';

function resolveReviewerName(review, { pharmacy, warehouse } = {}) {
  const name = review.reviewerType === 'pharmacy' ? pharmacy?.ownerName : warehouse?.nameAr;
  return name && name.trim() ? name : FALLBACK_REVIEWER_NAME;
}

// recentReviews rows come straight from listReviewsForWarehouse
// (warehouseReview.service.js): { review, order, pharmacy }. These are
// always reviewerType='pharmacy' reviews, so the pharmacy's owner is who
// gets displayed as the reviewer.
function serializeReview({ review, pharmacy }) {
  return {
    rating: review.rating,
    comment: review.comment,
    createdAt: review.createdAt,
    reviewerName: resolveReviewerName(review, { pharmacy }),
  };
}

// Section 17: the pharmacist's read-only warehouse profile - delivery
// info/hours are display-only (never enforced against an actual order, see
// warehouse.service.js's getWarehouseProfile).
function toWarehouseProfileResponse({ warehouse, averageRating, reviewsCount, recentReviews }) {
  return {
    id: warehouse._id,
    nameAr: warehouse.nameAr,
    nameEn: warehouse.nameEn,
    address: warehouse.address,
    city: warehouse.city,
    phone: warehouse.phone,
    logo: warehouse.logo,
    deliveryStartTime: warehouse.deliveryStartTime,
    deliveryEndTime: warehouse.deliveryEndTime,
    deliveryType: warehouse.deliveryType,
    minOrderAmountUsd: warehouse.minOrderAmountUsd,
    maxOrderAmountUsd: warehouse.maxOrderAmountUsd,
    averageRating,
    reviewsCount,
    recentReviews: recentReviews.map(serializeReview),
  };
}

module.exports = { toWarehouseListResponse, toWarehouseProfileResponse };
