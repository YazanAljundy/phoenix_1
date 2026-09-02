import 'package:dio/dio.dart';
import 'package:phoenix/core/error/failure.dart';
import 'package:phoenix/core/models/paginated_result.dart';
import 'package:phoenix/core/network/api_client.dart';
import 'package:phoenix/core/network/endpoints.dart';
import 'package:phoenix/features/cart/data/models/cart_item.dart';
import 'package:phoenix/features/cart/data/models/order_model.dart';
import 'package:phoenix/features/cart/data/models/reorder_preparation.dart';

import 'order_repository.dart';

class OrderRepositoryImpl implements OrderRepository {
  OrderRepositoryImpl({required ApiClient apiClient}) : _apiClient = apiClient;

  final ApiClient _apiClient;

  @override
  Future<OrderModel> submitOrder({
    required String warehouseId,
    required List<CartItem> items,
    String? notes,
  }) async {
    try {
      final response = await _apiClient.dio.post(
        Endpoints.orders,
        data: {
          'warehouseId': warehouseId,
          'items': items
              .map((item) => {'productId': item.productId, 'quantity': item.quantity})
              .toList(),
          if (notes != null && notes.isNotEmpty) 'notes': notes,
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
