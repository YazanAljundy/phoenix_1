import 'package:flutter_test/flutter_test.dart';
import 'package:phoenix/features/auth/data/models/auth_response.dart';
import 'package:phoenix/features/auth/data/models/pharmacy_model.dart';
import 'package:phoenix/features/auth/data/models/user_model.dart';

void main() {
  group('AuthResponse', () {
    group('constructor', () {
      test('creates instance with required parameters', () {
        const user = UserModel(
          id: 'user1',
          name: 'John',
          phone: '0993123456',
          role: 'pharmacy',
          status: 'active',
          lang: 'ar',
        );

        const response = AuthResponse(token: 'token123', user: user);

        expect(response.token, equals('token123'));
        expect(response.user, equals(user));
        expect(response.pharmacy, isNull);
      });

      test('creates instance with pharmacy', () {
        const user = UserModel(
          id: 'user1',
          name: 'John',
          phone: '0993123456',
          role: 'pharmacy',
          status: 'active',
          lang: 'ar',
        );

        const pharmacy = PharmacyModel(
          id: 'pharm1',
          nameAr: 'صيدلية الأمل',
          nameEn: 'Hope Pharmacy',
          ownerName: 'John Doe',
          address: 'Main St',
          city: 'Damascus',
          phone: '0993123456',
        );

        const response = AuthResponse(
          token: 'token123',
          user: user,
          pharmacy: pharmacy,
        );

        expect(response.token, equals('token123'));
        expect(response.user, equals(user));
        expect(response.pharmacy, equals(pharmacy));
      });
    });

    group('fromJson', () {
      test('parses JSON without pharmacy', () {
        final json = {
          'token': 'jwt_token_123',
          'user': {
            'id': 'user1',
            'name': 'John Doe',
            'phone': '0993123456',
            'role': 'pharmacy',
            'status': 'active',
            'lang': 'ar',
          },
        };

        final response = AuthResponse.fromJson(json);

        expect(response.token, equals('jwt_token_123'));
        expect(response.user.id, equals('user1'));
        expect(response.user.name, equals('John Doe'));
        expect(response.pharmacy, isNull);
      });

      test('parses JSON with pharmacy', () {
        final json = {
          'token': 'jwt_token_123',
          'user': {
            'id': 'user1',
            'name': 'John Doe',
            'phone': '0993123456',
            'role': 'pharmacy',
            'status': 'active',
            'lang': 'ar',
          },
          'pharmacy': {
            'id': 'pharm1',
            'nameAr': 'صيدلية الأمل',
            'nameEn': 'Hope Pharmacy',
            'ownerName': 'John Doe',
            'address': 'Main St',
            'city': 'Damascus',
            'phone': '0993123456',
          },
        };

        final response = AuthResponse.fromJson(json);

        expect(response.token, equals('jwt_token_123'));
        expect(response.user.id, equals('user1'));
        expect(response.pharmacy?.id, equals('pharm1'));
        expect(response.pharmacy?.nameAr, equals('صيدلية الأمل'));
      });

      test('handles null pharmacy in JSON', () {
        final json = {
          'token': 'jwt_token',
          'user': {
            'id': 'user1',
            'name': 'Test User',
            'phone': '0993123456',
            'role': 'pharmacy',
            'status': 'pending',
            'lang': 'ar',
          },
          'pharmacy': null,
        };

        final response = AuthResponse.fromJson(json);

        expect(response.pharmacy, isNull);
      });
    });
  });
}
