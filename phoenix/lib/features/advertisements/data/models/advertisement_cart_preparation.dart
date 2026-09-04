import 'package:phoenix/features/cart/data/models/cart_item.dart';
import 'package:phoenix/features/cart/data/models/reorder_preparation.dart';
import 'package:phoenix/features/catalog/data/models/product_model.dart';

/// The server's response to GET /advertisements/:id/cart - everything the
/// existing cart needs to be populated from an advertisement package.
///
/// Deliberately the same `{ warehouse, items, unavailableItems }` shape
/// [ReorderPreparation] parses, so the cart reuses `ProductModel` +
/// `CartItem.fromProduct` instead of growing a second loading path. It carries
/// no order id: opening a package creates nothing.
///
/// The two totals are for DISPLAY ONLY - they let the cart show the package
/// price before checkout. `createOrder` re-reads all of them from MongoDB and
/// never trusts what the client sends back (see order.service.js), so a
/// tampered value here changes what the pharmacist *sees*, never what they pay.
class AdvertisementCartPreparation {
  const AdvertisementCartPreparation({
    required this.advertisementId,
    required this.titleAr,
    this.titleEn,
    required this.warehouseId,
    required this.warehouseNameAr,
    this.warehouseNameEn,
    required this.items,
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
  final List<CartItem> items;
  final num itemsTotalUsd;
  final num totalPriceUsd;
  // Advertised products this warehouse no longer sells or has marked
  // unavailable. Reported so the pharmacist is told, never silently dropped.
  final List<UnavailableReorderItem> unavailableItems;

  bool get hasItems => items.isNotEmpty;

  /// The package can only be bought whole. If any advertised product is
  /// missing, the backend will reject the order (ADVERTISEMENT_ITEM_MISSING),
  /// so the app must not offer it.
  bool get isComplete => hasItems && unavailableItems.isEmpty;

  factory AdvertisementCartPreparation.fromJson(Map<String, dynamic> json) {
    final rawItems = (json['items'] as List?) ?? const [];
    return AdvertisementCartPreparation(
      advertisementId: json['advertisementId'] as String,
      titleAr: json['titleAr'] as String,
      titleEn: json['titleEn'] as String?,
      warehouseId: json['warehouseId'] as String,
      warehouseNameAr: (json['warehouseNameAr'] as String?) ?? '',
      warehouseNameEn: json['warehouseNameEn'] as String?,
      items: rawItems.map((raw) {
        final map = raw as Map<String, dynamic>;
        final quantity = (map['quantity'] as num).toInt();
        // `discountPriceUsd` on this payload is the catalog price, so the
        // existing CartItem.fromProduct path prices the line correctly with no
        // special case. `advertisementId` marks it as part of a package, and
        // `advertisementQuantity` is the advertised minimum for that line.
        return CartItem.fromProduct(
          ProductModel.fromJson(map),
          quantity: quantity,
          advertisementId: json['advertisementId'] as String,
          advertisementQuantity: quantity,
        );
      }).toList(),
      itemsTotalUsd: (json['itemsTotalUsd'] as num?) ?? 0,
      totalPriceUsd: json['totalPriceUsd'] as num,
      unavailableItems: ((json['unavailableItems'] as List?) ?? const [])
          .map((e) => UnavailableReorderItem.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }
}
