import 'package:phoenix/features/complaints/data/models/complaint_model.dart';

enum MyComplaintsStatus { initial, loading, loaded, error }

class MyComplaintsState {
  const MyComplaintsState({
    this.status = MyComplaintsStatus.initial,
    this.complaints = const [],
    this.errorMessage,
    this.errorCode,
    this.hasMore = false,
    this.nextCursor,
    this.isLoadingMore = false,
    this.loadMoreErrorMessage,
    this.loadMoreErrorCode,
  });

  final MyComplaintsStatus status;
  final List<ComplaintModel> complaints;
  final String? errorMessage;
  final String? errorCode;

  // Cursor pagination - kept separate from status/errorMessage so a failed or
  // in-flight next-page fetch never blanks out the complaints already showing
  // (same split as MyReturnsState).
  final bool hasMore;
  final String? nextCursor;
  final bool isLoadingMore;
  final String? loadMoreErrorMessage;
  final String? loadMoreErrorCode;

  MyComplaintsState copyWith({
    MyComplaintsStatus? status,
    List<ComplaintModel>? complaints,
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
    return MyComplaintsState(
      status: status ?? this.status,
      complaints: complaints ?? this.complaints,
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
