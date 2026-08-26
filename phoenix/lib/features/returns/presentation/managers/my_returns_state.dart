import 'package:phoenix/features/returns/data/models/return_model.dart';
import 'package:phoenix/features/returns/data/models/returnable_order_model.dart';

enum MyReturnsStatus { initial, loading, loaded, error }

class MyReturnsState {
  const MyReturnsState({
    this.status = MyReturnsStatus.initial,
    this.returns = const [],
    this.returnableOrders = const [],
    this.errorMessage,
    this.errorCode,
    this.hasMore = false,
    this.nextCursor,
    this.isLoadingMore = false,
    this.loadMoreErrorMessage,
    this.loadMoreErrorCode,
  });

  final MyReturnsStatus status;
  final List<ReturnModel> returns;

  // Delivered orders still inside the 48-hour window. Loaded alongside
  // the returns list; an empty list simply hides the section.
  final List<ReturnableOrderModel> returnableOrders;
  final String? errorMessage;
  final String? errorCode;

  // Cursor pagination - `isLoadingMore`/`loadMoreErrorMessage` are kept
  // separate from `status`/`errorMessage` above so a failed or in-flight
  // next-page fetch never blanks out the returns already loaded and showing.
  final bool hasMore;
  final String? nextCursor;
  final bool isLoadingMore;
  final String? loadMoreErrorMessage;
  final String? loadMoreErrorCode;

  MyReturnsState copyWith({
    MyReturnsStatus? status,
    List<ReturnModel>? returns,
    List<ReturnableOrderModel>? returnableOrders,
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
    return MyReturnsState(
      status: status ?? this.status,
      returns: returns ?? this.returns,
      returnableOrders: returnableOrders ?? this.returnableOrders,
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
