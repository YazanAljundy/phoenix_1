import 'package:feniq/features/cart/data/models/cart_item.dart';
import 'package:feniq/features/cart/data/models/reorder_preparation.dart';

/// The server's response to GET /advertisements/:id/cart - everything the cart
/// needs to hold a package.
///
/// A package goes into the cart as ONE line (see [toCartLine]), priced at
/// [totalPriceUsd] per copy. Its products are not cart lines and are never
/// priced here: they come back in [contents] purely so the tile can show what
/// is inside, and the server builds the real order lines from its own record
/// of the package when the order is placed (order.service.js).
///
/// Every figure here is for DISPLAY. `createOrder` re-reads the package from
/// MongoDB and computes the price itself, so a tampered value changes what the
/// pharmacist *sees*, never what they pay.
class AdvertisementCartPreparation {
  const AdvertisementCartPreparation({
    required this.advertisementId,
    required this.titleAr,
    this.titleEn,
    required this.warehouseId,
    required this.warehouseNameAr,
    this.warehouseNameEn,
    required this.contents,
    this.image,
    required this.itemsTotalUsd,
    required this.totalPriceUsd,
    this.unavailableItems = const [],
  });

  final String advertisementId;
  final String titleAr;
  final String? titleEn;
  final String warehouseId;
  final String warehouseNameAr;
  final String? warehouseNameEn;

  /// What ONE copy of the package contains - display only.
  final List<CartPackageContent> contents;

  /// The first product image the package has, if any - a package carries no
  /// image of its own. Null renders the app's standard themed placeholder.
  final String? image;

  /// The sum of the products' catalog prices, shown struck through next to the
  /// package price so the saving is visible.
  final num itemsTotalUsd;

  /// What one copy of the package costs - the price the line is charged at.
  final num totalPriceUsd;

  /// Products this warehouse no longer sells or has marked unavailable.
  /// Reported so the pharmacist is told, never silently dropped.
  final List<UnavailableReorderItem> unavailableItems;

  bool get hasItems => contents.isNotEmpty;

  /// A package can only be bought whole. If any of its products is
  /// unavailable the backend refuses the order outright
  /// (ADVERTISEMENT_PRODUCT_UNAVAILABLE), so the app must not offer it.
  bool get isComplete => hasItems && unavailableItems.isEmpty;

  /// The package as a single cart line, priced at the package total.
  CartItem toCartLine({required bool isArabic, int copies = 1}) {
    return CartItem.fromPackage(
      packageId: advertisementId,
      titleAr: titleAr,
      titleEn: titleEn,
      warehouseName: isArabic ? warehouseNameAr : (warehouseNameEn ?? warehouseNameAr),
      image: image,
      pricePerCopyUsd: totalPriceUsd,
      copies: copies,
      contents: contents,
    );
  }

  factory AdvertisementCartPreparation.fromJson(Map<String, dynamic> json) {
    final rawItems = ((json['items'] as List?) ?? const []).cast<Map<String, dynamic>>();
    return AdvertisementCartPreparation(
      advertisementId: json['advertisementId'] as String,
      titleAr: json['titleAr'] as String,
      titleEn: json['titleEn'] as String?,
      warehouseId: json['warehouseId'] as String,
      warehouseNameAr: (json['warehouseNameAr'] as String?) ?? '',
      warehouseNameEn: json['warehouseNameEn'] as String?,
      contents: rawItems
          .map((map) => CartPackageContent(
                productId: map['id'] as String,
                nameAr: map['nameAr'] as String,
                nameEn: map['nameEn'] as String?,
                quantityPerCopy: (map['quantity'] as num).toInt(),
              ))
          .toList(),
      image: rawItems
          .map((map) => map['image'] as String?)
          .where((image) => image != null && image.trim().isNotEmpty)
          .firstOrNull,
      itemsTotalUsd: (json['itemsTotalUsd'] as num?) ?? 0,
      totalPriceUsd: json['totalPriceUsd'] as num,
      unavailableItems: ((json['unavailableItems'] as List?) ?? const [])
          .map((e) => UnavailableReorderItem.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }
}
