import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:phoenix/core/error/failure.dart';
import 'package:phoenix/features/complaints/data/models/complaint_model.dart';
import 'package:phoenix/features/complaints/data/repositories/complaint_repository.dart';

import 'complaint_detail_state.dart';

// Section 1: the full complaint - its original text, the warehouse it is
// about, the admin response and when it arrived. `seed` is an optional
// already-loaded list row shown instantly while the fresh copy (which also
// carries the admin responder's name) is fetched; when the screen is reached
// from a notification deep-link there is no seed and it just loads by id.
class ComplaintDetailCubit extends Cubit<ComplaintDetailState> {
  ComplaintDetailCubit({
    required ComplaintRepository complaintRepository,
    required this.complaintId,
    ComplaintModel? seed,
  }) : _complaintRepository = complaintRepository,
       super(
         seed == null
             ? const ComplaintDetailState()
             : ComplaintDetailState(status: ComplaintDetailStatus.loaded, complaint: seed),
       );

  final ComplaintRepository _complaintRepository;
  final String complaintId;

  Future<void> load() async {
    if (state.complaint == null) {
      emit(state.copyWith(status: ComplaintDetailStatus.loading));
    }
    try {
      final complaint = await _complaintRepository.getComplaint(complaintId);
      emit(state.copyWith(status: ComplaintDetailStatus.loaded, complaint: complaint));
    } on Failure catch (f) {
      // A refresh failure with a complaint already on screen keeps showing it
      // rather than blanking out.
      if (state.complaint != null) return;
      emit(
        state.copyWith(
          status: ComplaintDetailStatus.error,
          errorMessage: f.errMessage,
          errorCode: f.code,
        ),
      );
    }
  }
}
