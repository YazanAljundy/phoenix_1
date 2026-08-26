// Fallback shown whenever the reviewer's name can't be resolved (record
// deleted, or a legacy review predating this field) - never leave the
// reviewer name blank in the UI.
const FALLBACK_REVIEWER_NAME = 'مستخدم';

function resolveReviewerName(review, { pharmacy, warehouse } = {}) {
  const name = review.reviewerType === 'pharmacy' ? pharmacy?.ownerName : warehouse?.nameAr;
  return name && name.trim() ? name : FALLBACK_REVIEWER_NAME;
}

function serializeReceivedReview({ review, order, pharmacy }) {
  return {
    id: review._id,
    orderId: review.orderId,
    orderNumber: order ? order.orderNumber : null,
    pharmacyNameAr: pharmacy ? pharmacy.nameAr : null,
    pharmacyNameEn: pharmacy ? pharmacy.nameEn : null,
    rating: review.rating,
    comment: review.comment,
    createdAt: review.createdAt,
    reviewerName: resolveReviewerName(review, { pharmacy }),
    reviewerType: review.reviewerType,
  };
}

function toWarehouseReviewsResponse({ reviews, averageRating }) {
  return {
    reviews: reviews.map(serializeReceivedReview),
    averageRating,
  };
}

function toCreatedReviewResponse(review) {
  return {
    review: {
      id: review._id,
      orderId: review.orderId,
      rating: review.rating,
      comment: review.comment,
      createdAt: review.createdAt,
    },
  };
}

module.exports = { toWarehouseReviewsResponse, toCreatedReviewResponse };
