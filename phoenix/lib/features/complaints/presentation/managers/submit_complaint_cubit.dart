import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:phoenix/core/error/failure.dart';
import 'package:phoenix/features/complaints/data/models/complaint_model.dart';
import 'package:phoenix/features/complaints/data/models/submit_complaint_args.dart';
import 'package:phoenix/features/complaints/data/repositories/complaint_repository.dart';

import 'submit_complaint_state.dart';

// Section 17: the complaint's TYPE is decided by the context the screen was
// opened with (general / warehouse / order) - there is no picker. This cubit
// only collects the subject/description and posts the right-shaped payload:
//   general   -> {subject, description}
//   warehouse -> {warehouseId, subject, description}
//   order     -> {relatedOrderId, subject, description}   (no warehouseId -
//                the backend resolves it from the order, Section 5)
class SubmitComplaintCubit extends Cubit<SubmitComplaintState> {
  SubmitComplaintCubit({
    required ComplaintRepository complaintRepository,
    required SubmitComplaintArgs args,
  }) : _complaintRepository = complaintRepository,
       _args = args,
       super(
         SubmitComplaintState(
           context: args.context,
           warehouseName: args.context == ComplaintContext.warehouse
               ? args.warehouseName
               : args.orderWarehouseName,
           orderNumber: args.orderNumber,
         ),
       );

  final ComplaintRepository _complaintRepository;
  final SubmitComplaintArgs _args;

  void setSubject(String value) => emit(state.copyWith(subject: value));
  void setDescription(String value) => emit(state.copyWith(description: value));
  void setExtraDetails(String value) => emit(state.copyWith(extraDetails: value));

  // Returns the created complaint on success, null on validation/failure. The
  // `isSubmitting` guard also blocks a double-submit from a fast double tap.
  Future<ComplaintModel?> submit() async {
    if (!state.isValid || state.isSubmitting) return null;

    emit(state.copyWith(status: SubmitComplaintStatus.submitting, clearError: true));
    try {
      final subject = state.subject.trim();
      final description = state.description.trim();
      final extra = state.extraDetails.trim().isEmpty ? null : state.extraDetails.trim();

      final ComplaintInput input;
      switch (_args.context) {
        case ComplaintContext.warehouse:
          input = ComplaintInput.warehouse(
            warehouseId: _args.warehouseId!,
            subject: subject,
            description: description,
            extraDetails: extra,
          );
        case ComplaintContext.order:
          input = ComplaintInput.order(
            relatedOrderId: _args.orderId!,
            subject: subject,
            description: description,
            extraDetails: extra,
          );
        case ComplaintContext.general:
          input = ComplaintInput.general(
            subject: subject,
            description: description,
            extraDetails: extra,
          );
      }

      final complaint = await _complaintRepository.createComplaint(input);
      emit(state.copyWith(status: SubmitComplaintStatus.submitted));
      return complaint;
    } on Failure catch (f) {
      emit(
        state.copyWith(
          status: SubmitComplaintStatus.submitError,
          errorMessage: f.errMessage,
          errorCode: f.code,
        ),
      );
      return null;
    }
  }
}
