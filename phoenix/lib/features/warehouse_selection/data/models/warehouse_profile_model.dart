// Section 17: one entry in a warehouse profile's "recent reviews" list -
// rating/comment/date plus the reviewing pharmacy's owner name, same shape
// the backend serializes (warehouse.viewmodel.js's serializeReview).
// reviewerName is never blank from the backend (it falls back to a fixed
// placeholder there), but fromJson still guards against a missing/empty
// value so the UI never renders an empty name.
class WarehouseReviewModel {
  const WarehouseReviewModel({
    required this.rating,
    this.comment,
    required this.createdAt,
    required this.reviewerName,
  });

  final int rating;
  final String? comment;
  final DateTime createdAt;
  final String? reviewerName;

  factory WarehouseReviewModel.fromJson(Map<String, dynamic> json) => WarehouseReviewModel(
    rating: json['rating'] as int,
    comment: json['comment'] as String?,
    createdAt: DateTime.parse(json['createdAt'] as String),
    reviewerName: json['reviewerName'] as String?,
  );
}

// Section 17: GET /warehouses/:warehouseId/profile - the pharmacist's
// read-only "about this warehouse" screen. deliveryStartTime/EndTime/Type
// are display-only context (see warehouse.service.js's getWarehouseProfile) -
// never used to gate whether an order can actually be placed.
class WarehouseProfileModel {
  const WarehouseProfileModel({
    required this.id,
    required this.nameAr,
    required this.nameEn,
    required this.address,
    required this.city,
    required this.phone,
    this.logo,
    this.deliveryStartTime,
    this.deliveryEndTime,
    required this.deliveryType,
    this.minOrderAmountUsd = 0,
    this.maxOrderAmountUsd,
    required this.averageRating,
    required this.reviewsCount,
    required this.recentReviews,
  });

  final String id;
  final String nameAr;
  final String nameEn;
  final String address;
  final String city;
  final String phone;
  final String? logo;
  final String? deliveryStartTime;
  final String? deliveryEndTime;
  final String deliveryType; // 'self' or 'third_party'
  // Order-size limits - unlike the delivery fields above these ARE
  // enforced, both here in the cart and again in order.service.js.
  final num minOrderAmountUsd;
  final num? maxOrderAmountUsd;
  final num averageRating;
  final int reviewsCount;
  final List<WarehouseReviewModel> recentReviews;

  factory WarehouseProfileModel.fromJson(Map<String, dynamic> json) => WarehouseProfileModel(
    id: json['id'] as String,
    nameAr: json['nameAr'] as String,
    nameEn: json['nameEn'] as String,
    address: json['address'] as String,
    city: json['city'] as String,
    phone: json['phone'] as String,
    logo: json['logo'] as String?,
    deliveryStartTime: json['deliveryStartTime'] as String?,
    deliveryEndTime: json['deliveryEndTime'] as String?,
    deliveryType: json['deliveryType'] as String,
    minOrderAmountUsd: (json['minOrderAmountUsd'] as num?) ?? 0,
    maxOrderAmountUsd: json['maxOrderAmountUsd'] as num?,
    averageRating: json['averageRating'] as num,
    reviewsCount: json['reviewsCount'] as int,
    recentReviews: (json['recentReviews'] as List)
        .map((e) => WarehouseReviewModel.fromJson(e as Map<String, dynamic>))
        .toList(),
  );
}
