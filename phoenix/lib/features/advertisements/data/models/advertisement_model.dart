// One product line inside a package. A package carries no per-product price -
// `priceUsd` is the product's CURRENT catalog price, and the package total is
// the discount.
//
// USD here, like every other price crossing the API (see backend
// product.model.js). SYP is derived for display through the app's one existing
// formatter, core/utils/currency_formatter.dart.
class AdvertisementItemModel {
  const AdvertisementItemModel({
    required this.productId,
    required this.nameAr,
    this.nameEn,
    this.image,
    this.unitAr,
    this.unitEn,
    this.priceUsd,
    required this.quantity,
    required this.isAvailable,
  });

  final String productId;
  final String nameAr;
  final String? nameEn;
  final String? image;
  final String? unitAr;
  final String? unitEn;
  // The current catalog price. Null when the product has been removed.
  final num? priceUsd;
  // How many of this product the package includes.
  final int quantity;
  final bool isAvailable;

  /// The line's catalog cost (price x quantity), or null when the product is
  /// gone.
  num? get lineTotalUsd => priceUsd == null ? null : priceUsd! * quantity;

  factory AdvertisementItemModel.fromJson(Map<String, dynamic> json) => AdvertisementItemModel(
    productId: json['productId'] as String,
    // The server sends null names for a product that no longer exists; the
    // card still needs something to render, and the package can't be ordered
    // in that state anyway (createOrder rejects it).
    nameAr: (json['nameAr'] as String?) ?? '',
    nameEn: json['nameEn'] as String?,
    image: json['image'] as String?,
    unitAr: json['unitAr'] as String?,
    unitEn: json['unitEn'] as String?,
    priceUsd: json['priceUsd'] as num?,
    quantity: (json['quantity'] as num?)?.toInt() ?? 1,
    isAvailable: (json['isAvailable'] as bool?) ?? false,
  );
}

/// A currently-running warehouse advertisement package, as GET
/// /advertisements/active returns it. The server only ever sends approved
/// packages inside their own date window, so there is no client-side
/// expiry/status filtering to get wrong.
class AdvertisementModel {
  const AdvertisementModel({
    required this.id,
    required this.titleAr,
    this.titleEn,
    required this.warehouseId,
    required this.warehouseNameAr,
    this.warehouseNameEn,
    required this.items,
    required this.itemsTotalUsd,
    required this.totalPriceUsd,
    required this.savingPercentage,
  });

  final String id;
  final String titleAr;
  final String? titleEn;
  final String warehouseId;
  final String warehouseNameAr;
  final String? warehouseNameEn;
  final List<AdvertisementItemModel> items;
  // The sum of the products' current catalog prices. The package total below
  // is what is actually charged; the gap between them is the saving.
  final num itemsTotalUsd;
  final num totalPriceUsd;
  // The saving % the package total represents against the catalog total,
  // computed server-side (0 when the total isn't below the sum).
  final int savingPercentage;

  /// What the package saves against the products' catalog total. Clamped at
  /// zero - a total at or above the sum just means "no saving".
  num get savingUsd {
    final saving = itemsTotalUsd - totalPriceUsd;
    return saving > 0 ? saving : 0;
  }

  bool get hasSaving => savingPercentage > 0;

  factory AdvertisementModel.fromJson(Map<String, dynamic> json) {
    final itemsTotal = (json['itemsTotalUsd'] as num?) ?? 0;
    final total = json['totalPriceUsd'] as num;
    return AdvertisementModel(
      id: json['id'] as String,
      titleAr: json['titleAr'] as String,
      titleEn: json['titleEn'] as String?,
      warehouseId: json['warehouseId'] as String,
      warehouseNameAr: (json['warehouseNameAr'] as String?) ?? '',
      warehouseNameEn: json['warehouseNameEn'] as String?,
      items: ((json['items'] as List?) ?? const [])
          .map((e) => AdvertisementItemModel.fromJson(e as Map<String, dynamic>))
          .toList(),
      itemsTotalUsd: itemsTotal,
      totalPriceUsd: total,
      // Fall back to the local formula if an older server doesn't send it.
      savingPercentage: (json['savingPercentage'] as num?)?.round() ??
          (itemsTotal > 0 ? (((itemsTotal - total) / itemsTotal) * 100).round().clamp(0, 100) : 0),
    );
  }
}
