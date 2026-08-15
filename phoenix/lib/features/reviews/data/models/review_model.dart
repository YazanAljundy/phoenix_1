// Section 8/13b: a review a warehouse left about this pharmacy, after one of
// its delivered orders. Always visible immediately (only the reverse
// direction - pharmacy rating a warehouse - is gated behind a one-month
// delay), so there's no isVisible flag to check on this side.
class ReviewModel {
  const ReviewModel({
    required this.id,
    required this.orderId,
    required this.orderNumber,
    required this.warehouseNameAr,
    required this.warehouseNameEn,
    required this.rating,
    this.comment,
    required this.createdAt,
  });

  final String id;
  final String orderId;
  final int? orderNumber;
  final String? warehouseNameAr;
  final String? warehouseNameEn;
  final int rating;
  final String? comment;
  final DateTime createdAt;

  factory ReviewModel.fromJson(Map<String, dynamic> json) => ReviewModel(
    id: json['id'] as String,
    orderId: json['orderId'] as String,
    orderNumber: json['orderNumber'] as int?,
    warehouseNameAr: json['warehouseNameAr'] as String?,
    warehouseNameEn: json['warehouseNameEn'] as String?,
    rating: json['rating'] as int,
    comment: json['comment'] as String?,
    createdAt: DateTime.parse(json['createdAt'] as String),
  );
}
