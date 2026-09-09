import 'package:dio/dio.dart';
import 'package:feniq/core/error/failure.dart';
import 'package:feniq/core/network/api_client.dart';
import 'package:feniq/core/network/endpoints.dart';
import 'package:feniq/features/account_history/data/models/savings_summary.dart';

import 'savings_repository.dart';

class SavingsRepositoryImpl implements SavingsRepository {
  SavingsRepositoryImpl({required ApiClient apiClient}) : _apiClient = apiClient;

  final ApiClient _apiClient;

  @override
  Future<SavingsSummary> getSavingsSummary() async {
    try {
      final response = await _apiClient.dio.get(Endpoints.savingsSummary);
      final data = response.data as Map<String, dynamic>;
      return SavingsSummary.fromJson(data['savings'] as Map<String, dynamic>);
    } on DioException catch (e) {
      throw ServerFailure.fromDioError(e);
    }
  }
}
