class ProductOfferModel {
  const ProductOfferModel({
    required this.titleAr,
    required this.titleEn,
    required this.discountPercentage,
    required this.discountPriceUsd,
  });

  final String titleAr;
  final String titleEn;
  final num discountPercentage;
  final num discountPriceUsd;

  factory ProductOfferModel.fromJson(Map<String, dynamic> json) => ProductOfferModel(
    titleAr: json['titleAr'] as String,
    titleEn: json['titleEn'] as String,
    discountPercentage: json['discountPercentage'] as num,
    discountPriceUsd: json['discountPriceUsd'] as num,
  );
}
