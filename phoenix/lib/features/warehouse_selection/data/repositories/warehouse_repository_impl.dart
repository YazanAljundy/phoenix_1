import 'package:dio/dio.dart';
import 'package:feniq/core/error/failure.dart';
import 'package:feniq/core/network/api_client.dart';
import 'package:feniq/core/network/endpoints.dart';
import 'package:feniq/features/warehouse_selection/data/models/warehouse_list_result.dart';
import 'package:feniq/features/warehouse_selection/data/models/warehouse_profile_model.dart';

import 'warehouse_repository.dart';

class WarehouseRepositoryImpl implements WarehouseRepository {
  WarehouseRepositoryImpl({required ApiClient apiClient}) : _apiClient = apiClient;

  final ApiClient _apiClient;

  @override
  Future<WarehouseListResult> getWarehouses({required bool onlyMyCity}) async {
    try {
      final response = await _apiClient.dio.get(
        Endpoints.warehouses,
        // Sent only when narrowing. The endpoint's own default is the
        // unfiltered list, so omitting it is both the smaller request and
        // exactly what an older app build sends.
        queryParameters: onlyMyCity ? const {'cityScope': 'mine'} : null,
      );
      return WarehouseListResult.fromJson(response.data as Map<String, dynamic>);
    } on DioException catch (e) {
      throw ServerFailure.fromDioError(e);
    }
  }

  @override
  Future<WarehouseProfileModel> getWarehouseProfile(String warehouseId) async {
    try {
      final response = await _apiClient.dio.get(Endpoints.warehouseProfile(warehouseId));
      final data = response.data as Map<String, dynamic>;
      return WarehouseProfileModel.fromJson(data);
    } on DioException catch (e) {
      throw ServerFailure.fromDioError(e);
    }
  }
}
