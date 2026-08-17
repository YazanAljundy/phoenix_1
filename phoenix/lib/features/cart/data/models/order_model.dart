import 'order_line_item.dart';
import 'order_status_history_entry.dart';

// Section 6.9: a compact status summary of the order's linked return, if any
// - the full items/photos live in the returns feature itself, fetched
// separately when the pharmacist opens "My Returns".
class LinkedReturnModel {
  const LinkedReturnModel({required this.id, required this.status, this.rejectionNote, this.replacementOrderId});

  final String id;
  final String status;
  final String? rejectionNote;
  final String? replacementOrderId;

  bool get isPending => status == 'pending';
  bool get isApproved => status == 'approved';
  bool get isRejected => status == 'rejected';

  factory LinkedReturnModel.fromJson(Map<String, dynamic> json) => LinkedReturnModel(
    id: json['id'] as String,
    status: json['status'] as String,
    rejectionNote: json['rejectionNote'] as String?,
    replacementOrderId: json['replacementOrderId'] as String?,
  );
}

// Section 6.7/8: matches orders.status - 'cancelled' is a special status
// shown outside the 5-stage progress bar, never one of its steps.
const List<String> kOrderTrackedStages = [
  'pending',
  'confirmed',
  'preparing',
  'out_for_delivery',
  'delivered',
];

// Section 7: only cancellable before the order goes out for delivery.
const List<String> kOrderCancellableStatuses = ['pending', 'confirmed', 'preparing'];

// Section 8/13c: this pharmacy's own rating of the warehouse for this order,
// if it's already submitted one - present so the tracking screen can show
// "already rated" and skip the form on re-entry, instead of a separate call.
class MyReviewModel {
  const MyReviewModel({required this.id, required this.rating, this.comment, required this.createdAt});

  final String id;
  final int rating;
  final String? comment;
  final DateTime createdAt;

  factory MyReviewModel.fromJson(Map<String, dynamic> json) => MyReviewModel(
    id: json['id'] as String,
    rating: json['rating'] as int,
    comment: json['comment'] as String?,
    createdAt: DateTime.parse(json['createdAt'] as String),
  );
}

class OrderModel {
  const OrderModel({
    required this.id,
    required this.orderNumber,
    required this.status,
    required this.totalPrice,
    required this.discountAmount,
    required this.commissionAmount,
    required this.finalPrice,
    this.notes,
    this.cancelReason,
    this.warehouseId,
    this.warehouseNameAr,
    this.warehouseNameEn,
    this.statusHistory = const [],
    this.createdAt,
    this.items = const [],
    this.linkedReturn,
    this.myReview,
  });

  final String id;
  final int orderNumber;
  final String status;
  final num totalPrice;
  final num discountAmount;
  final num commissionAmount;
  final num finalPrice;
  final String? notes;
  final String? cancelReason;

  // Only present on the detail fetch (GET /orders/:id), not the plain
  // creation response - see order.viewmodel.js.
  final String? warehouseId;
  final String? warehouseNameAr;
  final String? warehouseNameEn;
  final List<OrderStatusHistoryEntry> statusHistory;
  final DateTime? createdAt;

  // Only present on the detail fetch too - the invoice line items (Section
  // 6.8). Empty on the plain creation response and on list summaries.
  final List<OrderLineItem> items;

  // Only present on the detail fetch - see LinkedReturnModel above.
  final LinkedReturnModel? linkedReturn;

  // Only present on the detail fetch - see MyReviewModel above.
  final MyReviewModel? myReview;

  bool get isCancelled => status == 'cancelled';
  bool get isCancellable => kOrderCancellableStatuses.contains(status);

  // -1 when cancelled (outside the bar entirely), else 0-4.
  int get stageIndex => kOrderTrackedStages.indexOf(status);

  OrderModel copyWith({MyReviewModel? myReview}) => OrderModel(
    id: id,
    orderNumber: orderNumber,
    status: status,
    totalPrice: totalPrice,
    discountAmount: discountAmount,
    commissionAmount: commissionAmount,
    finalPrice: finalPrice,
    notes: notes,
    cancelReason: cancelReason,
    warehouseId: warehouseId,
    warehouseNameAr: warehouseNameAr,
    warehouseNameEn: warehouseNameEn,
    statusHistory: statusHistory,
    createdAt: createdAt,
    items: items,
    linkedReturn: linkedReturn,
    myReview: myReview ?? this.myReview,
  );

  factory OrderModel.fromJson(Map<String, dynamic> json) => OrderModel(
    id: json['id'] as String,
    orderNumber: json['orderNumber'] as int,
    status: json['status'] as String,
    totalPrice: json['totalPrice'] as num,
    discountAmount: json['discountAmount'] as num,
    commissionAmount: json['commissionAmount'] as num,
    finalPrice: json['finalPrice'] as num,
    notes: json['notes'] as String?,
    cancelReason: json['cancelReason'] as String?,
    warehouseId: json['warehouseId'] as String?,
    warehouseNameAr: json['warehouseNameAr'] as String?,
    warehouseNameEn: json['warehouseNameEn'] as String?,
    statusHistory: json['statusHistory'] != null
        ? (json['statusHistory'] as List)
              .map((e) => OrderStatusHistoryEntry.fromJson(e as Map<String, dynamic>))
              .toList()
        : const [],
    createdAt: json['createdAt'] != null ? DateTime.parse(json['createdAt'] as String) : null,
    items: json['items'] != null
        ? (json['items'] as List)
              .map((e) => OrderLineItem.fromJson(e as Map<String, dynamic>))
              .toList()
        : const [],
    linkedReturn: json['linkedReturn'] != null
        ? LinkedReturnModel.fromJson(json['linkedReturn'] as Map<String, dynamic>)
        : null,
    myReview: json['myReview'] != null
        ? MyReviewModel.fromJson(json['myReview'] as Map<String, dynamic>)
        : null,
  );
}
