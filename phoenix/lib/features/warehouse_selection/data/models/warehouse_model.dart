class WarehouseModel {
  const WarehouseModel({
    required this.id,
    required this.nameAr,
    required this.nameEn,
    required this.city,
    required this.phone,
    this.logo,
    this.minOrderAmountUsd = 0,
    this.maxOrderAmountUsd,
  });

  final String id;
  final String nameAr;
  final String nameEn;
  final String city;
  final String phone;
  final String? logo;
  // Order-size limits set by the warehouse itself (backend:
  // warehouse.model.js). 0 = no minimum, null = no maximum.
  final num minOrderAmountUsd;
  final num? maxOrderAmountUsd;

  factory WarehouseModel.fromJson(Map<String, dynamic> json) => WarehouseModel(
    id: json['id'] as String,
    nameAr: json['nameAr'] as String,
    nameEn: json['nameEn'] as String,
    city: json['city'] as String,
    phone: json['phone'] as String,
    logo: json['logo'] as String?,
    minOrderAmountUsd: (json['minOrderAmountUsd'] as num?) ?? 0,
    maxOrderAmountUsd: json['maxOrderAmountUsd'] as num?,
  );
}
