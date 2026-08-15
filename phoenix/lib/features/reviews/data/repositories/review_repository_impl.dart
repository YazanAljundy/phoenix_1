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
}
