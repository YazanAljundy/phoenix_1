import 'package:flutter_test/flutter_test.dart';
import 'package:phoenix/features/cart/data/models/cart_item.dart';
import 'package:phoenix/features/cart/presentation/managers/cart_state.dart';

// The cart's own copy of the warehouse order-size limits must gate exactly
// the same way order.service.js does, against the same subtotal figure.
CartState stateWith({required num lineTotal, num min = 0, num? max}) => CartState(
  warehouseId: 'w1',
  warehouseName: 'WH',
  minOrderAmountUsd: min,
  maxOrderAmountUsd: max,
  items: [
    CartItem(
      productId: 'p1',
      nameAr: 'دواء',
      nameEn: 'Med',
      manufacturerAr: 'شركة',
      unitPriceUsd: lineTotal,
      discountPriceUsd: lineTotal,
      quantity: 1,
    ),
  ],
);

void main() {
  group('warehouse with no limits set', () {
    test('any amount can be submitted', () {
      final s = stateWith(lineTotal: 5);
      expect(s.isBelowMinimum, isFalse);
      expect(s.isAboveMaximum, isFalse);
      expect(s.canSubmit, isTrue);
    });
  });

  group('minimum', () {
    test('below the minimum blocks submit and reports the shortfall', () {
      final s = stateWith(lineTotal: 40, min: 50);
      expect(s.isBelowMinimum, isTrue);
      expect(s.amountToReachMinimum, 10);
      expect(s.canSubmit, isFalse);
    });

    test('exactly the minimum is allowed', () {
      final s = stateWith(lineTotal: 50, min: 50);
      expect(s.isBelowMinimum, isFalse);
      expect(s.canSubmit, isTrue);
    });
  });

  group('maximum', () {
    test('above the maximum blocks submit', () {
      final s = stateWith(lineTotal: 110, max: 100);
      expect(s.isAboveMaximum, isTrue);
      expect(s.amountOverMaximum, 10);
      expect(s.canSubmit, isFalse);
    });

    test('exactly the maximum is allowed', () {
      final s = stateWith(lineTotal: 100, max: 100);
      expect(s.isAboveMaximum, isFalse);
      expect(s.canSubmit, isTrue);
    });
  });

  test('an empty cart can never be submitted', () {
    const s = CartState(warehouseId: 'w1', minOrderAmountUsd: 0);
    expect(s.canSubmit, isFalse);
  });
}
