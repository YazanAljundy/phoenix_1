import 'package:phoenix/core/models/paginated_result.dart';
import 'package:phoenix/features/cart/data/models/cart_item.dart';
import 'package:phoenix/features/cart/data/models/order_model.dart';
import 'package:phoenix/features/cart/data/models/reorder_preparation.dart';

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

  // Builds a cart-ready payload from a past (delivered) order. Creates NO
  // order - the caller loads the result into the existing CartCubit and the
  // pharmacist checks out normally afterwards.
  Future<ReorderPreparation> prepareReorder(String orderId);
}
