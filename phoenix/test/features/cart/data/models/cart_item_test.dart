import 'package:flutter_test/flutter_test.dart';
import 'package:phoenix/features/cart/data/models/cart_item.dart';
import 'package:phoenix/features/catalog/data/models/product_model.dart';

void main() {
  group('CartItem', () {
    group('constructor', () {
      test('creates instance with required parameters', () {
        const item = CartItem(
          productId: 'prod1',
          nameAr: 'دواء',
          manufacturerAr: 'شركة',
          unitPriceUsd: 10.0,
          discountPriceUsd: 10.0,
          quantity: 5,
        );

        expect(item.productId, equals('prod1'));
        expect(item.nameAr, equals('دواء'));
        expect(item.manufacturerAr, equals('شركة'));
        expect(item.unitPriceUsd, equals(10.0));
        expect(item.discountPriceUsd, equals(10.0));
        expect(item.quantity, equals(5));
      });

      test('creates instance with all optional parameters', () {
        const item = CartItem(
          productId: 'prod1',
          nameAr: 'دواء',
          nameEn: 'Medicine',
          manufacturerAr: 'شركة',
          manufacturerEn: 'Company',
          image: 'image_url',
          unitAr: 'عبوة',
          unitEn: 'box',
          unitPriceUsd: 15.0,
          discountPriceUsd: 12.0,
          quantity: 3,
        );

        expect(item.nameEn, equals('Medicine'));
        expect(item.manufacturerEn, equals('Company'));
        expect(item.image, equals('image_url'));
        expect(item.unitAr, equals('عبوة'));
        expect(item.unitEn, equals('box'));
      });
    });

    group('hasOffer getter', () {
      test('returns true when discount price less than unit price', () {
        const item = CartItem(
          productId: 'prod1',
          nameAr: 'دواء',
          manufacturerAr: 'شركة',
          unitPriceUsd: 10.0,
          discountPriceUsd: 8.0,
          quantity: 1,
        );

        expect(item.hasOffer, isTrue);
      });

      test('returns false when prices are equal', () {
        const item = CartItem(
          productId: 'prod1',
          nameAr: 'دواء',
          manufacturerAr: 'شركة',
          unitPriceUsd: 10.0,
          discountPriceUsd: 10.0,
          quantity: 1,
        );

        expect(item.hasOffer, isFalse);
      });

      test('returns true when discount price differs from unit price', () {
        const item = CartItem(
          productId: 'prod1',
          nameAr: 'دواء',
          manufacturerAr: 'شركة',
          unitPriceUsd: 8.0,
          discountPriceUsd: 10.0,
          quantity: 1,
        );

        expect(item.hasOffer, isTrue);
      });
    });

    group('lineTotalUsd getter', () {
      test('calculates correct total with unit quantity', () {
        const item = CartItem(
          productId: 'prod1',
          nameAr: 'دواء',
          manufacturerAr: 'شركة',
          unitPriceUsd: 10.0,
          discountPriceUsd: 8.0,
          quantity: 1,
        );

        expect(item.lineTotalUsd, equals(8.0));
      });

      test('calculates correct total with multiple quantities', () {
        const item = CartItem(
          productId: 'prod1',
          nameAr: 'دواء',
          manufacturerAr: 'شركة',
          unitPriceUsd: 10.0,
          discountPriceUsd: 8.0,
          quantity: 5,
        );

        expect(item.lineTotalUsd, equals(40.0));
      });

      test('uses discount price for calculation', () {
        const item = CartItem(
          productId: 'prod1',
          nameAr: 'دواء',
          manufacturerAr: 'شركة',
          unitPriceUsd: 10.0,
          discountPriceUsd: 7.5,
          quantity: 4,
        );

        expect(item.lineTotalUsd, equals(30.0));
      });

      test('handles zero quantity', () {
        const item = CartItem(
          productId: 'prod1',
          nameAr: 'دواء',
          manufacturerAr: 'شركة',
          unitPriceUsd: 10.0,
          discountPriceUsd: 8.0,
          quantity: 0,
        );

        expect(item.lineTotalUsd, equals(0.0));
      });
    });

    group('fromProduct', () {
      test('creates CartItem from ProductModel', () {
        const product = ProductModel(
          id: 'prod1',
          nameAr: 'أسبرين',
          nameEn: 'Aspirin',
          manufacturerAr: 'بايير',
          manufacturerEn: 'Bayer',
          image: 'image.jpg',
          unitAr: 'عبوة',
          unitEn: 'box',
          priceUsd: 5.0,
          discountPriceUsd: 4.5,
          isAvailable: true,
          hasActiveOffer: true,
        );

        final cartItem = CartItem.fromProduct(product, quantity: 3);

        expect(cartItem.productId, equals('prod1'));
        expect(cartItem.nameAr, equals('أسبرين'));
        expect(cartItem.nameEn, equals('Aspirin'));
        expect(cartItem.manufacturerAr, equals('بايير'));
        expect(cartItem.manufacturerEn, equals('Bayer'));
        expect(cartItem.image, equals('image.jpg'));
        expect(cartItem.unitAr, equals('عبوة'));
        expect(cartItem.unitEn, equals('box'));
        expect(cartItem.unitPriceUsd, equals(5.0));
        expect(cartItem.discountPriceUsd, equals(4.5));
        expect(cartItem.quantity, equals(3));
      });

      test('handles product without English names', () {
        const product = ProductModel(
          id: 'prod2',
          nameAr: 'دواء',
          manufacturerAr: 'شركة',
          priceUsd: 10.0,
          discountPriceUsd: 10.0,
          isAvailable: true,
          hasActiveOffer: false,
        );

        final cartItem = CartItem.fromProduct(product, quantity: 1);

        expect(cartItem.nameEn, isNull);
        expect(cartItem.manufacturerEn, isNull);
        expect(cartItem.image, isNull);
      });

      test('creates item with quantity 1', () {
        const product = ProductModel(
          id: 'prod1',
          nameAr: 'دواء',
          manufacturerAr: 'شركة',
          priceUsd: 5.0,
          discountPriceUsd: 5.0,
          isAvailable: true,
          hasActiveOffer: false,
        );

        final cartItem = CartItem.fromProduct(product, quantity: 1);

        expect(cartItem.quantity, equals(1));
      });

      test('creates item with large quantity', () {
        const product = ProductModel(
          id: 'prod1',
          nameAr: 'دواء',
          manufacturerAr: 'شركة',
          priceUsd: 5.0,
          discountPriceUsd: 5.0,
          isAvailable: true,
          hasActiveOffer: false,
        );

        final cartItem = CartItem.fromProduct(product, quantity: 100);

        expect(cartItem.quantity, equals(100));
      });
    });
  });
}
