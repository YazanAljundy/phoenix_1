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
  Future<DebtsSummaryModel> getMyDebts() async {
    try {
      final response = await _apiClient.dio.get(Endpoints.debts);
      // Money-Flow V2: the endpoint returns every account plus the three
      // headline totals, all computed server-side. V1 returned only the
      // accounts in debt and left the client to sum them.
      return DebtsSummaryModel.fromJson(response.data as Map<String, dynamic>);
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
