function serializeReceivedReview({ review, order, warehouse }) {
  return {
    id: review._id,
    orderId: review.orderId,
    orderNumber: order ? order.orderNumber : null,
    warehouseNameAr: warehouse ? warehouse.nameAr : null,
    warehouseNameEn: warehouse ? warehouse.nameEn : null,
    rating: review.rating,
    comment: review.comment,
    createdAt: review.createdAt,
  };
}

function toReviewsResponse({ reviews, averageRating }) {
  return {
    reviews: reviews.map(serializeReceivedReview),
    averageRating,
  };
}

module.exports = { toReviewsResponse };
