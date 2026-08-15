// Section 8: reasonType is a short, fixed enum by design - the pharmacist
// never picks a resolution (approve/reject), only the warehouse does, once
// status leaves 'pending' (Section 7).
const List<String> kReturnReasonTypes = ['damaged', 'wrong_item', 'other'];

class ReturnItemModel {
  const ReturnItemModel({
    required this.orderItemId,
    required this.productId,
    required this.quantity,
    required this.reasonType,
    this.customReason,
    this.productNameAr,
    this.productNameEn,
  });

  final String orderItemId;
  final String productId;
  final int quantity;
  final String reasonType;
  final String? customReason;
  final String? productNameAr;
  final String? productNameEn;

  factory ReturnItemModel.fromJson(Map<String, dynamic> json) => ReturnItemModel(
    orderItemId: json['orderItemId'] as String,
    productId: json['productId'] as String,
    quantity: json['quantity'] as int,
    reasonType: json['reasonType'] as String,
    customReason: json['customReason'] as String?,
    productNameAr: json['productNameAr'] as String?,
    productNameEn: json['productNameEn'] as String?,
  );
}

class ReturnModel {
  const ReturnModel({
    required this.id,
    required this.orderId,
    required this.items,
    this.notes,
    this.images = const [],
    required this.status,
    this.rejectionNote,
    this.replacementOrderId,
    required this.createdAt,
    this.orderNumber,
  });

  final String id;
  final String orderId;
  final List<ReturnItemModel> items;
  final String? notes;
  final List<String> images;
  final String status;
  final String? rejectionNote;
  final String? replacementOrderId;
  final DateTime createdAt;

  // Only present on the list response (joined in server-side).
  final int? orderNumber;

  bool get isPending => status == 'pending';
  bool get isApproved => status == 'approved';
  bool get isRejected => status == 'rejected';

  factory ReturnModel.fromJson(Map<String, dynamic> json) => ReturnModel(
    id: json['id'] as String,
    orderId: json['orderId'] as String,
    items: (json['items'] as List)
        .map((e) => ReturnItemModel.fromJson(e as Map<String, dynamic>))
        .toList(),
    notes: json['notes'] as String?,
    images: json['images'] != null ? List<String>.from(json['images'] as List) : const [],
    status: json['status'] as String,
    rejectionNote: json['rejectionNote'] as String?,
    replacementOrderId: json['replacementOrderId'] as String?,
    createdAt: DateTime.parse(json['createdAt'] as String),
    orderNumber: json['orderNumber'] as int?,
  );
}
