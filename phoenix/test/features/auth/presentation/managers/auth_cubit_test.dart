import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:feniq/core/constants/storage_keys.dart';
import 'package:feniq/core/error/failure.dart';
import 'package:feniq/core/services/auth_event_bus.dart';
import 'package:feniq/core/services/fcm_service.dart';
import 'package:feniq/core/services/secure_storage_service.dart';
import 'package:feniq/features/auth/data/models/me_response.dart';
import 'package:feniq/features/auth/data/models/user_model.dart';
import 'package:feniq/features/auth/data/repositories/auth_repository_impl.dart';
import 'package:feniq/features/auth/presentation/managers/auth_cubit.dart';
import 'package:feniq/features/auth/presentation/managers/auth_state.dart';
import 'package:feniq/features/notifications/data/repositories/notification_repository.dart';

class MockAuthRepository extends Mock implements AuthRepositoryImpl {}

class MockSecureStorage extends Mock implements SecureStorageService {}

class MockFcmService extends Mock implements FcmService {}

class MockNotificationRepository extends Mock implements NotificationRepository {}

UserModel _user({String status = 'active'}) => UserModel(
  id: 'u1',
  name: 'Dr. Test',
  phone: '+963999999999',
  role: 'pharmacy',
  status: status,
  lang: 'ar',
);

