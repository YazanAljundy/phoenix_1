import 'package:phoenix/features/cart/data/models/cart_item.dart';
import 'package:phoenix/features/catalog/data/models/product_model.dart';

// A line from the original order whose product the warehouse no longer sells
// (deleted, deactivated, or moved warehouse). Reported so the pharmacist can
// be told - it is never added to the cart.
class UnavailableReorderItem {
  const UnavailableReorderItem({
    required this.productId,
    required this.productNameAr,
    this.productNameEn,
    required this.quantity,
  });

  final String productId;
  final String productNameAr;
  final String? productNameEn;
  final int quantity;

  factory UnavailableReorderItem.fromJson(Map<String, dynamic> json) => UnavailableReorderItem(
    productId: json['productId'] as String,
    // Nullable in practice: a reorder always has the OrderItem's snapshotted
    // name, but an advertisement whose product was deleted outright has none
    // to send. Rendered as an empty name rather than crashing the parse.
    productNameAr: (json['productNameAr'] as String?) ?? '',
    productNameEn: json['productNameEn'] as String?,
    quantity: (json['quantity'] as num).toInt(),
  );
}

// The server's response to POST /orders/:id/reorder - everything the existing
// cart needs to be populated from a past order: the trusted warehouse, the
// still-sold products with LIVE prices (built straight into CartItems, exactly
// as the catalog "Add" button does), and the original quantities. Carries no
// order id / number / status: reorder creates nothing.
class ReorderPreparation {
  const ReorderPreparation({
    required this.warehouseId,
    required this.warehouseNameAr,
    this.warehouseNameEn,
    required this.items,
    this.unavailableItems = const [],
  });

  final String warehouseId;
  final String warehouseNameAr;
  final String? warehouseNameEn;
  final List<CartItem> items;
  final List<UnavailableReorderItem> unavailableItems;

  bool get hasItems => items.isNotEmpty;

  factory ReorderPreparation.fromJson(Map<String, dynamic> json) {
    final rawItems = (json['items'] as List?) ?? const [];
    return ReorderPreparation(
      warehouseId: json['warehouseId'] as String,
      warehouseNameAr: (json['warehouseNameAr'] as String?) ?? '',
      warehouseNameEn: json['warehouseNameEn'] as String?,
      items: rawItems.map((raw) {
        final map = raw as Map<String, dynamic>;
        // Same shape as the catalog browse response (serializeProductWithOffer)
        // plus a quantity - so the existing ProductModel + CartItem.fromProduct
        // path builds the line, with the price the server sends now.
        return CartItem.fromProduct(
          ProductModel.fromJson(map),
          quantity: (map['quantity'] as num).toInt(),
        );
      }).toList(),
      unavailableItems: ((json['unavailableItems'] as List?) ?? const [])
          .map((e) => UnavailableReorderItem.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }
}
