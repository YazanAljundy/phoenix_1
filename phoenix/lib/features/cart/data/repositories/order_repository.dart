import 'package:image_picker/image_picker.dart';
import 'package:phoenix/core/models/paginated_result.dart';
import 'package:phoenix/features/cart/data/models/cart_item.dart';
import 'package:phoenix/features/cart/data/models/order_model.dart';
import 'package:phoenix/features/cart/data/models/reorder_preparation.dart';

abstract class OrderRepository {
  Future<OrderModel> submitOrder({
    required String warehouseId,
    required List<CartItem> items,
    String? notes,
    // Names the advertisement package this cart came from, and nothing else -
    // no price, total or discount is ever sent. The server re-reads the
    // package and computes every figure itself (order.service.js).
    String? advertisementId,
  });

  Future<OrderModel> getOrder(String orderId);

  Future<OrderModel> cancelOrder(String orderId);

  // Section: optional delivery seal photo. Uploads [sealPhoto] and records it
  // on the order in one request; the order status is unchanged. Returns the
  // refreshed order. Throws [Failure] on upload/validation errors - the order
  // is then not confirmed and the caller keeps the picked photo for a retry.
  Future<OrderModel> confirmDeliveryWithSealPhoto({
    required String orderId,
    required XFile sealPhoto,
  });

  // Cursor pagination: `after` is the previous page's nextCursor, omitted
  // for the first page.
  Future<PaginatedResult<OrderModel>> getOrders({int? limit, String? after});

  // Builds a cart-ready payload from a past (delivered) order. Creates NO
  // order - the caller loads the result into the existing CartCubit and the
  // pharmacist checks out normally afterwards.
  Future<ReorderPreparation> prepareReorder(String orderId);
}
