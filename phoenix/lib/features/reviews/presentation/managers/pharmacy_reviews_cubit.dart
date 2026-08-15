import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:phoenix/core/error/failure.dart';
import 'package:phoenix/features/reviews/data/repositories/review_repository.dart';

import 'pharmacy_reviews_state.dart';

class PharmacyReviewsCubit extends Cubit<PharmacyReviewsState> {
  PharmacyReviewsCubit({required ReviewRepository reviewRepository})
    : _reviewRepository = reviewRepository,
      super(const PharmacyReviewsState());

  final ReviewRepository _reviewRepository;

  Future<void> load() async {
    emit(state.copyWith(status: PharmacyReviewsStatus.loading, clearError: true));
    try {
      final result = await _reviewRepository.getMyReviews();
      emit(
        state.copyWith(
          status: PharmacyReviewsStatus.loaded,
          reviews: result.reviews,
          averageRating: result.averageRating,
        ),
      );
    } on Failure catch (f) {
      emit(
        state.copyWith(
          status: PharmacyReviewsStatus.error,
          errorMessage: f.errMessage,
          errorCode: f.code,
        ),
      );
    }
  }
}
