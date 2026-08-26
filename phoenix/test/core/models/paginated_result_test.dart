import 'package:flutter_test/flutter_test.dart';
import 'package:phoenix/core/models/paginated_result.dart';

void main() {
  group('PaginatedResult', () {
    group('constructor', () {
      test('creates instance with required parameters', () {
        const items = ['item1', 'item2'];
        const result = PaginatedResult(
          items: items,
          hasMore: true,
          nextCursor: 'cursor123',
        );

        expect(result.items, equals(items));
        expect(result.hasMore, isTrue);
        expect(result.nextCursor, equals('cursor123'));
      });

      test('creates instance with null nextCursor', () {
        const items = ['item1', 'item2'];
        const result = PaginatedResult(items: items, hasMore: false);

        expect(result.items, equals(items));
        expect(result.hasMore, isFalse);
        expect(result.nextCursor, isNull);
      });

      test('creates instance with empty items list', () {
        const result = PaginatedResult(items: [], hasMore: false);

        expect(result.items, isEmpty);
        expect(result.hasMore, isFalse);
      });
    });

    group('fromJson', () {
      test('parses JSON correctly with pagination metadata', () {
        final json = {
          'items': [
            {'id': '1', 'name': 'item1'},
            {'id': '2', 'name': 'item2'},
          ],
          'pagination': {'hasMore': true, 'nextCursor': 'cursor123'},
        };

        final result = PaginatedResult.fromJson(
          json,
          'items',
          (Map<String, dynamic> json) => json['id'] as String,
        );

        expect(result.items, equals(['1', '2']));
        expect(result.hasMore, isTrue);
        expect(result.nextCursor, equals('cursor123'));
      });

      test('handles missing pagination object', () {
        final json = {
          'items': [
            {'id': '1', 'name': 'item1'},
          ],
        };

        final result = PaginatedResult.fromJson(
          json,
          'items',
          (Map<String, dynamic> json) => json['id'] as String,
        );

        expect(result.items, equals(['1']));
        expect(result.hasMore, isFalse);
        expect(result.nextCursor, isNull);
      });

      test('handles empty items list', () {
        final json = {
          'items': [],
          'pagination': {'hasMore': false},
        };

        final result = PaginatedResult.fromJson(
          json,
          'items',
          (Map<String, dynamic> json) => json['id'] as String,
        );

        expect(result.items, isEmpty);
        expect(result.hasMore, isFalse);
      });

      test('uses custom itemsKey correctly', () {
        final json = {
          'products': [
            {'id': 'p1'},
            {'id': 'p2'},
          ],
          'pagination': {'hasMore': true, 'nextCursor': 'next'},
        };

        final result = PaginatedResult.fromJson(
          json,
          'products',
          (Map<String, dynamic> json) => json['id'] as String,
        );

        expect(result.items, equals(['p1', 'p2']));
        expect(result.hasMore, isTrue);
      });

      test('handles pagination with null hasMore', () {
        final json = {
          'items': [
            {'id': '1'},
          ],
          'pagination': {'nextCursor': 'cursor'},
        };

        final result = PaginatedResult.fromJson(
          json,
          'items',
          (Map<String, dynamic> json) => json['id'] as String,
        );

        expect(result.hasMore, isFalse);
        expect(result.nextCursor, equals('cursor'));
      });
    });
  });
}
