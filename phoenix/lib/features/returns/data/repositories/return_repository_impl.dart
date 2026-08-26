import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:image_picker/image_picker.dart';
import 'package:phoenix/core/error/failure.dart';
import 'package:phoenix/core/models/paginated_result.dart';
import 'package:phoenix/core/network/api_client.dart';
import 'package:phoenix/core/network/endpoints.dart';
import 'package:phoenix/features/returns/data/models/return_model.dart';
import 'package:phoenix/features/returns/data/models/returnable_order_model.dart';

import 'return_repository.dart';

class ReturnRepositoryImpl implements ReturnRepository {
  ReturnRepositoryImpl({required ApiClient apiClient}) : _apiClient = apiClient;

  final ApiClient _apiClient;

  Future<List<MultipartFile>> _toMultipartFiles(List<XFile> images) {
    return Future.wait(
      images.map((image) async {
        final bytes = await image.readAsBytes();
        return MultipartFile.fromBytes(bytes, filename: image.name);
      }),
    );
  }

  @override
  Future<ReturnModel> createReturn({
    required String orderId,
    required List<ReturnItemInput> items,
    String? notes,
    List<XFile> images = const [],
  }) async {
    try {
      final formData = FormData.fromMap({
        'orderId': orderId,
        'items': jsonEncode(items.map((i) => i.toJson()).toList()),
        if (notes != null && notes.isNotEmpty) 'notes': notes,
        'images': await _toMultipartFiles(images),
      });
      final response = await _apiClient.dio.post(Endpoints.returns, data: formData);
      final data = response.data as Map<String, dynamic>;
      return ReturnModel.fromJson(data['return'] as Map<String, dynamic>);
    } on DioException catch (e) {
      throw ServerFailure.fromDioError(e);
    }
  }

  @override
  Future<ReturnModel> updateReturn({
    required String returnId,
    required List<ReturnItemInput> items,
    String? notes,
    required List<String> keepImageUrls,
    List<XFile> newImages = const [],
  }) async {
    try {
      final formData = FormData.fromMap({
        'items': jsonEncode(items.map((i) => i.toJson()).toList()),
        if (notes != null && notes.isNotEmpty) 'notes': notes,
        'keepImageUrls': jsonEncode(keepImageUrls),
        'images': await _toMultipartFiles(newImages),
      });
      final response = await _apiClient.dio.put(
        Endpoints.returnDetail(returnId),
        data: formData,
      );
      final data = response.data as Map<String, dynamic>;
      return ReturnModel.fromJson(data['return'] as Map<String, dynamic>);
    } on DioException catch (e) {
      throw ServerFailure.fromDioError(e);
    }
  }

  @override
  Future<void> deleteReturn(String returnId) async {
    try {
      await _apiClient.dio.delete(Endpoints.returnDetail(returnId));
    } on DioException catch (e) {
      throw ServerFailure.fromDioError(e);
    }
  }

  @override
  Future<PaginatedResult<ReturnModel>> getReturns({int? limit, String? after}) async {
    try {
      final response = await _apiClient.dio.get(
        Endpoints.returns,
        queryParameters: {
          if (limit != null) 'limit': limit,
          if (after != null) 'after': after,
        },
      );
      final data = response.data as Map<String, dynamic>;
      return PaginatedResult.fromJson(data, 'returns', ReturnModel.fromJson);
    } on DioException catch (e) {
      throw ServerFailure.fromDioError(e);
    }
  }

  @override
  Future<List<ReturnableOrderModel>> fetchReturnableOrders() async {
    try {
      final response = await _apiClient.dio.get(Endpoints.returnableOrders);
      final data = response.data as Map<String, dynamic>;
      return (data['orders'] as List)
          .map((e) => ReturnableOrderModel.fromJson(e as Map<String, dynamic>))
          .toList();
    } on DioException catch (e) {
      throw ServerFailure.fromDioError(e);
    }
  }
}
