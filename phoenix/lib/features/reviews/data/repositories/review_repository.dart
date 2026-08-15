import 'package:phoenix/features/reviews/data/models/review_model.dart';

abstract class ReviewRepository {
  Future<({List<ReviewModel> reviews, num averageRating})> getMyReviews();
}
