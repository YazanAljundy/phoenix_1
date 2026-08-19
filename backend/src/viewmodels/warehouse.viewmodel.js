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
  };
}

function toWarehouseListResponse(warehouses) {
  return { warehouses: warehouses.map(serializeWarehouse) };
}

function serializeReview(review) {
  return {
    rating: review.rating,
    comment: review.comment,
    createdAt: review.createdAt,
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
    averageRating,
    reviewsCount,
    recentReviews: recentReviews.map(serializeReview),
  };
}

module.exports = { toWarehouseListResponse, toWarehouseProfileResponse };
