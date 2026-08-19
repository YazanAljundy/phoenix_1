import 'package:dio/dio.dart';
import 'package:phoenix/core/error/failure.dart';
import 'package:phoenix/core/network/api_client.dart';
import 'package:phoenix/core/network/endpoints.dart';
import 'package:phoenix/features/debts/data/models/debt_detail_model.dart';
import 'package:phoenix/features/debts/data/models/warehouse_debt_model.dart';

import 'debt_repository.dart';

class DebtRepositoryImpl implements DebtRepository {
  DebtRepositoryImpl({required ApiClient apiClient}) : _apiClient = apiClient;

  final ApiClient _apiClient;

  @override
  Future<List<WarehouseDebtModel>> getMyDebts() async {
    try {
      final response = await _apiClient.dio.get(Endpoints.debts);
      final data = response.data as Map<String, dynamic>;
      final warehouses = (data['warehouses'] as List).cast<Map<String, dynamic>>();
      return warehouses.map(WarehouseDebtModel.fromJson).toList();
    } on DioException catch (e) {
      throw ServerFailure.fromDioError(e);
    }
  }

  @override
  Future<DebtDetailModel> getDebtDetail(String warehouseId) async {
    try {
      final response = await _apiClient.dio.get(Endpoints.debtDetail(warehouseId));
      final data = response.data as Map<String, dynamic>;
      return DebtDetailModel.fromJson(data);
    } on DioException catch (e) {
      throw ServerFailure.fromDioError(e);
    }
  }
}
