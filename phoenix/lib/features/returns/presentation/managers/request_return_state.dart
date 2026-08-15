import 'package:image_picker/image_picker.dart';
import 'package:phoenix/features/cart/data/models/order_line_item.dart';

enum RequestReturnStatus { loading, editing, submitting, submitted, error }

// Section 6.9: per-item fields (quantity/reason/customReason) are keyed by
// orderItemId, alongside the set of which items are actually selected for
// this return - not every item in the order needs to be included.
class RequestReturnState {
  const RequestReturnState({
    this.status = RequestReturnStatus.loading,
    this.orderItems = const [],
    this.selectedItemIds = const {},
    this.itemQuantity = const {},
    this.itemReasonType = const {},
    this.itemCustomReason = const {},
    this.notes = '',
    this.newImages = const [],
    this.existingImageUrls = const [],
    this.errorMessage,
    this.errorCode,
  });

  final RequestReturnStatus status;
  final List<OrderLineItem> orderItems;
  final Set<String> selectedItemIds;
  final Map<String, int> itemQuantity;
  final Map<String, String> itemReasonType;
  final Map<String, String> itemCustomReason;
  final String notes;
  final List<XFile> newImages;
  // Already-uploaded photo URLs kept from the existing return (edit mode only).
  final List<String> existingImageUrls;
  final String? errorMessage;
  final String? errorCode;

  bool get isSubmitting => status == RequestReturnStatus.submitting;

  RequestReturnState copyWith({
    RequestReturnStatus? status,
    List<OrderLineItem>? orderItems,
    Set<String>? selectedItemIds,
    Map<String, int>? itemQuantity,
    Map<String, String>? itemReasonType,
    Map<String, String>? itemCustomReason,
    String? notes,
    List<XFile>? newImages,
    List<String>? existingImageUrls,
    String? errorMessage,
    String? errorCode,
    bool clearError = false,
  }) {
    return RequestReturnState(
      status: status ?? this.status,
      orderItems: orderItems ?? this.orderItems,
      selectedItemIds: selectedItemIds ?? this.selectedItemIds,
      itemQuantity: itemQuantity ?? this.itemQuantity,
      itemReasonType: itemReasonType ?? this.itemReasonType,
      itemCustomReason: itemCustomReason ?? this.itemCustomReason,
      notes: notes ?? this.notes,
      newImages: newImages ?? this.newImages,
      existingImageUrls: existingImageUrls ?? this.existingImageUrls,
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
      errorCode: clearError ? null : (errorCode ?? this.errorCode),
    );
  }
}
