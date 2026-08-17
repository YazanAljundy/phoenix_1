import 'product_offer_model.dart';

class ProductModel {
  const ProductModel({
    required this.id,
    required this.categoryId,
    required this.nameAr,
    required this.nameEn,
    required this.manufacturerAr,
    required this.manufacturerEn,
    this.image,
    required this.unitAr,
    required this.unitEn,
    required this.priceUsd,
    required this.isAvailable,
    this.offer,
  });

  final String id;
  final String categoryId;
  final String nameAr;
  final String nameEn;
  final String manufacturerAr;
  final String manufacturerEn;
  // TODO(seed-images): always null until an image API is chosen (Section 14).
  final String? image;
  final String unitAr;
  final String unitEn;
  // USD, not SYP - see backend/src/models/product.model.js. SYP is derived
  // live from ExchangeRateCubit wherever it's shown (see
  // core/utils/currency_formatter.dart), except in order/invoice history
  // which stays SYP-native (locked in at order time).
  final num priceUsd;
  final bool isAvailable;
  final ProductOfferModel? offer;

  factory ProductModel.fromJson(Map<String, dynamic> json) => ProductModel(
    id: json['id'] as String,
    categoryId: json['categoryId'] as String,
    nameAr: json['nameAr'] as String,
    nameEn: json['nameEn'] as String,
    manufacturerAr: json['manufacturerAr'] as String,
    manufacturerEn: json['manufacturerEn'] as String,
    image: json['image'] as String?,
    unitAr: json['unitAr'] as String,
    unitEn: json['unitEn'] as String,
    priceUsd: json['priceUsd'] as num,
    isAvailable: json['isAvailable'] as bool,
    offer: json['offer'] != null
        ? ProductOfferModel.fromJson(json['offer'] as Map<String, dynamic>)
        : null,
  );
}
