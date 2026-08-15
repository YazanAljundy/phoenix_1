import 'package:phoenix/features/reviews/data/models/review_model.dart';

enum PharmacyReviewsStatus { initial, loading, loaded, error }

class PharmacyReviewsState {
  const PharmacyReviewsState({
    this.status = PharmacyReviewsStatus.initial,
    this.reviews = const [],
    this.averageRating = 0,
    this.errorMessage,
    this.errorCode,
  });

  final PharmacyReviewsStatus status;
  final List<ReviewModel> reviews;
  final num averageRating;
  final String? errorMessage;
  final String? errorCode;

  PharmacyReviewsState copyWith({
    PharmacyReviewsStatus? status,
    List<ReviewModel>? reviews,
    num? averageRating,
    String? errorMessage,
    String? errorCode,
    bool clearError = false,
  }) {
    return PharmacyReviewsState(
      status: status ?? this.status,
      reviews: reviews ?? this.reviews,
      averageRating: averageRating ?? this.averageRating,
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
      errorCode: clearError ? null : (errorCode ?? this.errorCode),
    );
  }
}
