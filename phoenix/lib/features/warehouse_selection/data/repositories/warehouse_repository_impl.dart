import 'package:dio/dio.dart';
import 'package:phoenix/core/error/failure.dart';
import 'package:phoenix/core/network/api_client.dart';
import 'package:phoenix/core/network/endpoints.dart';
import 'package:phoenix/features/warehouse_selection/data/models/warehouse_model.dart';
import 'package:phoenix/features/warehouse_selection/data/models/warehouse_profile_model.dart';

import 'warehouse_repository.dart';

class WarehouseRepositoryImpl implements WarehouseRepository {
  WarehouseRepositoryImpl({required ApiClient apiClient}) : _apiClient = apiClient;

  final ApiClient _apiClient;

  @override
  Future<List<WarehouseModel>> getWarehouses() async {
    try {
      final response = await _apiClient.dio.get(Endpoints.warehouses);
      final data = response.data as Map<String, dynamic>;
      final warehouses = (data['warehouses'] as List).cast<Map<String, dynamic>>();
      return warehouses.map(WarehouseModel.fromJson).toList();
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
