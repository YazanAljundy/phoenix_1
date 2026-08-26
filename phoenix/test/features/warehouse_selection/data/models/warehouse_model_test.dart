import 'package:flutter_test/flutter_test.dart';
import 'package:phoenix/features/warehouse_selection/data/models/warehouse_model.dart';

void main() {
  group('WarehouseModel', () {
    group('constructor', () {
      test('creates instance with required parameters', () {
        const warehouse = WarehouseModel(
          id: 'wh1',
          nameAr: 'مستودع دمشق',
          nameEn: 'Damascus Warehouse',
          city: 'Damascus',
          phone: '+96311234567',
        );

        expect(warehouse.id, equals('wh1'));
        expect(warehouse.nameAr, equals('مستودع دمشق'));
        expect(warehouse.nameEn, equals('Damascus Warehouse'));
        expect(warehouse.city, equals('Damascus'));
        expect(warehouse.phone, equals('+96311234567'));
        expect(warehouse.logo, isNull);
      });

      test('creates instance with logo', () {
        const warehouse = WarehouseModel(
          id: 'wh2',
          nameAr: 'مستودع حلب',
          nameEn: 'Aleppo Warehouse',
          city: 'Aleppo',
          phone: '+96321234567',
          logo: 'https://example.com/logo.png',
        );

        expect(warehouse.logo, equals('https://example.com/logo.png'));
      });
    });

    group('fromJson', () {
      test('creates instance from JSON', () {
        final json = {
          'id': 'wh123',
          'nameAr': 'مستودع دمشق',
          'nameEn': 'Damascus Warehouse',
          'city': 'Damascus',
          'phone': '+96311234567',
          'logo': 'https://example.com/logo.png',
        };

        final warehouse = WarehouseModel.fromJson(json);

        expect(warehouse.id, equals('wh123'));
        expect(warehouse.nameAr, equals('مستودع دمشق'));
        expect(warehouse.nameEn, equals('Damascus Warehouse'));
        expect(warehouse.city, equals('Damascus'));
        expect(warehouse.phone, equals('+96311234567'));
        expect(warehouse.logo, equals('https://example.com/logo.png'));
      });

      test('handles missing logo field', () {
        final json = {
          'id': 'wh1',
          'nameAr': 'مستودع',
          'nameEn': 'Warehouse',
          'city': 'City',
          'phone': '0991234567',
        };

        final warehouse = WarehouseModel.fromJson(json);

        expect(warehouse.logo, isNull);
      });

      test('handles null logo field', () {
        final json = {
          'id': 'wh1',
          'nameAr': 'مستودع',
          'nameEn': 'Warehouse',
          'city': 'City',
          'phone': '0991234567',
          'logo': null,
        };

        final warehouse = WarehouseModel.fromJson(json);

        expect(warehouse.logo, isNull);
      });

      test('parses all string fields correctly', () {
        final json = {
          'id': 'id123',
          'nameAr': 'الاسم العربي',
          'nameEn': 'English Name',
          'city': 'City Name',
          'phone': '+1234567890',
        };

        final warehouse = WarehouseModel.fromJson(json);

        expect(warehouse.id, isNotEmpty);
        expect(warehouse.nameAr, isNotEmpty);
        expect(warehouse.nameEn, isNotEmpty);
        expect(warehouse.city, isNotEmpty);
        expect(warehouse.phone, isNotEmpty);
      });

      test('maintains string values without modification', () {
        final json = {
          'id': 'wh-special-001',
          'nameAr': 'مستودع خاص',
          'nameEn': 'Special Warehouse',
          'city': 'damascus',
          'phone': '0991234567',
          'logo': 'http://example.com/img.png',
        };

        final warehouse = WarehouseModel.fromJson(json);

        expect(warehouse.id, equals('wh-special-001'));
        expect(warehouse.nameAr, equals('مستودع خاص'));
        expect(warehouse.city, equals('damascus'));
      });
    });

    group('equality', () {
      test('same warehouse IDs indicate same warehouse', () {
        final json1 = {
          'id': 'wh123',
          'nameAr': 'مستودع',
          'nameEn': 'Warehouse',
          'city': 'City',
          'phone': '0991234567',
        };

        final warehouse1 = WarehouseModel.fromJson(json1);
        final warehouse2 = WarehouseModel.fromJson(json1);

        expect(warehouse1.id, equals(warehouse2.id));
      });
    });
  });
}
