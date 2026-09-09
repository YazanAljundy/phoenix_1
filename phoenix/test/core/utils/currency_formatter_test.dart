import 'package:flutter_test/flutter_test.dart';
import 'package:feniq/core/utils/currency_formatter.dart';

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

      // Never the USD figure - the pharmacist only ever sees SYP or a dash.
      test('shows the unavailable placeholder when no rate is loaded', () {
        expect(formatMoneyFromUsd(25, null, 'ل.س'), equals(kMoneyUnavailable));
        expect(formatMoneyFromUsd(25, 0.0, 'ل.س'), equals(kMoneyUnavailable));
      });

      test('never emits a dollar sign', () {
        expect(formatMoneyFromUsd(25, 1000.0, 'ل.س'), isNot(contains('\$')));
        expect(formatMoneyFromUsd(25, null, 'ل.س'), isNot(contains('\$')));
      });
    });
  });
}
