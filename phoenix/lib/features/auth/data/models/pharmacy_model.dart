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
  // `required: true` in pharmacy.model.js constrains WRITES only: a row
  // created before the field existed still has none until
  // scripts/backfill-pharmacy-area-type.js has run on that deployment. The
  // hard `as String` cast that used to be below threw a TypeError - which is
  // not a Failure, so auth_cubit.dart's `on Failure catch` let it escape and
  // the login spinner ran forever with no error shown. Never make a login
  // response field that no screen reads a hard cast.
  final String areaType;

  factory PharmacyModel.fromJson(Map<String, dynamic> json) => PharmacyModel(
    id: json['id'] as String,
    nameAr: json['nameAr'] as String,
    nameEn: json['nameEn'] as String,
    ownerName: json['ownerName'] as String,
    address: json['address'] as String,
    city: json['city'] as String,
    phone: json['phone'] as String,
    areaType: json['areaType'] as String? ?? 'city',
  );
}
