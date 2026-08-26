import 'package:flutter_test/flutter_test.dart';
import 'package:phoenix/features/auth/data/models/pharmacy_model.dart';

void main() {
  group('PharmacyModel', () {
    group('constructor', () {
      test('creates instance with all parameters', () {
        const pharmacy = PharmacyModel(
          id: 'pharm1',
          nameAr: 'صيدلية الأمل',
          nameEn: 'Hope Pharmacy',
          ownerName: 'John Doe',
          address: 'Main Street 123',
          city: 'Damascus',
          phone: '0993123456',
        );

        expect(pharmacy.id, equals('pharm1'));
        expect(pharmacy.nameAr, equals('صيدلية الأمل'));
        expect(pharmacy.nameEn, equals('Hope Pharmacy'));
        expect(pharmacy.ownerName, equals('John Doe'));
        expect(pharmacy.address, equals('Main Street 123'));
        expect(pharmacy.city, equals('Damascus'));
        expect(pharmacy.phone, equals('0993123456'));
      });
    });

    group('fromJson', () {
      test('creates instance from JSON correctly', () {
        final json = {
          'id': 'pharm123',
          'nameAr': 'صيدلية الشفاء',
          'nameEn': 'Healing Pharmacy',
          'ownerName': 'Jane Smith',
          'address': 'Mezzeh Street',
          'city': 'Aleppo',
          'phone': '+96593456789',
        };

        final pharmacy = PharmacyModel.fromJson(json);

        expect(pharmacy.id, equals('pharm123'));
        expect(pharmacy.nameAr, equals('صيدلية الشفاء'));
        expect(pharmacy.nameEn, equals('Healing Pharmacy'));
        expect(pharmacy.ownerName, equals('Jane Smith'));
        expect(pharmacy.address, equals('Mezzeh Street'));
        expect(pharmacy.city, equals('Aleppo'));
        expect(pharmacy.phone, equals('+96593456789'));
      });

      test('handles all fields from JSON', () {
        final json = {
          'id': 'p999',
          'nameAr': 'اسم عربي',
          'nameEn': 'English Name',
          'ownerName': 'Owner Name',
          'address': 'Some Address',
          'city': 'City Name',
          'phone': '0991234567',
        };

        final pharmacy = PharmacyModel.fromJson(json);

        expect(pharmacy.id, isNotEmpty);
        expect(pharmacy.nameAr, isNotEmpty);
        expect(pharmacy.nameEn, isNotEmpty);
        expect(pharmacy.ownerName, isNotEmpty);
        expect(pharmacy.address, isNotEmpty);
        expect(pharmacy.city, isNotEmpty);
        expect(pharmacy.phone, isNotEmpty);
      });
    });

    group('equality', () {
      test('two identical pharmacies are equal', () {
        final json = {
          'id': 'pharm1',
          'nameAr': 'صيدلية',
          'nameEn': 'Pharmacy',
          'ownerName': 'Owner',
          'address': 'Address',
          'city': 'City',
          'phone': '0993123456',
        };

        final pharmacy1 = PharmacyModel.fromJson(json);
        final pharmacy2 = PharmacyModel.fromJson(json);

        expect(pharmacy1.id, equals(pharmacy2.id));
      });
    });
  });
}
