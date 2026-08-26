import 'package:flutter_test/flutter_test.dart';
import 'package:phoenix/core/utils/currency_formatter.dart';

void main() {
  group('Currency Formatters', () {
    group('formatUsdApprox', () {
      test('converts SYP to USD with valid rate', () {
        final result = formatUsdApprox(15000, 5000.0);
        expect(result, equals('~\$3.0'));
      });

      test('returns null when rate is null', () {
        final result = formatUsdApprox(15000, null);
        expect(result, isNull);
      });

      test('returns null when rate is zero', () {
        final result = formatUsdApprox(15000, 0.0);
        expect(result, isNull);
      });

      test('returns null when rate is negative', () {
        final result = formatUsdApprox(15000, -100.0);
        expect(result, isNull);
      });

      test('handles small amounts', () {
        final result = formatUsdApprox(100, 2000.0);
        expect(result, equals('~\$0.1'));
      });

      test('handles large amounts', () {
        final result = formatUsdApprox(1000000, 5000.0);
        expect(result, equals('~\$200.0'));
      });

      test('formats with one decimal place', () {
        final result = formatUsdApprox(12345, 5000.0);
        expect(result, contains('.'));
        final parts = result!.split('.');
        expect(parts[1], hasLength(1));
      });

      test('handles fractional amounts', () {
        final result = formatUsdApprox(5555, 5000.0);
        expect(result, isNotNull);
        expect(result, contains('\$'));
      });

      test('handles zero SYP amount', () {
        final result = formatUsdApprox(0, 5000.0);
        expect(result, equals('~\$0.0'));
      });
    });

    group('formatSypApprox', () {
      test('converts USD to SYP with valid rate', () {
        final result = formatSypApprox(10, 5000.0, 'ل.س');
        expect(result, equals('~50000 ل.س'));
      });

      test('returns null when rate is null', () {
        final result = formatSypApprox(10, null, 'ل.س');
        expect(result, isNull);
      });

      test('returns null when rate is zero', () {
        final result = formatSypApprox(10, 0.0, 'ل.س');
        expect(result, isNull);
      });

      test('returns null when rate is negative', () {
        final result = formatSypApprox(10, -100.0, 'ل.س');
        expect(result, isNull);
      });

      test('includes currency suffix', () {
        final result = formatSypApprox(5, 4000.0, 'ل.س');
        expect(result, contains('ل.س'));
      });

      test('formats as integer without decimal places', () {
        final result = formatSypApprox(7.5, 5000.0, 'ل.س');
        expect(result, equals('~37500 ل.س'));
      });

      test('handles fractional USD amounts', () {
        final result = formatSypApprox(2.5, 5000.0, 'ل.س');
        expect(result, equals('~12500 ل.س'));
      });

      test('handles different currency suffixes', () {
        final result1 = formatSypApprox(10, 5000.0, 'ل.س');
        final result2 = formatSypApprox(10, 5000.0, 'SYP');

        expect(result1, contains('ل.س'));
        expect(result2, contains('SYP'));
      });

      test('handles zero USD amount', () {
        final result = formatSypApprox(0, 5000.0, 'ل.س');
        expect(result, equals('~0 ل.س'));
      });

      test('handles small amounts', () {
        final result = formatSypApprox(0.01, 5000.0, 'ل.س');
        expect(result, contains('ل.س'));
      });

      test('handles large amounts', () {
        final result = formatSypApprox(1000, 5000.0, 'ل.س');
        expect(result, equals('~5000000 ل.س'));
      });
    });
  });
}
