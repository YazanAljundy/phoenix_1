import 'package:phoenix/features/reviews/data/models/review_model.dart';

abstract class ReviewRepository {
  Future<({List<ReviewModel> reviews, num averageRating})> getMyReviews();

  // The pharmacy rating the warehouse for a delivered order (Section 8/13c) -
  // a record, not a full ReviewModel, since this side never re-lists its own
  // submitted reviews (only order_tracking needs the fresh result).
  Future<({String id, int rating, String? comment, DateTime createdAt})> submitWarehouseReview({
    required String orderId,
    required String warehouseId,
    required int rating,
    String? comment,
  });
}
