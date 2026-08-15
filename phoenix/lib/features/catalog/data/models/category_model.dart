class CategoryModel {
  const CategoryModel({
    required this.id,
    required this.nameAr,
    required this.nameEn,
    this.icon,
    required this.sortOrder,
  });

  final String id;
  final String nameAr;
  final String nameEn;
  final String? icon;
  final int sortOrder;

  factory CategoryModel.fromJson(Map<String, dynamic> json) => CategoryModel(
    id: json['id'] as String,
    nameAr: json['nameAr'] as String,
    nameEn: json['nameEn'] as String,
    icon: json['icon'] as String?,
    sortOrder: json['sortOrder'] as int? ?? 0,
  );
}
