import 'package:flutter_test/flutter_test.dart';
import 'package:phoenix/core/utils/currency_formatter.dart';

void main() {
  group('Currency formatters (SYP-primary)', () {
    group('formatSyp', () {
      test('groups thousands and appends the suffix', () {
        expect(formatSyp(100000, 'ل.س'), equals('100,000 ل.س'));
        expect(formatSyp(1500000, 'ل.س'), equals('1,500,000 ل.س'));
        expect(formatSyp(750, 'SYP'), equals('750 SYP'));
      });

      test('rounds to a whole lira', () {
        expect(formatSyp(12345.7, 'ل.س'), equals('12,346 ل.س'));
      });

      test('handles zero and negative amounts', () {
        expect(formatSyp(0, 'ل.س'), equals('0 ل.س'));
        expect(formatSyp(-5000, 'ل.س'), equals('-5,000 ل.س'));
      });
    });

    group('formatUsd', () {
      test('formats with two decimals and a leading dollar sign', () {
        expect(formatUsd(25), equals('\$25.00'));
        expect(formatUsd(2.5), equals('\$2.50'));
      });
    });

    group('sypFromUsd', () {
      test('multiplies by the rate and rounds, matching order pricing', () {
        expect(sypFromUsd(10, 5000.0), equals(50000));
        expect(sypFromUsd(2.53, 130.0), equals(329));
      });

      test('returns null for a missing or non-positive rate', () {
        expect(sypFromUsd(10, null), isNull);
        expect(sypFromUsd(10, 0.0), isNull);
        expect(sypFromUsd(10, -1.0), isNull);
      });
    });

    group('formatMoneyFromUsd', () {
      test('shows the converted SYP figure when a rate is available', () {
        expect(formatMoneyFromUsd(25, 1000.0, 'ل.س'), equals('25,000 ل.س'));
      });

      test('falls back to the plain USD figure when no rate is loaded', () {
        expect(formatMoneyFromUsd(25, null, 'ل.س'), equals('\$25.00'));
      });
    });

    group('usdHintFromUsd', () {
      test('renders an approximate dollar hint when a rate is available', () {
        expect(usdHintFromUsd(25, 1000.0), equals('~\$25.00'));
      });

      test('returns null when there is no rate to contrast with', () {
        expect(usdHintFromUsd(25, null), isNull);
      });
    });

    group('formatUsdApprox', () {
      test('converts a SYP-native amount to an approximate USD hint', () {
        expect(formatUsdApprox(15000, 5000.0), equals('~\$3.00'));
        expect(formatUsdApprox(0, 5000.0), equals('~\$0.00'));
      });

      test('returns null for a missing or non-positive rate', () {
        expect(formatUsdApprox(15000, null), isNull);
        expect(formatUsdApprox(15000, 0.0), isNull);
        expect(formatUsdApprox(15000, -100.0), isNull);
      });
    });
  });
}