void main() {
  // AuthCubit._goToLogin touches NavigationService's GlobalKey, which needs a
  // binding. In these unit tests currentContext is simply null (no navigator).
  TestWidgetsFlutterBinding.ensureInitialized();

  late MockAuthRepository repo;
  late MockSecureStorage storage;
  late MockFcmService fcm;
  late MockNotificationRepository notifications;

  AuthCubit build() => AuthCubit(
    authRepository: repo,
    secureStorage: storage,
    fcmService: fcm,
    notificationRepository: notifications,
  );

  setUp(() {
    repo = MockAuthRepository();
    storage = MockSecureStorage();
    fcm = MockFcmService();
    notifications = MockNotificationRepository();
    when(() => storage.delete(any())).thenAnswer((_) async {});
    when(() => storage.write(any(), any())).thenAnswer((_) async {});
    when(() => fcm.initialize()).thenAnswer((_) async {});
    when(() => fcm.unregisterDevice()).thenAnswer((_) async {});
    when(() => notifications.clear()).thenAnswer((_) async {});
  });

  group('checkSession - C1: only a real 401/403 clears the token', () {
    test('Test 1: no token -> unauthenticated, nothing deleted', () async {
      when(() => storage.read(StorageKeys.authToken)).thenAnswer((_) async => null);
      final cubit = build();

      await cubit.checkSession();

      expect(cubit.state.sessionStatus, SessionStatus.unauthenticated);
      verifyNever(() => repo.getMe());
      await cubit.close();
    });

    test('Test 2: valid token -> active', () async {
      when(() => storage.read(StorageKeys.authToken)).thenAnswer((_) async => 'jwt');
      when(() => repo.getMe()).thenAnswer((_) async => MeResponse(user: _user()));
      final cubit = build();

      await cubit.checkSession();

      expect(cubit.state.sessionStatus, SessionStatus.active);
      expect(cubit.state.user, isNotNull);
      verifyNever(() => storage.delete(any()));
      await cubit.close();
    });

    test('Test 3: 401 -> token deleted -> unauthenticated', () async {
      when(() => storage.read(StorageKeys.authToken)).thenAnswer((_) async => 'jwt');
      when(() => repo.getMe()).thenThrow(ServerFailure('Unauthorized', statusCode: 401));
      final cubit = build();

      await cubit.checkSession();

      expect(cubit.state.sessionStatus, SessionStatus.unauthenticated);
      verify(() => storage.delete(StorageKeys.authToken)).called(1);
      await cubit.close();
    });

    test('Test 4: network failure -> token PRESERVED -> offline (not login)', () async {
      when(() => storage.read(StorageKeys.authToken)).thenAnswer((_) async => 'jwt');
      when(() => repo.getMe()).thenThrow(
        ServerFailure('No Internet Connection', code: FailureCode.network),
      );
      final cubit = build();

      await cubit.checkSession();

      expect(cubit.state.sessionStatus, SessionStatus.offline);
      expect(cubit.state.sessionStatus, isNot(SessionStatus.unauthenticated));
      verifyNever(() => storage.delete(any()));
      await cubit.close();
    });

    test('Test 5: backend 500 -> token PRESERVED -> offline', () async {
      when(() => storage.read(StorageKeys.authToken)).thenAnswer((_) async => 'jwt');
      when(() => repo.getMe()).thenThrow(
        ServerFailure('Internal Server error', code: 'HTTP_500', statusCode: 500),
      );
      final cubit = build();

      await cubit.checkSession();

      expect(cubit.state.sessionStatus, SessionStatus.offline);
      verifyNever(() => storage.delete(any()));
      await cubit.close();
    });

    test('retry from offline: a later success reaches active, token untouched', () async {
      when(() => storage.read(StorageKeys.authToken)).thenAnswer((_) async => 'jwt');
      var call = 0;
      when(() => repo.getMe()).thenAnswer((_) async {
        call++;
        if (call == 1) throw ServerFailure('timeout', code: FailureCode.timeout);
        return MeResponse(user: _user());
      });
      final cubit = build();

      await cubit.checkSession();
      expect(cubit.state.sessionStatus, SessionStatus.offline);

      await cubit.checkSession();
      expect(cubit.state.sessionStatus, SessionStatus.active);
      verifyNever(() => storage.delete(any()));
      await cubit.close();
    });
  });

  group('C2: a 401 signalled on the bus logs out once', () {
    test('Test 6: bus 401 -> token cleared -> unauthenticated', () async {
      when(() => storage.read(StorageKeys.authToken)).thenAnswer((_) async => 'jwt');
      when(() => repo.getMe()).thenAnswer((_) async => MeResponse(user: _user()));
      final cubit = build();
      await cubit.checkSession();
      expect(cubit.state.sessionStatus, SessionStatus.active);

      AuthEventBus.instance.emitUnauthorized();
      await pumpEventQueue();

      expect(cubit.state.sessionStatus, SessionStatus.unauthenticated);
      verify(() => storage.delete(StorageKeys.authToken)).called(1);
      await cubit.close();
    });

    test('Test 7: several 401s in a row -> exactly one clear', () async {
      when(() => storage.read(StorageKeys.authToken)).thenAnswer((_) async => 'jwt');
      when(() => repo.getMe()).thenAnswer((_) async => MeResponse(user: _user()));
      final cubit = build();
      await cubit.checkSession();

      AuthEventBus.instance.emitUnauthorized();
      AuthEventBus.instance.emitUnauthorized();
      AuthEventBus.instance.emitUnauthorized();
      await pumpEventQueue();

      verify(() => storage.delete(StorageKeys.authToken)).called(1);
      await cubit.close();
    });
  });

  group('P5: resume revalidation never signs the user out on a network error', () {
    test('Test 8/9: active + resume + network error -> stays active', () async {
      when(() => storage.read(StorageKeys.authToken)).thenAnswer((_) async => 'jwt');
      when(() => repo.getMe()).thenAnswer((_) async => MeResponse(user: _user()));
      final cubit = build();
      await cubit.checkSession();
      expect(cubit.state.sessionStatus, SessionStatus.active);

      when(() => repo.getMe()).thenThrow(
        ServerFailure('No Internet Connection', code: FailureCode.network),
      );
      await cubit.checkSession(isResume: true);

      expect(cubit.state.sessionStatus, SessionStatus.active);
      verifyNever(() => storage.delete(any()));
      await cubit.close();
    });

    test('resume + 401 -> still clears the session', () async {
      when(() => storage.read(StorageKeys.authToken)).thenAnswer((_) async => 'jwt');
      when(() => repo.getMe()).thenAnswer((_) async => MeResponse(user: _user()));
      final cubit = build();
      await cubit.checkSession();

      when(() => repo.getMe()).thenThrow(ServerFailure('Unauthorized', statusCode: 401));
      await cubit.checkSession(isResume: true);

      expect(cubit.state.sessionStatus, SessionStatus.unauthenticated);
      verify(() => storage.delete(StorageKeys.authToken)).called(1);
      await cubit.close();
    });
  });

  group('logout still fully clears local auth', () {
    test('deletes token and resets state', () async {
      when(() => storage.read(StorageKeys.authToken)).thenAnswer((_) async => 'jwt');
      when(() => repo.getMe()).thenAnswer(
        (_) async => MeResponse(user: _user()),
      );
      final cubit = build();
      await cubit.checkSession();

      await cubit.logout();

      expect(cubit.state.sessionStatus, SessionStatus.unauthenticated);
      expect(cubit.state.user, isNull);
      verify(() => storage.delete(StorageKeys.authToken)).called(1);
      await cubit.close();
    });

    // F-03: the refresh token is a 30-day credential that could mint a new
    // access token, so leaving it behind would make logout cosmetic.
    test('deletes the refresh token as well as the access token', () async {
      final cubit = build();

      await cubit.logout();

      verify(() => storage.delete(StorageKeys.authToken)).called(1);
      verify(() => storage.delete(StorageKeys.refreshToken)).called(1);
      await cubit.close();
    });

    // F-07: the device stayed subscribed to the account it just left, so a
    // shared phone kept showing the previous pharmacist's order and payment
    // notifications on its lock screen.
    test('unregisters the device for push before clearing the session', () async {
      final cubit = build();

      await cubit.logout();

      verify(() => fcm.unregisterDevice()).called(1);
      await cubit.close();
    });

    // F-08: the inbox is one global SharedPreferences key, not scoped per
    // user, so the next person to sign in on this device would read it.
    test('clears the local notification inbox', () async {
      final cubit = build();

      await cubit.logout();

      verify(() => notifications.clear()).called(1);
      await cubit.close();
    });

    test('a failure in any cleanup step never blocks signing out', () async {
      // Logging out has to work offline, and with a secure store that is
      // refusing to co-operate. None of these may leave the user stuck in a
      // session they asked to leave.
      when(() => fcm.unregisterDevice()).thenThrow(Exception('no network'));
      when(() => notifications.clear()).thenThrow(Exception('disk full'));
      when(() => storage.delete(any())).thenThrow(Exception('keystore locked'));
      final cubit = build();

      await cubit.logout();

      expect(cubit.state.sessionStatus, SessionStatus.unauthenticated);
      await cubit.close();
    });

    // A session that expires on a shared device leaks exactly as much as one
    // the user signed out of deliberately.
    test('a forced 401 logout clears the inbox too', () async {
      when(() => storage.read(StorageKeys.authToken)).thenAnswer((_) async => 'jwt');
      when(() => repo.getMe()).thenThrow(ServerFailure('Unauthorized', statusCode: 401));
      final cubit = build();

      await cubit.checkSession();

      verify(() => notifications.clear()).called(1);
      verify(() => storage.delete(StorageKeys.refreshToken)).called(1);
      await cubit.close();
    });
  });
}
