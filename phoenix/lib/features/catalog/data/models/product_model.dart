class ProductModel {
  const ProductModel({
    required this.id,
    this.categoryId,
    required this.nameAr,
    this.nameEn,
    required this.manufacturerAr,
    this.manufacturerEn,
    this.image,
    this.unitAr,
    this.unitEn,
    required this.priceUsd,
    required this.discountPriceUsd,
    required this.isAvailable,
    required this.hasActiveOffer,
  });

  final String id;
  // Section 14 Part 2: null for a product bulk-imported from Excel (the
  // import format carries no category/unit columns, same reasoning as the
  // central catalog's own import) until a warehouse fills it in via edit.
  final String? categoryId;
  final String nameAr;
  // Null when the linked catalog entry has no English name set - Excel
  // import only captures Arabic (see productCatalog.service.js). Always
  // fall back to the Arabic value when displaying, never render blank.
  final String? nameEn;
  final String manufacturerAr;
  final String? manufacturerEn;
  // TODO(seed-images): always null until an image API is chosen (Section 14).
  final String? image;
  final String? unitAr;
  final String? unitEn;
  // USD, not SYP - see backend/src/models/product.model.js. SYP is derived
  // live from ExchangeRateCubit wherever it's shown (see
  // core/utils/currency_formatter.dart), except in order/invoice history
  // which stays SYP-native (locked in at order time).
  final num priceUsd;
  // Section 15: priceUsd with any active product Offer AND the warehouse's
  // manufacturer discount already stacked in (server-computed, see
  // product.viewmodel.js) - equal to priceUsd when neither applies. This is
  // the one number the catalog card actually compares against priceUsd to
  // decide whether to show a struck-through original price; it deliberately
  // carries no indication of *why* the price is lower.
  final num discountPriceUsd;
  final bool isAvailable;
  // Whether this product has an active product-level Offer right now (see
  // product.viewmodel.js's `offer` field - already sent, just unused until
  // now). Distinguishes an offer's before/after price display from a
  // manufacturer-discount-only price, which shows as a single plain number.
  final bool hasActiveOffer;

  factory ProductModel.fromJson(Map<String, dynamic> json) => ProductModel(
    id: json['id'] as String,
    categoryId: json['categoryId'] as String?,
    nameAr: json['nameAr'] as String,
    nameEn: json['nameEn'] as String?,
    manufacturerAr: json['manufacturerAr'] as String,
    manufacturerEn: json['manufacturerEn'] as String?,
    image: json['image'] as String?,
    unitAr: json['unitAr'] as String?,
    unitEn: json['unitEn'] as String?,
    priceUsd: json['priceUsd'] as num,
    discountPriceUsd: json['discountPriceUsd'] as num,
    isAvailable: json['isAvailable'] as bool,
    hasActiveOffer: json['offer'] != null,
  );
}
