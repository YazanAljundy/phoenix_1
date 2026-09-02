import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:phoenix/core/error/failure.dart';
import 'package:phoenix/features/complaints/data/models/complaint_model.dart';
import 'package:phoenix/features/complaints/data/repositories/complaint_repository.dart';

import 'my_complaints_state.dart';

class MyComplaintsCubit extends Cubit<MyComplaintsState> {
  MyComplaintsCubit({required ComplaintRepository complaintRepository})
    : _complaintRepository = complaintRepository,
      super(const MyComplaintsState());

  final ComplaintRepository _complaintRepository;

  // Full reset - also what pull-to-refresh and "returned from submitting a new
  // complaint" call, so the new complaint shows immediately (Section 2).
  Future<void> load() async {
    emit(
      state.copyWith(
        status: MyComplaintsStatus.loading,
        clearError: true,
        hasMore: false,
        clearNextCursor: true,
      ),
    );
    try {
      final result = await _complaintRepository.getComplaints();
      emit(
        state.copyWith(
          status: MyComplaintsStatus.loaded,
          complaints: result.items,
          hasMore: result.hasMore,
          nextCursor: result.nextCursor,
          clearNextCursor: result.nextCursor == null,
        ),
      );
    } on Failure catch (f) {
      emit(
        state.copyWith(
          status: MyComplaintsStatus.error,
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
      final result = await _complaintRepository.getComplaints(after: state.nextCursor);
      emit(
        state.copyWith(
          complaints: [...state.complaints, ...result.items],
          hasMore: result.hasMore,
          nextCursor: result.nextCursor,
          clearNextCursor: result.nextCursor == null,
          isLoadingMore: false,
        ),
      );
    } on Failure catch (f) {
      emit(
        state.copyWith(
          isLoadingMore: false,
          loadMoreErrorMessage: f.errMessage,
          loadMoreErrorCode: f.code,
        ),
      );
    }
  }

  // Slots an updated complaint (e.g. after opening its detail and seeing a
  // fresh admin response) back into the loaded list without a full refetch.
  void replace(ComplaintModel updated) {
    if (!state.complaints.any((c) => c.id == updated.id)) return;
    emit(
      state.copyWith(
        complaints: [
          for (final c in state.complaints) c.id == updated.id ? updated : c,
        ],
      ),
    );
  }
}
