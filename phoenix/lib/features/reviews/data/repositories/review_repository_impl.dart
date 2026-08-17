import 'package:dio/dio.dart';
import 'package:phoenix/core/error/failure.dart';
import 'package:phoenix/core/network/api_client.dart';
import 'package:phoenix/core/network/endpoints.dart';
import 'package:phoenix/features/reviews/data/models/review_model.dart';

import 'review_repository.dart';

class ReviewRepositoryImpl implements ReviewRepository {
  ReviewRepositoryImpl({required ApiClient apiClient}) : _apiClient = apiClient;

  final ApiClient _apiClient;

  @override
  Future<({List<ReviewModel> reviews, num averageRating})> getMyReviews() async {
    try {
      final response = await _apiClient.dio.get(Endpoints.reviews);
      final data = response.data as Map<String, dynamic>;
      final reviews = (data['reviews'] as List)
          .map((e) => ReviewModel.fromJson(e as Map<String, dynamic>))
          .toList();
      return (reviews: reviews, averageRating: data['averageRating'] as num);
    } on DioException catch (e) {
      throw ServerFailure.fromDioError(e);
    }
  }

  @override
  Future<({String id, int rating, String? comment, DateTime createdAt})> submitWarehouseReview({
    required String orderId,
    required String warehouseId,
    required int rating,
    String? comment,
  }) async {
    try {
      final response = await _apiClient.dio.post(
        Endpoints.reviews,
        data: {
          'orderId': orderId,
          'warehouseId': warehouseId,
          'rating': rating,
          if (comment != null && comment.isNotEmpty) 'comment': comment,
        },
      );
      final data = response.data as Map<String, dynamic>;
      final review = data['review'] as Map<String, dynamic>;
      return (
        id: review['id'] as String,
        rating: review['rating'] as int,
        comment: review['comment'] as String?,
        createdAt: DateTime.parse(review['createdAt'] as String),
      );
    } on DioException catch (e) {
      throw ServerFailure.fromDioError(e);
    }
  }
}
