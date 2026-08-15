import 'package:phoenix/features/cart/data/models/order_model.dart';

enum OrderTrackingStatus { initial, loading, loaded, error }

class OrderTrackingState {
  const OrderTrackingState({
    this.status = OrderTrackingStatus.initial,
    this.order,
    this.isCancelling = false,
    this.errorMessage,
    this.errorCode,
  });

  final OrderTrackingStatus status;
  final OrderModel? order;
  final bool isCancelling;
  final String? errorMessage;
  final String? errorCode;

  OrderTrackingState copyWith({
    OrderTrackingStatus? status,
    OrderModel? order,
    bool? isCancelling,
    String? errorMessage,
    String? errorCode,
    bool clearError = false,
  }) {
    return OrderTrackingState(
      status: status ?? this.status,
      order: order ?? this.order,
      isCancelling: isCancelling ?? this.isCancelling,
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
      errorCode: clearError ? null : (errorCode ?? this.errorCode),
    );
  }
}
