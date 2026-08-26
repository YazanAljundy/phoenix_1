import 'package:flutter_test/flutter_test.dart';
import 'package:phoenix/features/banners/data/models/banner_model.dart';

void main() {
  group('BannerModel', () {
    group('constructor', () {
      test('creates instance with required parameters', () {
        const banner = BannerModel(
          id: 'banner1',
          imageUrl: 'https://example.com/image.jpg',
        );

        expect(banner.id, equals('banner1'));
        expect(banner.imageUrl, equals('https://example.com/image.jpg'));
        expect(banner.productId, isNull);
        expect(banner.manufacturerAr, isNull);
        expect(banner.warehouseId, isNull);
      });

      test('creates instance with all parameters', () {
        const banner = BannerModel(
          id: 'banner2',
          imageUrl: 'https://example.com/image.jpg',
          productId: 'prod1',
          manufacturerAr: 'شركة الأدوية',
          warehouseId: 'wh1',
        );

        expect(banner.productId, equals('prod1'));
        expect(banner.manufacturerAr, equals('شركة الأدوية'));
        expect(banner.warehouseId, equals('wh1'));
      });
    });

    group('isTappable getter', () {
      test(
        'returns true when all required fields for navigation are present',
        () {
          const banner = BannerModel(
            id: 'banner1',
            imageUrl: 'url',
            productId: 'prod1',
            manufacturerAr: 'Manufacturer',
            warehouseId: 'wh1',
          );

          expect(banner.isTappable, isTrue);
        },
      );

      test('returns false when productId is null', () {
        const banner = BannerModel(
          id: 'banner1',
          imageUrl: 'url',
          manufacturerAr: 'Manufacturer',
          warehouseId: 'wh1',
        );

        expect(banner.isTappable, isFalse);
      });

      test('returns false when manufacturerAr is null', () {
        const banner = BannerModel(
          id: 'banner1',
          imageUrl: 'url',
          productId: 'prod1',
          warehouseId: 'wh1',
        );

        expect(banner.isTappable, isFalse);
      });

      test('returns false when warehouseId is null', () {
        const banner = BannerModel(
          id: 'banner1',
          imageUrl: 'url',
          productId: 'prod1',
          manufacturerAr: 'Manufacturer',
        );

        expect(banner.isTappable, isFalse);
      });

      test('returns false when all optional fields are null', () {
        const banner = BannerModel(id: 'banner1', imageUrl: 'url');

        expect(banner.isTappable, isFalse);
      });
    });

    group('fromJson', () {
      test('creates instance from JSON with all fields', () {
        final json = {
          'id': 'banner123',
          'imageUrl': 'https://example.com/banner.jpg',
          'productId': 'prod1',
          'manufacturerAr': 'الشركة',
          'warehouseId': 'wh1',
        };

        final banner = BannerModel.fromJson(json);

        expect(banner.id, equals('banner123'));
        expect(banner.imageUrl, equals('https://example.com/banner.jpg'));
        expect(banner.productId, equals('prod1'));
        expect(banner.manufacturerAr, equals('الشركة'));
        expect(banner.warehouseId, equals('wh1'));
      });

      test('creates instance from JSON without optional fields', () {
        final json = {
          'id': 'banner1',
          'imageUrl': 'https://example.com/banner.jpg',
        };

        final banner = BannerModel.fromJson(json);

        expect(banner.id, equals('banner1'));
        expect(banner.imageUrl, equals('https://example.com/banner.jpg'));
        expect(banner.productId, isNull);
        expect(banner.manufacturerAr, isNull);
        expect(banner.warehouseId, isNull);
      });

      test('handles null optional fields in JSON', () {
        final json = {
          'id': 'banner1',
          'imageUrl': 'url',
          'productId': null,
          'manufacturerAr': null,
          'warehouseId': null,
        };

        final banner = BannerModel.fromJson(json);

        expect(banner.productId, isNull);
        expect(banner.manufacturerAr, isNull);
        expect(banner.warehouseId, isNull);
        expect(banner.isTappable, isFalse);
      });

      test('creates tappable banner from JSON with all fields', () {
        final json = {
          'id': 'banner1',
          'imageUrl': 'url',
          'productId': 'prod1',
          'manufacturerAr': 'Mfg',
          'warehouseId': 'wh1',
        };

        final banner = BannerModel.fromJson(json);

        expect(banner.isTappable, isTrue);
      });
    });
  });
}
