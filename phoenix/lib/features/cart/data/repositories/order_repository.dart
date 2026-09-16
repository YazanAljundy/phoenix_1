import 'package:image_picker/image_picker.dart';
import 'package:feniq/core/models/paginated_result.dart';
import 'package:feniq/features/cart/data/models/cart_item.dart';
import 'package:feniq/features/cart/data/models/order_model.dart';
import 'package:feniq/features/cart/data/models/reorder_preparation.dart';

abstract class OrderRepository {
  Future<OrderModel> submitOrder({
    required String warehouseId,
    required List<CartItem> items,
    String? notes,
    // Packages are not a separate argument: they travel inside `items` as
    // package lines, and the implementation splits them out into the API's
    // `packages` array. Nothing but an id and a copy count is ever sent.
    // Money-Flow V2: minted once per submit attempt by CartCubit and reused
    // across retries, so a resubmitted cart (flaky network, a double-tap)
    // returns the order the first attempt created rather than placing a
    // second billable one. Must NOT be generated here - a fresh key on every
    // call is exactly the duplicate this prevents. CartCubit drops it when the
    // cart is edited: the server refuses a key sent with different contents
    // (IDEMPOTENCY_KEY_REUSED).
    String? idempotencyKey,
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
