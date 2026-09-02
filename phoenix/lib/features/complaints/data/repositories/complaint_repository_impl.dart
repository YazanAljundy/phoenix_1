import 'package:dio/dio.dart';
import 'package:phoenix/core/error/failure.dart';
import 'package:phoenix/core/models/paginated_result.dart';
import 'package:phoenix/core/network/api_client.dart';
import 'package:phoenix/core/network/endpoints.dart';
import 'package:phoenix/features/complaints/data/models/complaint_model.dart';

import 'complaint_repository.dart';

class ComplaintRepositoryImpl implements ComplaintRepository {
  ComplaintRepositoryImpl({required ApiClient apiClient}) : _apiClient = apiClient;

  final ApiClient _apiClient;

  @override
  Future<ComplaintModel> createComplaint(ComplaintInput input) async {
    try {
      final response = await _apiClient.dio.post(Endpoints.complaints, data: input.toJson());
      final data = response.data as Map<String, dynamic>;
      return ComplaintModel.fromJson(data['complaint'] as Map<String, dynamic>);
    } on DioException catch (e) {
      throw ServerFailure.fromDioError(e);
    }
  }

  @override
  Future<PaginatedResult<ComplaintModel>> getComplaints({int? limit, String? after}) async {
    try {
      final response = await _apiClient.dio.get(
        Endpoints.complaints,
        queryParameters: {
          if (limit != null) 'limit': limit,
          if (after != null) 'after': after,
        },
      );
      final data = response.data as Map<String, dynamic>;
      return PaginatedResult.fromJson(data, 'complaints', ComplaintModel.fromJson);
    } on DioException catch (e) {
      throw ServerFailure.fromDioError(e);
    }
  }

  @override
  Future<ComplaintModel> getComplaint(String complaintId) async {
    try {
      final response = await _apiClient.dio.get(Endpoints.complaintDetail(complaintId));
      final data = response.data as Map<String, dynamic>;
      return ComplaintModel.fromJson(data['complaint'] as Map<String, dynamic>);
    } on DioException catch (e) {
      throw ServerFailure.fromDioError(e);
    }
  }
}
