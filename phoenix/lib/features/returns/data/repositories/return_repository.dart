import 'package:image_picker/image_picker.dart';
import 'package:phoenix/core/models/paginated_result.dart';
import 'package:phoenix/features/returns/data/models/return_model.dart';
import 'package:phoenix/features/returns/data/models/returnable_order_model.dart';

// A single problem item being submitted as part of a return request - see
// ReturnItemModel for the server's shape of the same thing once saved.
class ReturnItemInput {
  const ReturnItemInput({
    required this.orderItemId,
    required this.quantity,
    required this.reasonType,
    this.customReason,
  });

  final String orderItemId;
  final int quantity;
  final String reasonType;
  final String? customReason;

  Map<String, dynamic> toJson() => {
    'orderItemId': orderItemId,
    'quantity': quantity,
    'reasonType': reasonType,
    if (customReason != null) 'customReason': customReason,
  };
}

abstract class ReturnRepository {
  Future<ReturnModel> createReturn({
    required String orderId,
    required List<ReturnItemInput> items,
    String? notes,
    List<XFile> images = const [],
  });

  // Section 6.9: editable only while status='pending'. `keepImageUrls` are
  // existing (already-uploaded) photo URLs to retain; anything from the
  // return's current image set not listed there gets dropped.
  Future<ReturnModel> updateReturn({
    required String returnId,
    required List<ReturnItemInput> items,
    String? notes,
    required List<String> keepImageUrls,
    List<XFile> newImages = const [],
  });

  Future<void> deleteReturn(String returnId);

  // Cursor pagination: `after` is the previous page's nextCursor, omitted
  // for the first page.
  Future<PaginatedResult<ReturnModel>> getReturns({int? limit, String? after});

  // Delivered orders still inside the 48-hour return window. Eligibility
  // (and the hours left) is decided entirely by the server.
  Future<List<ReturnableOrderModel>> fetchReturnableOrders();
}
