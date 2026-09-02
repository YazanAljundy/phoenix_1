import 'package:phoenix/features/complaints/data/models/complaint_model.dart';

enum ComplaintDetailStatus { initial, loading, loaded, error }

class ComplaintDetailState {
  const ComplaintDetailState({
    this.status = ComplaintDetailStatus.initial,
    this.complaint,
    this.errorMessage,
    this.errorCode,
  });

  final ComplaintDetailStatus status;
  final ComplaintModel? complaint;
  final String? errorMessage;
  final String? errorCode;

  ComplaintDetailState copyWith({
    ComplaintDetailStatus? status,
    ComplaintModel? complaint,
    String? errorMessage,
    String? errorCode,
  }) {
    return ComplaintDetailState(
      status: status ?? this.status,
      complaint: complaint ?? this.complaint,
      errorMessage: errorMessage,
      errorCode: errorCode,
    );
  }
}
