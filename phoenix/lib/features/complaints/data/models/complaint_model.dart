// The complaint lifecycle - mirrors backend/src/models/complaint.model.js's
// status enum exactly. The pharmacy is read-only on all of these; only the
// admin moves a complaint between them.
const List<String> kComplaintStatuses = ['pending', 'in_review', 'resolved', 'closed'];

// The warehouse a complaint is about, as attached server-side to every
// complaint payload the pharmacy app receives (Section 1: "مشاهدة معلومات
// المستودع").
class ComplaintWarehouseRef {
  const ComplaintWarehouseRef({
    required this.id,
    required this.nameAr,
    required this.nameEn,
    this.phone,
    this.city,
    this.address,
    this.logo,
  });

  final String id;
  final String nameAr;
  final String nameEn;
  final String? phone;
  final String? city;
  final String? address;
  final String? logo;

  factory ComplaintWarehouseRef.fromJson(Map<String, dynamic> json) => ComplaintWarehouseRef(
    id: json['id'] as String,
    nameAr: json['nameAr'] as String? ?? '',
    nameEn: json['nameEn'] as String? ?? '',
    phone: json['phone'] as String?,
    city: json['city'] as String?,
    address: json['address'] as String?,
    logo: json['logo'] as String?,
  );
}

// Section 3/17: the context a complaint was filed from - decided by the
// backend, never chosen by the user.
enum ComplaintContext { general, warehouse, order }

ComplaintContext _parseContext(String? raw, {bool hasWarehouse = false, bool hasOrder = false}) {
  switch (raw) {
    case 'order':
      return ComplaintContext.order;
    case 'warehouse':
      return ComplaintContext.warehouse;
    case 'general':
      return ComplaintContext.general;
    default:
      // Fallback for a payload that predates contextType - derive it the same
      // way the backend viewmodel does.
      if (hasOrder) return ComplaintContext.order;
      if (hasWarehouse) return ComplaintContext.warehouse;
      return ComplaintContext.general;
  }
}

class ComplaintModel {
  const ComplaintModel({
    required this.id,
    required this.complaintNumber,
    required this.context,
    required this.subject,
    required this.description,
    this.extraDetails,
    required this.status,
    this.relatedOrderId,
    this.relatedOrderNumber,
    this.adminResponse,
    this.respondedAt,
    this.respondedByName,
    required this.createdAt,
    required this.updatedAt,
    this.warehouse,
  });

  final String id;
  final int complaintNumber;
  final ComplaintContext context;
  final String subject;
  final String description;
  final String? extraDetails;
  final String status;
  final String? relatedOrderId;
  final int? relatedOrderNumber;
  final String? adminResponse;
  final DateTime? respondedAt;
  final String? respondedByName;
  final DateTime createdAt;
  final DateTime updatedAt;
  final ComplaintWarehouseRef? warehouse;

  bool get isPending => status == 'pending';
  bool get isInReview => status == 'in_review';
  bool get isResolved => status == 'resolved';
  bool get isClosed => status == 'closed';
  bool get hasResponse => (adminResponse ?? '').trim().isNotEmpty;

  bool get isGeneral => context == ComplaintContext.general;
  bool get isWarehouseContext => context == ComplaintContext.warehouse;
  bool get isOrderContext => context == ComplaintContext.order;

  factory ComplaintModel.fromJson(Map<String, dynamic> json) => ComplaintModel(
    id: json['id'] as String,
    complaintNumber: json['complaintNumber'] as int,
    context: _parseContext(
      json['contextType'] as String?,
      hasWarehouse: json['warehouse'] is Map,
      hasOrder: json['relatedOrderNumber'] != null,
    ),
    subject: json['subject'] as String? ?? '',
    description: json['description'] as String? ?? '',
    extraDetails: json['extraDetails'] as String?,
    status: json['status'] as String,
    relatedOrderId: json['relatedOrderId'] as String?,
    relatedOrderNumber: json['relatedOrderNumber'] as int?,
    adminResponse: json['adminResponse'] as String?,
    respondedAt: json['respondedAt'] != null
        ? DateTime.parse(json['respondedAt'] as String)
        : null,
    respondedByName: json['respondedBy'] is Map<String, dynamic>
        ? (json['respondedBy'] as Map<String, dynamic>)['name'] as String?
        : null,
    createdAt: DateTime.parse(json['createdAt'] as String),
    updatedAt: DateTime.parse(json['updatedAt'] as String),
    warehouse: json['warehouse'] is Map<String, dynamic>
        ? ComplaintWarehouseRef.fromJson(json['warehouse'] as Map<String, dynamic>)
        : null,
  );
}
