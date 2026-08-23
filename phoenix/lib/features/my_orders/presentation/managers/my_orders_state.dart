import 'package:phoenix/features/cart/data/models/order_model.dart';

enum MyOrdersStatus { initial, loading, loaded, error }

class MyOrdersState {
  const MyOrdersState({
    this.status = MyOrdersStatus.initial,
    this.orders = const [],
    this.errorMessage,
    this.errorCode,
    this.hasMore = false,
    this.nextCursor,
    this.isLoadingMore = false,
    this.loadMoreErrorMessage,
    this.loadMoreErrorCode,
  });

  final MyOrdersStatus status;
  final List<OrderModel> orders;
  final String? errorMessage;
  final String? errorCode;

  // Cursor pagination - `isLoadingMore`/`loadMoreErrorMessage` are kept
  // separate from `status`/`errorMessage` above so a failed or in-flight
  // next-page fetch never blanks out the orders already loaded and showing.
  final bool hasMore;
  final String? nextCursor;
  final bool isLoadingMore;
  final String? loadMoreErrorMessage;
  final String? loadMoreErrorCode;

  MyOrdersState copyWith({
    MyOrdersStatus? status,
    List<OrderModel>? orders,
    String? errorMessage,
    String? errorCode,
    bool clearError = false,
    bool? hasMore,
    String? nextCursor,
    bool clearNextCursor = false,
    bool? isLoadingMore,
    String? loadMoreErrorMessage,
    String? loadMoreErrorCode,
    bool clearLoadMoreError = false,
  }) {
    return MyOrdersState(
      status: status ?? this.status,
      orders: orders ?? this.orders,
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
      errorCode: clearError ? null : (errorCode ?? this.errorCode),
      hasMore: hasMore ?? this.hasMore,
      nextCursor: clearNextCursor ? null : (nextCursor ?? this.nextCursor),
      isLoadingMore: isLoadingMore ?? this.isLoadingMore,
      loadMoreErrorMessage: clearLoadMoreError ? null : (loadMoreErrorMessage ?? this.loadMoreErrorMessage),
      loadMoreErrorCode: clearLoadMoreError ? null : (loadMoreErrorCode ?? this.loadMoreErrorCode),
    );
  }
}
