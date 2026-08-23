import 'package:phoenix/core/models/paginated_result.dart';
import 'package:phoenix/features/cart/data/models/cart_item.dart';
import 'package:phoenix/features/cart/data/models/order_model.dart';

abstract class OrderRepository {
  Future<OrderModel> submitOrder({
    required String warehouseId,
    required List<CartItem> items,
    String? notes,
  });

  Future<OrderModel> getOrder(String orderId);

  Future<OrderModel> cancelOrder(String orderId);

  // Cursor pagination: `after` is the previous page's nextCursor, omitted
  // for the first page.
  Future<PaginatedResult<OrderModel>> getOrders({int? limit, String? after});
}
