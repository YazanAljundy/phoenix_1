import 'package:dio/dio.dart';
import 'package:feniq/core/error/failure.dart';
import 'package:feniq/core/network/api_client.dart';
import 'package:feniq/core/network/endpoints.dart';
import 'package:feniq/features/offers/data/models/offer_model.dart';

import 'offers_repository.dart';

class OffersRepositoryImpl implements OffersRepository {
  OffersRepositoryImpl({required ApiClient apiClient}) : _apiClient = apiClient;

  final ApiClient _apiClient;

  @override
  Future<List<OfferModel>> getActiveOffers() async {
    try {
      final response = await _apiClient.dio.get(Endpoints.activeOffers);
      final data = response.data as Map<String, dynamic>;
      return (data['offers'] as List)
          .map((e) => OfferModel.fromJson(e as Map<String, dynamic>))
          .toList();
    } on DioException catch (e) {
      throw ServerFailure.fromDioError(e);
    }
  }
}
