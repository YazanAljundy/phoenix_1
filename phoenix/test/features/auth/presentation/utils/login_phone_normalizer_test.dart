import 'package:flutter_test/flutter_test.dart';
import 'package:phoenix/core/utils/validators.dart';
import 'package:phoenix/features/auth/presentation/utils/login_phone_normalizer.dart';

void main() {
  group('normalizeLoginPhone', () {
    // The four shapes the login field accepts -> the single international
    // value that must reach loginWithPassword().
    const expectedInternational = '+963912345678';

    test('09XXXXXXXX -> drops leading 0 and adds +963', () {
      expect(normalizeLoginPhone('0912345678'), expectedInternational);
    });

    test('9XXXXXXXX -> adds +963', () {
      expect(normalizeLoginPhone('912345678'), expectedInternational);
    });

    test('9639XXXXXXXX -> adds +', () {
      expect(normalizeLoginPhone('963912345678'), expectedInternational);
    });

    test('+9639XXXXXXXX -> unchanged', () {
      expect(normalizeLoginPhone('+963912345678'), expectedInternational);
    });

    group('whitespace is stripped before normalizing', () {
      test('spaces in a local 09.. number', () {
        expect(normalizeLoginPhone('09 1234 5678'), expectedInternational);
      });

      test('spaces in an international +963.. number', () {
        expect(normalizeLoginPhone('+963 912 345 678'), expectedInternational);
      });

      test('leading/trailing spaces', () {
        expect(normalizeLoginPhone('  912345678  '), expectedInternational);
      });

      test('tabs and other whitespace', () {
        expect(normalizeLoginPhone('963\t912 345678'), expectedInternational);
      });
    });

    group('the normalized value passes the existing phone validator', () {
      for (final input in const [
        '0912345678',
        '912345678',
        '963912345678',
        '+963912345678',
        '09 1234 5678',
        '+963 912 345 678',
      ]) {
        test('"$input" is accepted', () {
          expect(
            Validators.validatePhone(
              normalizeLoginPhone(input),
              requiredMessage: 'Required',
              invalidMessage: 'Invalid',
            ),
            isNull,
          );
        });
      }
    });

    group('malformed input is passed through (validator still rejects it)', () {
      test('empty string stays empty', () {
        expect(normalizeLoginPhone(''), '');
      });

      test('too short number is only whitespace-stripped', () {
        expect(normalizeLoginPhone('123 456'), '123456');
      });

      test('non-Syrian international number is untouched', () {
        expect(normalizeLoginPhone('+14155552671'), '+14155552671');
      });

      test('validator rejects a passed-through bad number', () {
        expect(
          Validators.validatePhone(
            normalizeLoginPhone('123456'),
            requiredMessage: 'Required',
            invalidMessage: 'Invalid',
          ),
          'Invalid',
        );
      });
    });
  });
}
