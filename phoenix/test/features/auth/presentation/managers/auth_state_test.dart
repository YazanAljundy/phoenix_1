import 'package:flutter_test/flutter_test.dart';
import 'package:phoenix/features/auth/data/models/pharmacy_model.dart';
import 'package:phoenix/features/auth/data/models/user_model.dart';
import 'package:phoenix/features/auth/presentation/managers/auth_state.dart';

void main() {
  group('AuthState', () {
    group('constructor', () {
      test('creates instance with default values', () {
        const state = AuthState();

        expect(state.sessionStatus, equals(SessionStatus.unknown));
        expect(state.isSubmitting, isFalse);
        expect(state.errorMessage, isNull);
        expect(state.otpSent, isFalse);
        expect(state.user, isNull);
        expect(state.pharmacy, isNull);
      });

      test('creates instance with custom values', () {
        const user = UserModel(
          id: 'user1',
          name: 'John',
          phone: '0993123456',
          role: 'pharmacy',
          status: 'active',
          lang: 'ar',
        );

        const state = AuthState(
          sessionStatus: SessionStatus.active,
          isSubmitting: false,
          errorMessage: null,
          otpSent: true,
          user: user,
        );

        expect(state.sessionStatus, equals(SessionStatus.active));
        expect(state.isSubmitting, isFalse);
        expect(state.otpSent, isTrue);
        expect(state.user, equals(user));
      });
    });

    group('copyWith', () {
      test('copies with updated sessionStatus', () {
        const originalState = AuthState(sessionStatus: SessionStatus.unknown);

        final newState = originalState.copyWith(
          sessionStatus: SessionStatus.active,
        );

        expect(newState.sessionStatus, equals(SessionStatus.active));
        expect(newState.isSubmitting, equals(originalState.isSubmitting));
      });

      test('copies with updated isSubmitting', () {
        const originalState = AuthState(isSubmitting: false);

        final newState = originalState.copyWith(isSubmitting: true);

        expect(newState.isSubmitting, isTrue);
        expect(newState.sessionStatus, equals(originalState.sessionStatus));
      });

      test('copies with error message', () {
        const originalState = AuthState(errorMessage: null);

        final newState = originalState.copyWith(errorMessage: 'Login failed');

        expect(newState.errorMessage, equals('Login failed'));
      });

      test('clears error message when clearError is true', () {
        const originalState = AuthState(errorMessage: 'Some error');

        final newState = originalState.copyWith(clearError: true);

        expect(newState.errorMessage, isNull);
      });

      test('preserves error when errorMessage is not provided', () {
        const originalState = AuthState(errorMessage: 'Original error');

        final newState = originalState.copyWith(isSubmitting: true);

        expect(newState.errorMessage, equals('Original error'));
      });

      test('replaces error when new errorMessage provided', () {
        const originalState = AuthState(errorMessage: 'Original error');

        final newState = originalState.copyWith(errorMessage: 'New error');

        expect(newState.errorMessage, equals('New error'));
      });

      test('updates otpSent flag', () {
        const originalState = AuthState(otpSent: false);

        final newState = originalState.copyWith(otpSent: true);

        expect(newState.otpSent, isTrue);
      });

      test('updates user', () {
        const user = UserModel(
          id: 'user1',
          name: 'John',
          phone: '0993123456',
          role: 'pharmacy',
          status: 'active',
          lang: 'ar',
        );

        const originalState = AuthState(user: null);

        final newState = originalState.copyWith(user: user);

        expect(newState.user, equals(user));
      });

      test('updates pharmacy', () {
        const pharmacy = PharmacyModel(
          id: 'pharm1',
          nameAr: 'صيدليتي',
          nameEn: 'My Pharmacy',
          ownerName: 'John',
          address: 'Main St',
          city: 'Damascus',
          phone: '0993123456',
        );

        const originalState = AuthState(pharmacy: null);

        final newState = originalState.copyWith(pharmacy: pharmacy);

        expect(newState.pharmacy, equals(pharmacy));
      });

      test('copies with multiple fields', () {
        const user = UserModel(
          id: 'user1',
          name: 'John',
          phone: '0993123456',
          role: 'pharmacy',
          status: 'active',
          lang: 'ar',
        );

        const originalState = AuthState(
          sessionStatus: SessionStatus.unknown,
          isSubmitting: false,
          errorMessage: null,
        );

        final newState = originalState.copyWith(
          sessionStatus: SessionStatus.active,
          isSubmitting: false,
          user: user,
          otpSent: true,
        );

        expect(newState.sessionStatus, equals(SessionStatus.active));
        expect(newState.user, equals(user));
        expect(newState.otpSent, isTrue);
      });

      test('clearError takes precedence over errorMessage', () {
        const originalState = AuthState(errorMessage: 'Original error');

        final newState = originalState.copyWith(
          errorMessage: 'New error',
          clearError: true,
        );

        expect(newState.errorMessage, isNull);
      });
    });

    group('SessionStatus enum', () {
      test('has correct values', () {
        expect(SessionStatus.unknown, isNotNull);
        expect(SessionStatus.unauthenticated, isNotNull);
        expect(SessionStatus.offline, isNotNull);
        expect(SessionStatus.pendingApproval, isNotNull);
        expect(SessionStatus.blocked, isNotNull);
        expect(SessionStatus.active, isNotNull);
      });
    });
  });
}
