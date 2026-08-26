import 'package:flutter_test/flutter_test.dart';
import 'package:phoenix/features/auth/data/models/user_model.dart';

void main() {
  group('UserModel', () {
    group('constructor', () {
      test('creates instance with required parameters', () {
        const user = UserModel(
          id: 'user123',
          name: 'John Doe',
          phone: '+96393123456',
          role: 'pharmacy',
          status: 'active',
          lang: 'ar',
        );

        expect(user.id, equals('user123'));
        expect(user.name, equals('John Doe'));
        expect(user.phone, equals('+96393123456'));
        expect(user.role, equals('pharmacy'));
        expect(user.status, equals('active'));
        expect(user.lang, equals('ar'));
      });
    });

    group('fromJson', () {
      test('creates instance from JSON', () {
        final json = {
          'id': 'user123',
          'name': 'John Doe',
          'phone': '+96393123456',
          'role': 'pharmacy',
          'status': 'active',
          'lang': 'ar',
        };

        final user = UserModel.fromJson(json);

        expect(user.id, equals('user123'));
        expect(user.name, equals('John Doe'));
        expect(user.phone, equals('+96393123456'));
        expect(user.role, equals('pharmacy'));
        expect(user.status, equals('active'));
        expect(user.lang, equals('ar'));
      });

      test('handles all fields correctly from JSON', () {
        final json = {
          'id': 'id456',
          'name': 'Jane Smith',
          'phone': '0993456789',
          'role': 'admin',
          'status': 'pending',
          'lang': 'en',
        };

        final user = UserModel.fromJson(json);

        expect(user.id, equals('id456'));
        expect(user.name, equals('Jane Smith'));
        expect(user.phone, equals('0993456789'));
        expect(user.role, equals('admin'));
        expect(user.status, equals('pending'));
        expect(user.lang, equals('en'));
      });
    });

    group('status getters', () {
      test('isPending returns true when status is pending', () {
        const user = UserModel(
          id: 'user1',
          name: 'User',
          phone: '0993123456',
          role: 'pharmacy',
          status: 'pending',
          lang: 'ar',
        );

        expect(user.isPending, isTrue);
        expect(user.isBlocked, isFalse);
        expect(user.isActive, isFalse);
      });

      test('isBlocked returns true when status is blocked', () {
        const user = UserModel(
          id: 'user1',
          name: 'User',
          phone: '0993123456',
          role: 'pharmacy',
          status: 'blocked',
          lang: 'ar',
        );

        expect(user.isPending, isFalse);
        expect(user.isBlocked, isTrue);
        expect(user.isActive, isFalse);
      });

      test('isActive returns true when status is active', () {
        const user = UserModel(
          id: 'user1',
          name: 'User',
          phone: '0993123456',
          role: 'pharmacy',
          status: 'active',
          lang: 'ar',
        );

        expect(user.isPending, isFalse);
        expect(user.isBlocked, isFalse);
        expect(user.isActive, isTrue);
      });

      test('all status getters are false for unknown status', () {
        const user = UserModel(
          id: 'user1',
          name: 'User',
          phone: '0993123456',
          role: 'pharmacy',
          status: 'unknown',
          lang: 'ar',
        );

        expect(user.isPending, isFalse);
        expect(user.isBlocked, isFalse);
        expect(user.isActive, isFalse);
      });
    });
  });
}
