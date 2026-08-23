import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:phoenix/core/error/failure.dart';
import 'package:phoenix/features/returns/data/repositories/return_repository.dart';

import 'my_returns_state.dart';

class MyReturnsCubit extends Cubit<MyReturnsState> {
  MyReturnsCubit({required ReturnRepository returnRepository})
    : _returnRepository = returnRepository,
      super(const MyReturnsState());

  final ReturnRepository _returnRepository;

  // Full reset - also what pull-to-refresh calls, so it always restarts
  // pagination from page one rather than just re-fetching whatever the
  // first page currently happens to be.
  Future<void> load() async {
    emit(
      state.copyWith(
        status: MyReturnsStatus.loading,
        clearError: true,
        hasMore: false,
        clearNextCursor: true,
      ),
    );
    try {
      final result = await _returnRepository.getReturns();
      emit(
        state.copyWith(
          status: MyReturnsStatus.loaded,
          returns: result.items,
          hasMore: result.hasMore,
          nextCursor: result.nextCursor,
          clearNextCursor: result.nextCursor == null,
        ),
      );
    } on Failure catch (f) {
      emit(
        state.copyWith(
          status: MyReturnsStatus.error,
          errorMessage: f.errMessage,
          errorCode: f.code,
        ),
      );
    }
  }

  Future<void> loadMore() async {
    if (!state.hasMore || state.isLoadingMore || state.nextCursor == null) return;

    emit(state.copyWith(isLoadingMore: true, clearLoadMoreError: true));
    try {
      final result = await _returnRepository.getReturns(after: state.nextCursor);
      emit(
        state.copyWith(
          returns: [...state.returns, ...result.items],
          hasMore: result.hasMore,
          nextCursor: result.nextCursor,
          clearNextCursor: result.nextCursor == null,
          isLoadingMore: false,
        ),
      );
    } on Failure catch (f) {
      emit(state.copyWith(isLoadingMore: false, loadMoreErrorMessage: f.errMessage, loadMoreErrorCode: f.code));
    }
  }

  // Section 6.9: deletable only while pending - the sheet/tile that exposes
  // this already hides the action once a return is decided.
  Future<bool> delete(String returnId) async {
    try {
      await _returnRepository.deleteReturn(returnId);
      await load();
      return true;
    } on Failure catch (f) {
      emit(state.copyWith(errorMessage: f.errMessage, errorCode: f.code));
      return false;
    } catch (e) {
      emit(state.copyWith(errorMessage: 'Unexpected error', errorCode: 'UNEXPECTED_ERROR'));
      return false;
    }
  }
}
