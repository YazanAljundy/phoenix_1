import 'package:phoenix/features/cart/data/models/order_model.dart';

enum MyOrdersStatus { initial, loading, loaded, error }

class MyOrdersState {
  const MyOrdersState({
    this.status = MyOrdersStatus.initial,
    this.orders = const [],
    this.errorMessage,
    this.errorCode,
  });

  final MyOrdersStatus status;
  final List<OrderModel> orders;
  final String? errorMessage;
  final String? errorCode;

  MyOrdersState copyWith({
    MyOrdersStatus? status,
    List<OrderModel>? orders,
    String? errorMessage,
    String? errorCode,
    bool clearError = false,
  }) {
    return MyOrdersState(
      status: status ?? this.status,
      orders: orders ?? this.orders,
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
      errorCode: clearError ? null : (errorCode ?? this.errorCode),
    );
  }
}
