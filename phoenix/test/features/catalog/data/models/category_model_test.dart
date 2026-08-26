import 'package:flutter_test/flutter_test.dart';
import 'package:phoenix/features/catalog/data/models/category_model.dart';

void main() {
  group('CategoryModel', () {
    group('constructor', () {
      test('creates instance with all required parameters', () {
        const category = CategoryModel(
          id: 'cat1',
          nameAr: 'أدوية',
          nameEn: 'Medicines',
          icon: 'icon_url',
          sortOrder: 1,
        );

        expect(category.id, equals('cat1'));
        expect(category.nameAr, equals('أدوية'));
        expect(category.nameEn, equals('Medicines'));
        expect(category.icon, equals('icon_url'));
        expect(category.sortOrder, equals(1));
      });

      test('creates instance with null icon', () {
        const category = CategoryModel(
          id: 'cat2',
          nameAr: 'مكملات',
          nameEn: 'Supplements',
          sortOrder: 2,
        );

        expect(category.icon, isNull);
      });
    });

    group('fromJson', () {
      test('parses JSON correctly', () {
        final json = {
          'id': 'cat123',
          'nameAr': 'أدوية',
          'nameEn': 'Medicines',
          'icon': 'https://example.com/icon.png',
          'sortOrder': 5,
        };

        final category = CategoryModel.fromJson(json);

        expect(category.id, equals('cat123'));
        expect(category.nameAr, equals('أدوية'));
        expect(category.nameEn, equals('Medicines'));
        expect(category.icon, equals('https://example.com/icon.png'));
        expect(category.sortOrder, equals(5));
      });

      test('handles missing icon in JSON', () {
        final json = {
          'id': 'cat1',
          'nameAr': 'مكملات',
          'nameEn': 'Supplements',
          'sortOrder': 2,
        };

        final category = CategoryModel.fromJson(json);

        expect(category.icon, isNull);
      });

      test('defaults sortOrder to 0 when missing', () {
        final json = {'id': 'cat1', 'nameAr': 'فئة', 'nameEn': 'Category'};

        final category = CategoryModel.fromJson(json);

        expect(category.sortOrder, equals(0));
      });

      test('handles all fields from JSON', () {
        final json = {
          'id': 'id1',
          'nameAr': 'عربي',
          'nameEn': 'English',
          'icon': 'icon',
          'sortOrder': 10,
        };

        final category = CategoryModel.fromJson(json);

        expect(category.id, isNotEmpty);
        expect(category.nameAr, isNotEmpty);
        expect(category.nameEn, isNotEmpty);
      });
    });
  });
}
