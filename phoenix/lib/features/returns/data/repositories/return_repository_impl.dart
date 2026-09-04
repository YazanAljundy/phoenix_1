import 'dart:convert';
import 'dart:developer' as developer;
import 'dart:ui' as ui;

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
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

  // The [XFile]s handed in here have already been through image_picker's
  // resize + JPEG re-encode pass (see request_return_sheet.dart /
  // core/constants/image_upload.dart) - `readAsBytes()` therefore returns
  // the *processed* bytes, and those exact bytes are what get wrapped in the
  // multipart body and sent on. The backend streams the same buffer to
  // Cloudinary untouched (backend/src/services/upload.service.js), so the
  // processed image is what Cloudinary stores.
  Future<List<MultipartFile>> _toMultipartFiles(List<XFile> images) {
    return Future.wait(
      images.map((image) async {
        final bytes = await image.readAsBytes();
        await _logProcessedImage(image.name, bytes);
        return MultipartFile.fromBytes(bytes, filename: image.name);
      }),
    );
  }

  // TEMPORARY DEBUG LOG (image-upload optimisation task). Confirms the file
  // actually leaving the app for Cloudinary is the processed one - size and
  // pixel dimensions after image_picker's pass. Debug builds only; never
  // logs the image content, a URL, or anything sensitive. Safe to delete.
  Future<void> _logProcessedImage(String name, Uint8List bytes) async {
    if (!kDebugMode) return;
    var dimensions = 'unknown';
    try {
      final codec = await ui.instantiateImageCodec(bytes);
      final frame = await codec.getNextFrame();
      dimensions = '${frame.image.width}x${frame.image.height}';
      frame.image.dispose();
      codec.dispose();
    } catch (_) {
      // dimensions stay 'unknown' - this is only a diagnostic.
    }
    final kb = (bytes.lengthInBytes / 1024).toStringAsFixed(1);
    developer.log(
      'uploading processed photo "$name": $kb KB, $dimensions px -> Cloudinary',
      name: 'ImageUpload',
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
        // The photo is optional - only build/attach MultipartFiles when the
        // pharmacist actually picked at least one, so an image-less request
        // carries no `images` part at all.
        if (images.isNotEmpty) 'images': await _toMultipartFiles(images),
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
        // Optional, same as on create - only send an `images` part when new
        // photos were actually picked.
        if (newImages.isNotEmpty) 'images': await _toMultipartFiles(newImages),
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
