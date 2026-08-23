import 'package:dio/dio.dart';
import 'package:phoenix/core/error/failure.dart';
import 'package:phoenix/core/network/api_client.dart';
import 'package:phoenix/core/network/endpoints.dart';
import 'package:phoenix/features/banners/data/models/banner_model.dart';

import 'banners_repository.dart';

class BannersRepositoryImpl implements BannersRepository {
  BannersRepositoryImpl({required ApiClient apiClient}) : _apiClient = apiClient;

  final ApiClient _apiClient;

  @override
  Future<List<BannerModel>> getActiveBanners() async {
    try {
      final response = await _apiClient.dio.get(Endpoints.activeBanners);
      final data = response.data as Map<String, dynamic>;
      return (data['banners'] as List)
          .map((e) => BannerModel.fromJson(e as Map<String, dynamic>))
          .toList();
    } on DioException catch (e) {
      throw ServerFailure.fromDioError(e);
    }
  }
}
