import 'package:flutter_test/flutter_test.dart';
import 'package:feniq/core/utils/validators.dart';
import 'package:feniq/core/widgets/phone_text_field.dart';

void main() {
  group('phoneTextFieldFullValue', () {
    // The field sits behind a fixed "09" box, so the user normally types only
    // the 8 subscriber digits - but a paste can still arrive in any of the
    // shapes the old free-text login field accepted. All of them have to
    // converge on the single international value the backend stores.
    const expectedInternational = '+963912345678';

    test('the 8 subscriber digits after the "09" box (the typed case)', () {
      expect(phoneTextFieldFullValue('12345678'), expectedInternational);
    });

    test('a pasted 9XXXXXXXX keeps its own mobile 9 rather than doubling it', () {
      expect(phoneTextFieldFullValue('912345678'), expectedInternational);
    });

    test('a pasted 09XXXXXXXX drops the redundant local prefix', () {
      expect(phoneTextFieldFullValue('0912345678'), expectedInternational);
    });

    test('a pasted 963XXXXXXXXX drops the redundant country code', () {
      expect(phoneTextFieldFullValue('963912345678'), expectedInternational);
    });

    test('a pasted +963 number - digitsOnly already stripped the +', () {
      expect(phoneTextFieldFullValue('+963912345678'), expectedInternational);
    });

    group('separators inside a pasted number are ignored', () {
      for (final input in const [
        '12 345 678',
        '09 1234 5678',
        '+963 912 345 678',
        '963-912-345-678',
      ]) {
        test('"$input"', () {
          expect(phoneTextFieldFullValue(input), expectedInternational);
        });
      }
    });

    group('the composed value passes the existing phone validator', () {
      for (final input in const [
        '12345678',
        '912345678',
        '0912345678',
        '963912345678',
        '+963912345678',
        '09 1234 5678',
      ]) {
        test('"$input" is accepted', () {
          expect(
            Validators.validatePhone(
              phoneTextFieldFullValue(input),
              requiredMessage: 'Required',
              invalidMessage: 'Invalid',
            ),
            isNull,
          );
        });
      }
    });

    group('malformed input is passed through (validator still rejects it)', () {
      test('an empty field composes to empty, so it reads as "required"', () {
        expect(phoneTextFieldFullValue(''), '');
        expect(
          Validators.validatePhone(
            phoneTextFieldFullValue(''),
            requiredMessage: 'Required',
            invalidMessage: 'Invalid',
          ),
          'Required',
        );
      });

      test('a too-short number is rejected, not padded', () {
        expect(phoneTextFieldFullValue('123'), '+9639123');
        expect(
          Validators.validatePhone(
            phoneTextFieldFullValue('123'),
            requiredMessage: 'Required',
            invalidMessage: 'Invalid',
          ),
          'Invalid',
        );
      });

      test('a too-long number is rejected, not truncated', () {
        expect(
          Validators.validatePhone(
            phoneTextFieldFullValue('1234567890123'),
            requiredMessage: 'Required',
            invalidMessage: 'Invalid',
          ),
          'Invalid',
        );
      });
    });
  });

  group('phoneTextFieldSubscriberDigits', () {
    test('peels every redundant prefix down to the same 8 digits', () {
      for (final input in const [
        '12345678',
        '912345678',
        '0912345678',
        '963912345678',
        '+963912345678',
      ]) {
        expect(phoneTextFieldSubscriberDigits(input), '12345678', reason: input);
      }
    });

    test('imposes no length limit of its own', () {
      expect(phoneTextFieldSubscriberDigits('1234567890123'), '1234567890123');
    });
  });
}
