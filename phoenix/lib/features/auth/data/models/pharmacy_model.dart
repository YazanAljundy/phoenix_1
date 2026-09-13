class PharmacyModel {
  const PharmacyModel({
    required this.id,
    required this.nameAr,
    required this.nameEn,
    required this.ownerName,
    required this.address,
    required this.city,
    required this.phone,
    required this.areaType,
  });

  final String id;
  final String nameAr;
  final String nameEn;
  final String ownerName;
  final String address;
  final String city;
  final String phone;
  // Backend-guaranteed since pharmacy.model.js made areaType required: true
  // (backfilled first via scripts/backfill-pharmacy-area-type.js) - every
  // pharmacy row now has one.
  final String areaType;

  factory PharmacyModel.fromJson(Map<String, dynamic> json) => PharmacyModel(
    id: json['id'] as String,
    nameAr: json['nameAr'] as String,
    nameEn: json['nameEn'] as String,
    ownerName: json['ownerName'] as String,
    address: json['address'] as String,
    city: json['city'] as String,
    phone: json['phone'] as String,
    areaType: json['areaType'] as String,
  );
}
