import 'package:dio/dio.dart';
import 'package:phoenix/core/error/failure.dart';
import 'package:phoenix/core/network/api_client.dart';
import 'package:phoenix/core/network/endpoints.dart';
import 'package:phoenix/features/advertisements/data/models/advertisement_cart_preparation.dart';
import 'package:phoenix/features/advertisements/data/models/advertisement_model.dart';

import 'advertisements_repository.dart';

class AdvertisementsRepositoryImpl implements AdvertisementsRepository {
  AdvertisementsRepositoryImpl({required ApiClient apiClient}) : _apiClient = apiClient;

  final ApiClient _apiClient;

  @override
  Future<List<AdvertisementModel>> getActiveAdvertisements() async {
    try {
      final response = await _apiClient.dio.get(Endpoints.activeAdvertisements);
      final data = response.data as Map<String, dynamic>;
      return (data['advertisements'] as List)
          .map((e) => AdvertisementModel.fromJson(e as Map<String, dynamic>))
          .toList();
    } on DioException catch (e) {
      throw ServerFailure.fromDioError(e);
    }
  }

  @override
  Future<AdvertisementCartPreparation> prepareAdvertisementCart(String advertisementId) async {
    try {
      final response = await _apiClient.dio.get(Endpoints.advertisementCart(advertisementId));
      final data = response.data as Map<String, dynamic>;
      return AdvertisementCartPreparation.fromJson(
        data['advertisementCart'] as Map<String, dynamic>,
      );
    } on DioException catch (e) {
      // Carries the server's own code through - ADVERTISEMENT_UNAVAILABLE for
      // a package that has expired, been rejected or was withdrawn between the
      // list being shown and the tap.
      throw ServerFailure.fromDioError(e);
    }
  }
}
