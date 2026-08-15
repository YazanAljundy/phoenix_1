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
