import 'package:phoenix/features/cart/data/models/order_model.dart';

enum OrderTrackingStatus { initial, loading, loaded, error }

class OrderTrackingState {
  const OrderTrackingState({
    this.status = OrderTrackingStatus.initial,
    this.order,
    this.isCancelling = false,
    this.isSubmittingReview = false,
    this.errorMessage,
    this.errorCode,
    this.warehousePhone,
  });

  final OrderTrackingStatus status;
  final OrderModel? order;
  final bool isCancelling;
  final bool isSubmittingReview;
  final String? errorMessage;
  final String? errorCode;

  // Resolved client-side from GET /warehouses (Section 5's warehouse list
  // endpoint) since the order detail response doesn't carry the warehouse's
  // phone - see order.viewmodel.js. Null while resolving, or if the
  // warehouse lookup fails; the WhatsApp affordance just stays hidden then.
  final String? warehousePhone;

  OrderTrackingState copyWith({
    OrderTrackingStatus? status,
    OrderModel? order,
    bool? isCancelling,
    bool? isSubmittingReview,
    String? errorMessage,
    String? errorCode,
    bool clearError = false,
    String? warehousePhone,
  }) {
    return OrderTrackingState(
      status: status ?? this.status,
      order: order ?? this.order,
      isCancelling: isCancelling ?? this.isCancelling,
      isSubmittingReview: isSubmittingReview ?? this.isSubmittingReview,
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
      errorCode: clearError ? null : (errorCode ?? this.errorCode),
      warehousePhone: warehousePhone ?? this.warehousePhone,
    );
  }
}
