import 'package:flutter_test/flutter_test.dart';
import 'package:phoenix/core/utils/validators.dart';

void main() {
  group('Validators', () {
    group('validateEmail', () {
      test('returns null for valid email', () {
        const validEmail = 'test@example.com';
        expect(Validators.validateEmail(validEmail), isNull);
      });

      test('returns error for empty email', () {
        expect(Validators.validateEmail(''), isNotNull);
      });

      test('returns error for null email', () {
        expect(Validators.validateEmail(null), isNotNull);
      });

      test('returns error for invalid email format', () {
        expect(Validators.validateEmail('invalid-email'), isNotNull);
      });

      test('returns error for email with spaces', () {
        expect(Validators.validateEmail('test @example.com'), isNotNull);
      });
    });

    group('validatePassword', () {
      test('returns null for valid password', () {
        const validPassword = 'Password123!';
        expect(Validators.validatePassword(validPassword), isNull);
      });

      test('returns error for empty password', () {
        expect(Validators.validatePassword(''), isNotNull);
      });

      test('returns error for null password', () {
        expect(Validators.validatePassword(null), isNotNull);
      });

      test('returns error for password less than 6 characters', () {
        expect(Validators.validatePassword('Pass1'), isNotNull);
      });
    });

    group('validatePhone', () {
      test('returns null for valid Syrian phone with +963', () {
        const validPhone = '+963931234567';
        expect(
          Validators.validatePhone(
            validPhone,
            requiredMessage: 'Required',
            invalidMessage: 'Invalid',
          ),
          isNull,
        );
      });

      test('returns null for valid Syrian phone starting with 0', () {
        const validPhone = '0931234567';
        expect(
          Validators.validatePhone(
            validPhone,
            requiredMessage: 'Required',
            invalidMessage: 'Invalid',
          ),
          isNull,
        );
      });

      test('returns error for empty phone', () {
        expect(
          Validators.validatePhone(
            '',
            requiredMessage: 'Required',
            invalidMessage: 'Invalid',
          ),
          equals('Required'),
        );
      });

      test('returns error for null phone', () {
        expect(
          Validators.validatePhone(
            null,
            requiredMessage: 'Required',
            invalidMessage: 'Invalid',
          ),
          equals('Required'),
        );
      });

      test('returns error for invalid phone format', () {
        const invalidPhone = '123456';
        expect(
          Validators.validatePhone(
            invalidPhone,
            requiredMessage: 'Required',
            invalidMessage: 'Invalid',
          ),
          equals('Invalid'),
        );
      });

      test('returns null for phone with spaces and dashes', () {
        const phoneWithSpaces = '0993 123 456';
        expect(
          Validators.validatePhone(
            phoneWithSpaces,
            requiredMessage: 'Required',
            invalidMessage: 'Invalid',
          ),
          isNull,
        );
      });
    });

    group('validateRequired', () {
      test('returns null for non-empty string', () {
        expect(Validators.validateRequired('value', 'Required'), isNull);
      });

      test('returns error message for empty string', () {
        expect(Validators.validateRequired('', 'Required'), equals('Required'));
      });

      test('returns error message for null value', () {
        expect(
          Validators.validateRequired(null, 'Required'),
          equals('Required'),
        );
      });

      test('returns error message for whitespace only', () {
        expect(
          Validators.validateRequired('   ', 'Required'),
          equals('Required'),
        );
      });
    });

    group('validateOtpCode', () {
      test('returns null for valid 6-digit OTP', () {
        expect(
          Validators.validateOtpCode(
            '123456',
            requiredMessage: 'Required',
            invalidMessage: 'Invalid',
          ),
          isNull,
        );
      });

      test('returns error for empty OTP', () {
        expect(
          Validators.validateOtpCode(
            '',
            requiredMessage: 'Required',
            invalidMessage: 'Invalid',
          ),
          equals('Required'),
        );
      });

      test('returns error for OTP with less than 6 digits', () {
        expect(
          Validators.validateOtpCode(
            '12345',
            requiredMessage: 'Required',
            invalidMessage: 'Invalid',
          ),
          equals('Invalid'),
        );
      });

      test('returns error for OTP with more than 6 digits', () {
        expect(
          Validators.validateOtpCode(
            '1234567',
            requiredMessage: 'Required',
            invalidMessage: 'Invalid',
          ),
          equals('Invalid'),
        );
      });

      test('returns error for OTP with non-digit characters', () {
        expect(
          Validators.validateOtpCode(
            '12345a',
            requiredMessage: 'Required',
            invalidMessage: 'Invalid',
          ),
          equals('Invalid'),
        );
      });

      test('returns null for OTP with leading spaces trimmed', () {
        expect(
          Validators.validateOtpCode(
            '  123456',
            requiredMessage: 'Required',
            invalidMessage: 'Invalid',
          ),
          isNull,
        );
      });
    });

    group('minPasswordLength', () {
      test('minPasswordLength is 6', () {
        expect(Validators.minPasswordLength, equals(6));
      });
    });
  });
}
