import 'package:flutter_test/flutter_test.dart';
import 'package:phoenix/features/cart/data/models/reorder_preparation.dart';

// The reorder payload is the catalog-browse product shape + a quantity, so it
// parses through ProductModel/CartItem exactly like the "Add" button does -
// with the price the server sends NOW, never a stored historical price.
Map<String, dynamic> _productItem({
  required String id,
  required num priceUsd,
  required num discountPriceUsd,
  required int quantity,
  bool isAvailable = true,
}) => {
  'id': id,
  'nameAr': 'دواء $id',
  'nameEn': 'Drug $id',
  'manufacturerAr': 'شركة',
  'manufacturerEn': 'Acme',
  'priceUsd': priceUsd,
  'discountPriceUsd': discountPriceUsd,
  'isAvailable': isAvailable,
  'offer': null,
  'quantity': quantity,
};

void main() {
  test('parses the warehouse, builds a CartItem per line and preserves quantities', () {
    final prep = ReorderPreparation.fromJson({
      'warehouseId': 'wh-1',
      'warehouseNameAr': 'مستودع الشمال',
      'warehouseNameEn': 'North Warehouse',
      'items': [
        _productItem(id: 'p1', priceUsd: 2, discountPriceUsd: 2, quantity: 3),
        _productItem(id: 'p2', priceUsd: 5, discountPriceUsd: 4, quantity: 1),
      ],
      'unavailableItems': const [],
    });

    expect(prep.warehouseId, 'wh-1');
    expect(prep.warehouseNameAr, 'مستودع الشمال');
    expect(prep.warehouseNameEn, 'North Warehouse');
    expect(prep.hasItems, isTrue);

    expect(prep.items.map((i) => i.productId).toList(), ['p1', 'p2']);
    expect(prep.items.map((i) => i.quantity).toList(), [3, 1]);
    // Price is the one the server sent, straight onto the CartItem.
    expect(prep.items[0].unitPriceUsd, 2);
    expect(prep.items[1].discountPriceUsd, 4);
  });

  test('parses unavailable (no-longer-sold) lines separately from the cart items', () {
    final prep = ReorderPreparation.fromJson({
      'warehouseId': 'wh-1',
      'warehouseNameAr': 'مستودع',
      'warehouseNameEn': 'Warehouse',
      'items': [_productItem(id: 'p1', priceUsd: 1, discountPriceUsd: 1, quantity: 2)],
      'unavailableItems': [
        {'productId': 'gone', 'productNameAr': 'منتج محذوف', 'productNameEn': 'Removed', 'quantity': 5},
      ],
    });

    expect(prep.items.length, 1);
    expect(prep.unavailableItems.length, 1);
    expect(prep.unavailableItems.single.productId, 'gone');
    expect(prep.unavailableItems.single.quantity, 5);
  });

  test('an all-unavailable order yields no cart items', () {
    final prep = ReorderPreparation.fromJson({
      'warehouseId': 'wh-1',
      'warehouseNameAr': 'مستودع',
      'items': const [],
      'unavailableItems': [
        {'productId': 'g1', 'productNameAr': 'أ', 'quantity': 1},
      ],
    });

    expect(prep.hasItems, isFalse);
    expect(prep.items, isEmpty);
    expect(prep.unavailableItems.length, 1);
  });
}
