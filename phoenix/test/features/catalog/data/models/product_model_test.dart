import 'package:flutter_test/flutter_test.dart';
import 'package:phoenix/features/catalog/data/models/product_model.dart';

void main() {
  group('ProductModel', () {
    group('constructor', () {
      test('creates instance with required parameters', () {
        const product = ProductModel(
          id: 'prod1',
          nameAr: 'أسبرين',
          manufacturerAr: 'الشركة',
          priceUsd: 10.0,
          discountPriceUsd: 8.0,
          isAvailable: true,
          hasActiveOffer: false,
        );

        expect(product.id, equals('prod1'));
        expect(product.nameAr, equals('أسبرين'));
        expect(product.manufacturerAr, equals('الشركة'));
        expect(product.priceUsd, equals(10.0));
        expect(product.discountPriceUsd, equals(8.0));
        expect(product.isAvailable, isTrue);
        expect(product.hasActiveOffer, isFalse);
      });

      test('creates instance with all optional parameters', () {
        const product = ProductModel(
          id: 'prod2',
          categoryId: 'cat1',
          nameAr: 'دواء',
          nameEn: 'Medicine',
          manufacturerAr: 'الشركة',
          manufacturerEn: 'Company',
          image: 'image_url',
          unitAr: 'عبوة',
          unitEn: 'box',
          priceUsd: 5.0,
          discountPriceUsd: 4.0,
          isAvailable: true,
          hasActiveOffer: true,
        );

        expect(product.categoryId, equals('cat1'));
        expect(product.nameEn, equals('Medicine'));
        expect(product.manufacturerEn, equals('Company'));
        expect(product.image, equals('image_url'));
        expect(product.unitAr, equals('عبوة'));
        expect(product.unitEn, equals('box'));
      });
    });

    group('fromJson', () {
      test('parses JSON with full data', () {
        final json = {
          'id': 'prod123',
          'categoryId': 'cat1',
          'nameAr': 'أسبرين',
          'nameEn': 'Aspirin',
          'manufacturerAr': 'بايير',
          'manufacturerEn': 'Bayer',
          'image': 'https://example.com/aspirin.jpg',
          'unitAr': 'عبوة',
          'unitEn': 'box',
          'priceUsd': 5.99,
          'discountPriceUsd': 4.99,
          'isAvailable': true,
          'offer': {'id': 'offer1', 'discount': 20},
        };

        final product = ProductModel.fromJson(json);

        expect(product.id, equals('prod123'));
        expect(product.categoryId, equals('cat1'));
        expect(product.nameAr, equals('أسبرين'));
        expect(product.nameEn, equals('Aspirin'));
        expect(product.manufacturerAr, equals('بايير'));
        expect(product.manufacturerEn, equals('Bayer'));
        expect(product.image, equals('https://example.com/aspirin.jpg'));
        expect(product.unitAr, equals('عبوة'));
        expect(product.unitEn, equals('box'));
        expect(product.priceUsd, equals(5.99));
        expect(product.discountPriceUsd, equals(4.99));
        expect(product.isAvailable, isTrue);
        expect(product.hasActiveOffer, isTrue);
      });

      test('handles missing optional fields', () {
        final json = {
          'id': 'prod1',
          'nameAr': 'دواء',
          'manufacturerAr': 'الشركة',
          'priceUsd': 10.0,
          'discountPriceUsd': 10.0,
          'isAvailable': true,
        };

        final product = ProductModel.fromJson(json);

        expect(product.categoryId, isNull);
        expect(product.nameEn, isNull);
        expect(product.manufacturerEn, isNull);
        expect(product.image, isNull);
        expect(product.unitAr, isNull);
        expect(product.unitEn, isNull);
        expect(product.hasActiveOffer, isFalse);
      });

      test('sets hasActiveOffer based on offer field presence', () {
        final jsonWithOffer = {
          'id': 'prod1',
          'nameAr': 'دواء',
          'manufacturerAr': 'شركة',
          'priceUsd': 10.0,
          'discountPriceUsd': 8.0,
          'isAvailable': true,
          'offer': {'id': 'offer1'},
        };

        final productWithOffer = ProductModel.fromJson(jsonWithOffer);
        expect(productWithOffer.hasActiveOffer, isTrue);

        final jsonWithoutOffer = {
          'id': 'prod2',
          'nameAr': 'دواء',
          'manufacturerAr': 'شركة',
          'priceUsd': 10.0,
          'discountPriceUsd': 10.0,
          'isAvailable': true,
        };

        final productWithoutOffer = ProductModel.fromJson(jsonWithoutOffer);
        expect(productWithoutOffer.hasActiveOffer, isFalse);
      });

      test('handles unavailable product', () {
        final json = {
          'id': 'prod1',
          'nameAr': 'دواء',
          'manufacturerAr': 'شركة',
          'priceUsd': 10.0,
          'discountPriceUsd': 10.0,
          'isAvailable': false,
        };

        final product = ProductModel.fromJson(json);

        expect(product.isAvailable, isFalse);
      });

      test('handles numeric prices correctly', () {
        final json = {
          'id': 'prod1',
          'nameAr': 'دواء',
          'manufacturerAr': 'شركة',
          'priceUsd': 15.50,
          'discountPriceUsd': 12.75,
          'isAvailable': true,
        };

        final product = ProductModel.fromJson(json);

        expect(product.priceUsd, equals(15.50));
        expect(product.discountPriceUsd, equals(12.75));
      });
    });

    group('price logic', () {
      test('discountPriceUsd can equal priceUsd when no discount', () {
        const product = ProductModel(
          id: 'prod1',
          nameAr: 'دواء',
          manufacturerAr: 'شركة',
          priceUsd: 10.0,
          discountPriceUsd: 10.0,
          isAvailable: true,
          hasActiveOffer: false,
        );

        expect(product.priceUsd, equals(product.discountPriceUsd));
      });

      test('discountPriceUsd is less than priceUsd when discount active', () {
        const product = ProductModel(
          id: 'prod1',
          nameAr: 'دواء',
          manufacturerAr: 'شركة',
          priceUsd: 10.0,
          discountPriceUsd: 8.0,
          isAvailable: true,
          hasActiveOffer: true,
        );

        expect(product.discountPriceUsd, lessThan(product.priceUsd));
      });
    });
  });
}
