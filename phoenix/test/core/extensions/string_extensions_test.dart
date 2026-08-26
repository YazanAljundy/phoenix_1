import 'package:flutter_test/flutter_test.dart';
import 'package:phoenix/core/extensions/string_extensions.dart';

void main() {
  group('StringExtensions', () {
    group('isValidEmail', () {
      test('validates correct email addresses', () {
        expect('user@example.com'.isValidEmail, isTrue);
        expect('john.doe@company.co.uk'.isValidEmail, isTrue);
        expect('test+tag@email.com'.isValidEmail, isTrue);
      });

      test('rejects invalid email addresses', () {
        expect('invalid.email'.isValidEmail, isFalse);
        expect('user@'.isValidEmail, isFalse);
        expect('@example.com'.isValidEmail, isFalse);
      });

      test('rejects empty email', () {
        expect(''.isValidEmail, isFalse);
      });

      test('rejects email with spaces', () {
        expect('user @example.com'.isValidEmail, isFalse);
        expect('user@ example.com'.isValidEmail, isFalse);
      });

      test('accepts various valid formats', () {
        expect('a@b.c'.isValidEmail, isTrue);
        expect('test.email+alias@example.co.uk'.isValidEmail, isTrue);
        expect('1234567890@example.com'.isValidEmail, isTrue);
      });

      test('accepts emails with special characters in local part', () {
        expect('user.name+tag@example.com'.isValidEmail, isTrue);
        expect('test!#&@example.com'.isValidEmail, isTrue);
      });

      test('rejects multiple @ symbols', () {
        expect('user@domain@example.com'.isValidEmail, isFalse);
      });

      test('accepts emails with and without TLD', () {
        expect('user@localhost'.isValidEmail, isTrue);
        expect('user@domain'.isValidEmail, isTrue);
      });
    });

    group('isValidPassword', () {
      test('validates password with minimum 6 characters', () {
        expect('Pass123'.isValidPassword, isTrue);
        expect('123456'.isValidPassword, isTrue);
      });

      test('rejects password with less than 6 characters', () {
        expect('Pass1'.isValidPassword, isFalse);
        expect('12345'.isValidPassword, isFalse);
        expect(''.isValidPassword, isFalse);
      });

      test('accepts password with exactly 6 characters', () {
        expect('pass12'.isValidPassword, isTrue);
      });

      test('accepts password with more than 6 characters', () {
        expect('VeryLongPassword123'.isValidPassword, isTrue);
        expect('pass1234567890'.isValidPassword, isTrue);
      });

      test('trims whitespace before validation', () {
        expect('  pass123  '.isValidPassword, isTrue);
        expect('  12345  '.isValidPassword, isFalse);
      });

      test('accepts passwords with special characters', () {
        expect('Pass@123'.isValidPassword, isTrue);
        expect('P@ss#\$%'.isValidPassword, isTrue);
      });

      test('accepts passwords with only numbers', () {
        expect('123456'.isValidPassword, isTrue);
      });

      test('accepts passwords with only letters', () {
        expect('password'.isValidPassword, isTrue);
      });

      test('handles whitespace-only strings', () {
        expect('      '.isValidPassword, isFalse);
      });
    });
  });
}
