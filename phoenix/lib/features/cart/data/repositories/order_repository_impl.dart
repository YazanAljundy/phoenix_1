import 'package:dio/dio.dart';
import 'package:image_picker/image_picker.dart';
import 'package:feniq/core/error/failure.dart';
import 'package:feniq/core/models/paginated_result.dart';
import 'package:feniq/core/network/api_client.dart';
import 'package:feniq/core/network/endpoints.dart';
import 'package:feniq/features/cart/data/models/cart_item.dart';
import 'package:feniq/features/cart/data/models/order_model.dart';
import 'package:feniq/features/cart/data/models/reorder_preparation.dart';

import 'order_repository.dart';

class OrderRepositoryImpl implements OrderRepository {
  OrderRepositoryImpl({required ApiClient apiClient}) : _apiClient = apiClient;

  final ApiClient _apiClient;

  @override
  Future<OrderModel> submitOrder({
    required String warehouseId,
    required List<CartItem> items,
    String? notes,
    String? advertisementId,
    String? idempotencyKey,
  }) async {
    try {
      final response = await _apiClient.dio.post(
        Endpoints.orders,
        data: {
          'warehouseId': warehouseId,
          // productId + quantity, plus the unit price the cart actually
          // showed. The price is NOT what the order is billed at - the server
          // still prices every line from its own catalog - it is only what
          // the pharmacist was looking at when they tapped submit, so the
          // server can reject with PRICE_CHANGED instead of silently charging
          // a different number (order.service.js).
          'items': items
              .map((item) => {
                    'productId': item.productId,
                    'quantity': item.quantity,
                    'displayedUnitPriceUsd': item.discountPriceUsd,
                  })
              .toList(),
          if (notes != null && notes.isNotEmpty) 'notes': notes,
          if (advertisementId != null) 'advertisementId': advertisementId,
          if (idempotencyKey != null) 'idempotencyKey': idempotencyKey,
        },
      );
      final data = response.data as Map<String, dynamic>;
      return OrderModel.fromJson(data['order'] as Map<String, dynamic>);
    } on DioException catch (e) {
      throw ServerFailure.fromDioError(e);
    }
  }

  @override
  Future<OrderModel> getOrder(String orderId) async {
    try {
      final response = await _apiClient.dio.get(Endpoints.orderDetail(orderId));
      final data = response.data as Map<String, dynamic>;
      return OrderModel.fromJson(data['order'] as Map<String, dynamic>);
    } on DioException catch (e) {
      throw ServerFailure.fromDioError(e);
    }
  }

  @override
  Future<OrderModel> cancelOrder(String orderId) async {
    try {
      final response = await _apiClient.dio.post(Endpoints.cancelOrder(orderId));
      final data = response.data as Map<String, dynamic>;
      return OrderModel.fromJson(data['order'] as Map<String, dynamic>);
    } on DioException catch (e) {
      throw ServerFailure.fromDioError(e);
    }
  }

  @override
  Future<OrderModel> confirmDeliveryWithSealPhoto({
    required String orderId,
    required XFile sealPhoto,
  }) async {
    try {
      // Same processed-bytes path as ReturnRepositoryImpl: the XFile has
      // already been through image_picker's resize + JPEG re-encode pass
      // (see confirm_delivery_sheet.dart / core/constants/image_upload.dart),
      // so these bytes are what the backend streams to Cloudinary untouched.
      final bytes = await sealPhoto.readAsBytes();
      final formData = FormData.fromMap({
        'image': MultipartFile.fromBytes(bytes, filename: sealPhoto.name),
      });
      final response = await _apiClient.dio.post(
        Endpoints.confirmDelivery(orderId),
        data: formData,
      );
      final data = response.data as Map<String, dynamic>;
      return OrderModel.fromJson(data['order'] as Map<String, dynamic>);
    } on DioException catch (e) {
      throw ServerFailure.fromDioError(e);
    }
  }

  @override
  Future<PaginatedResult<OrderModel>> getOrders({int? limit, String? after}) async {
    try {
      final response = await _apiClient.dio.get(
        Endpoints.orders,
        queryParameters: {
          if (limit != null) 'limit': limit,
          if (after != null) 'after': after,
        },
      );
      final data = response.data as Map<String, dynamic>;
      return PaginatedResult.fromJson(data, 'orders', OrderModel.fromJson);
    } on DioException catch (e) {
      throw ServerFailure.fromDioError(e);
    }
  }

  @override
  Future<ReorderPreparation> prepareReorder(String orderId) async {
    try {
      final response = await _apiClient.dio.post(Endpoints.reorder(orderId));
      final data = response.data as Map<String, dynamic>;
      return ReorderPreparation.fromJson(data['reorder'] as Map<String, dynamic>);
    } on DioException catch (e) {
      throw ServerFailure.fromDioError(e);
    }
  }
}
