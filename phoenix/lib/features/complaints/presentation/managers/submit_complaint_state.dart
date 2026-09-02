import 'package:phoenix/features/complaints/data/models/complaint_model.dart';

enum SubmitComplaintStatus { ready, submitting, submitted, submitError }

class SubmitComplaintState {
  const SubmitComplaintState({
    required this.context,
    this.warehouseName,
    this.orderNumber,
    this.status = SubmitComplaintStatus.ready,
    this.subject = '',
    this.description = '',
    this.extraDetails = '',
    this.errorMessage,
    this.errorCode,
  });

  // Fixed for the lifetime of the screen - set from the route args, never
  // changed by the user (Section 17).
  final ComplaintContext context;
  final String? warehouseName;
  final int? orderNumber;

  final SubmitComplaintStatus status;
  final String subject;
  final String description;
  final String extraDetails;
  final String? errorMessage;
  final String? errorCode;

  bool get isSubmitting => status == SubmitComplaintStatus.submitting;

  // Only the two text fields are user input - the warehouse/order come from
  // the context, so there is nothing else to validate here.
  bool get isValid => subject.trim().isNotEmpty && description.trim().isNotEmpty;

  SubmitComplaintState copyWith({
    SubmitComplaintStatus? status,
    String? subject,
    String? description,
    String? extraDetails,
    String? errorMessage,
    String? errorCode,
    bool clearError = false,
  }) {
    return SubmitComplaintState(
      context: context,
      warehouseName: warehouseName,
      orderNumber: orderNumber,
      status: status ?? this.status,
      subject: subject ?? this.subject,
      description: description ?? this.description,
      extraDetails: extraDetails ?? this.extraDetails,
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
      errorCode: clearError ? null : (errorCode ?? this.errorCode),
    );
  }
}
