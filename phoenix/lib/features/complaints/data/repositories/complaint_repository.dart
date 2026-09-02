import 'package:phoenix/core/models/paginated_result.dart';
import 'package:phoenix/features/complaints/data/models/complaint_model.dart';

// A single complaint being submitted. The client sends CONTEXT only and the
// backend decides the type:
//   - general   -> warehouseId == null, relatedOrderId == null
//   - warehouse -> warehouseId set
//   - order     -> relatedOrderId set (warehouseId is NOT sent - the backend
//                  resolves it from the order, Section 5)
class ComplaintInput {
  const ComplaintInput({
    required this.subject,
    required this.description,
    this.warehouseId,
    this.relatedOrderId,
    this.extraDetails,
  });

  const ComplaintInput.general({
    required String subject,
    required String description,
    String? extraDetails,
  }) : this(subject: subject, description: description, extraDetails: extraDetails);

  const ComplaintInput.warehouse({
    required String warehouseId,
    required String subject,
    required String description,
    String? extraDetails,
  }) : this(
         warehouseId: warehouseId,
         subject: subject,
         description: description,
         extraDetails: extraDetails,
       );

  const ComplaintInput.order({
    required String relatedOrderId,
    required String subject,
    required String description,
    String? extraDetails,
  }) : this(
         relatedOrderId: relatedOrderId,
         subject: subject,
         description: description,
         extraDetails: extraDetails,
       );

  final String subject;
  final String description;
  final String? warehouseId;
  final String? relatedOrderId;
  final String? extraDetails;

  Map<String, dynamic> toJson() => {
    'subject': subject,
    'description': description,
    if (warehouseId != null) 'warehouseId': warehouseId,
    if (relatedOrderId != null) 'relatedOrderId': relatedOrderId,
    if (extraDetails != null && extraDetails!.isNotEmpty) 'extraDetails': extraDetails,
  };
}

abstract class ComplaintRepository {
  Future<ComplaintModel> createComplaint(ComplaintInput input);

  // Cursor pagination: `after` is the previous page's nextCursor, omitted for
  // the first page.
  Future<PaginatedResult<ComplaintModel>> getComplaints({int? limit, String? after});

  Future<ComplaintModel> getComplaint(String complaintId);
}
