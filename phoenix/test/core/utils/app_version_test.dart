import 'package:flutter_test/flutter_test.dart';
import 'package:phoenix/core/utils/app_version.dart';

void main() {
  group('AppVersion.parse', () {
    test('parses x.y.z and pads a missing patch', () {
      expect(AppVersion.parse('1.2.3'), [1, 2, 3]);
      expect(AppVersion.parse('1.2'), [1, 2, 0]);
      expect(AppVersion.parse('2'), [2, 0, 0]);
    });

    test('drops build metadata and pre-release tags', () {
      expect(AppVersion.parse('1.2.0+15'), [1, 2, 0]);
      expect(AppVersion.parse('1.2.0-beta.1'), [1, 2, 0]);
      expect(AppVersion.parse(' 1.2.0+7 '), [1, 2, 0]);
    });

    test('returns null for anything non-numeric / empty', () {
      expect(AppVersion.parse(''), isNull);
      expect(AppVersion.parse('   '), isNull);
      expect(AppVersion.parse('abc'), isNull);
      expect(AppVersion.parse('1.x.0'), isNull);
      expect(AppVersion.parse('1..0'), isNull);
      expect(AppVersion.parse('-1.0.0'), isNull);
    });
  });

  group('AppVersion.compare (numeric, not string)', () {
    test('1.0.10 is newer than 1.0.9', () {
      expect(AppVersion.compare('1.0.10', '1.0.9'), 1);
      expect(AppVersion.compare('1.0.9', '1.0.10'), -1);
      expect(AppVersion.isLessThan('1.0.9', '1.0.10'), isTrue);
      expect(AppVersion.isLessThan('1.0.10', '1.0.9'), isFalse);
    });

    test('ordering across the range', () {
      expect(AppVersion.compare('1.0.9', '1.0.10'), -1);
      expect(AppVersion.compare('1.0.10', '1.1.0'), -1);
      expect(AppVersion.compare('1.1.0', '2.0.0'), -1);
      expect(AppVersion.compare('2.0.0', '1.9.9'), 1);
    });

    test('equal versions, incl. differing build metadata', () {
      expect(AppVersion.compare('1.2.0', '1.2.0'), 0);
      expect(AppVersion.compare('1.2.0+15', '1.2.0+3'), 0);
      expect(AppVersion.isLessThan('1.2.0', '1.2.0'), isFalse);
    });

    test('an unparseable side makes compare null and isLessThan false', () {
      expect(AppVersion.compare('nope', '1.0.0'), isNull);
      expect(AppVersion.compare('1.0.0', ''), isNull);
      expect(AppVersion.isLessThan('1.0.0', 'garbage'), isFalse);
      expect(AppVersion.isLessThan('garbage', '9.9.9'), isFalse);
    });
  });
}
