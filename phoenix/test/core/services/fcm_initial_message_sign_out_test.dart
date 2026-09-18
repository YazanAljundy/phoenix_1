import 'dart:async';

import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:feniq/core/services/fcm_service.dart';
import 'package:feniq/core/services/navigation_service.dart';
import 'package:feniq/core/services/secure_storage_service.dart';
import 'package:feniq/core/services/storage_service.dart';
import 'package:feniq/core/session/session_scope.dart';
import 'package:feniq/features/auth/data/models/auth_response.dart';
import 'package:feniq/features/auth/data/models/user_model.dart';
import 'package:feniq/features/auth/data/repositories/auth_repository_impl.dart';
import 'package:feniq/features/auth/presentation/managers/auth_cubit.dart';
import 'package:feniq/features/auth/presentation/managers/auth_state.dart';
import 'package:feniq/features/notifications/data/repositories/notification_repository.dart';
import 'package:feniq/features/notifications/presentation/managers/notification_cubit.dart';
import 'package:feniq/routes/route_names.dart';
import 'package:feniq/routes/route_paths.dart';

// The cold-start message (FirebaseMessaging.getInitialMessage) is read
// asynchronously, starting while account A is signed in. These tests hold
// that read open with a Completer, sign A out through the real AuthCubit
// (which empties the real inbox and resets the real FcmService through the
// shared SessionScope), and only then let the read answer.
//
// Only the read itself is a stand-in: FirebaseMessaging needs a real Firebase
// app. The FCM calls AuthCubit makes on the way (unregisterDevice on logout,
// initialize on B's login) fail on the missing app, and both swallow that by
// design.

class _MockAuthRepository extends Mock implements AuthRepositoryImpl {}

class _MockSecureStorage extends Mock implements SecureStorageService {}

UserModel _user(String id) => UserModel(
  id: id,
  name: 'Dr. $id',
  phone: '+96399999999$id',
  role: 'pharmacy',
  status: 'active',
  lang: 'ar',
);

// What FCM hands back for the tap that launched the app: a notification for
// account A, deep-linking to A's order.
RemoteMessage _messageForA({Map<String, dynamic> data = const {'relatedOrderId': 'order-of-a', 'type': 'order_update'}}) =>
    RemoteMessage(
      messageId: 'msg-for-a',
      sentTime: DateTime.utc(2026, 9, 17, 8),
      data: data,
      notification: const RemoteNotification(title: 'Order update', body: 'Order #7 of pharmacy A is on its way'),
    );

void main() {
  late _MockAuthRepository authRepo;
  late _MockSecureStorage secureStorage;
  late StorageService storage;
  late NotificationRepository inbox;
  late SessionScope scope;
  late Completer<RemoteMessage?> read;
  late FcmService fcm;
  late AuthCubit auth;

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    storage = StorageService(await SharedPreferences.getInstance());
    inbox = NotificationRepository(storage);

    authRepo = _MockAuthRepository();
    secureStorage = _MockSecureStorage();
    when(() => secureStorage.delete(any())).thenAnswer((_) async {});
    when(() => secureStorage.write(any(), any())).thenAnswer((_) async {});
    when(() => authRepo.loginWithPassword(phone: any(named: 'phone'), password: any(named: 'password')))
        .thenAnswer((_) async => AuthResponse(token: 'jwt-b', refreshToken: 'refresh-b', user: _user('b')));

    scope = SessionScope();
    fcm = FcmService(
      authRepository: authRepo,
      notificationRepository: inbox,
      sessionScope: scope,
      initialMessageReader: () => read.future,
    );
    auth = AuthCubit(
      authRepository: authRepo,
      secureStorage: secureStorage,
      fcmService: fcm,
      notificationRepository: inbox,
      sessionScope: scope,
    );
  });

  tearDown(() => auth.close());

  // Starts the launch-tap read and holds it open until the test answers
  // `read`. The Completer is made here, inside the test body, on purpose: one
  // made in setUp belongs to the real zone, and completing it from inside
  // testWidgets' fake-async zone leaves the next pump waiting forever.
  Future<void> startInitialRead() {
    read = Completer<RemoteMessage?>();
    return fcm.handleInitialMessage();
  }

  Future<void> pumpApp(WidgetTester tester) async {
    final router = GoRouter(
      navigatorKey: NavigationService.instance.navigatorKey,
      initialLocation: '/',
      routes: [
        GoRoute(path: '/', builder: (context, state) => const Text('SHELL')),
        GoRoute(
          name: RouteNames.orderTracking,
          path: RoutePaths.orderTracking,
          builder: (context, state) => Text('ORDER ${state.pathParameters['orderId']}'),
        ),
        GoRoute(
          name: RouteNames.complaintDetail,
          path: RoutePaths.complaintDetail,
          builder: (context, state) => Text('COMPLAINT ${state.pathParameters['complaintId']}'),
        ),
      ],
    );
    await tester.pumpWidget(MaterialApp.router(routerConfig: router));
    await tester.pumpAndSettle();
  }

  // Account B signs in and its shell comes up - the moment a parked deep link
  // would open.
  Future<void> signInB(WidgetTester tester) async {
    expect(await auth.loginWithPassword(phone: '0999999999', password: 'b-password'), isTrue);
    expect(auth.state.sessionStatus, SessionStatus.active);
    fcm.markAppReady();
    await tester.pumpAndSettle();
  }

  Future<void> expectInboxEmpty() async {
    expect(inbox.current, isEmpty);
    // Not just in memory: nothing on disk either, where the next launch (or
    // the background isolate) would read it from.
    expect(storage.getString(kNotificationsStorageKey), isNull);
    await inbox.refresh();
    expect(inbox.current, isEmpty);
    // And not in what the inbox screen and the badge render.
    final cubit = NotificationCubit(repository: inbox);
    expect(cubit.state.notifications, isEmpty);
    expect(cubit.state.unreadCount, 0);
    await cubit.close();
  }

  testWidgets('a cold-start read that spans a sign-out leaves nothing for the next account', (tester) async {
    await pumpApp(tester);

    // A is signed in; the launch-tap read starts...
    final reading = startInitialRead();
    // ...A signs out while it is still pending...
    await auth.logout();
    expect(auth.state.sessionStatus, SessionStatus.unauthenticated);
    // ...and only now does the read answer, with A's notification.
    read.complete(_messageForA());
    await reading;
    await tester.pumpAndSettle();

    await signInB(tester);

    // Not stored...
    await expectInboxEmpty();
    // ...and not parked: B's shell came up and nothing opened.
    expect(find.text('ORDER order-of-a'), findsNothing);
    expect(find.text('SHELL'), findsOneWidget);
  });

  testWidgets('the same for a message with no deep link (it would only have been stored)', (tester) async {
    await pumpApp(tester);

    final reading = startInitialRead();
    await auth.logout();
    read.complete(_messageForA(data: const {'type': 'announcement'}));
    await reading;
    await tester.pumpAndSettle();

    await signInB(tester);

    await expectInboxEmpty();
  });

  testWidgets('control: with no sign-out, the message is stored and opens when the shell is ready', (tester) async {
    await pumpApp(tester);

    final reading = startInitialRead();
    read.complete(_messageForA());
    await reading;
    await tester.pumpAndSettle();

    expect(inbox.current.single.id, 'msg-for-a');
    expect(storage.getString(kNotificationsStorageKey), contains('msg-for-a'));
    // Parked until the shell is ready, then opened.
    expect(find.text('ORDER order-of-a'), findsNothing);
    fcm.markAppReady();
    await tester.pumpAndSettle();
    expect(find.text('ORDER order-of-a'), findsOneWidget);
  });

  testWidgets('a read that answered before the sign-out is cleared with the inbox as before', (tester) async {
    await pumpApp(tester);

    final reading = startInitialRead();
    read.complete(_messageForA());
    await reading;
    await tester.pumpAndSettle();
    expect(inbox.current, hasLength(1));

    await auth.logout();
    await signInB(tester);

    await expectInboxEmpty();
    expect(find.text('ORDER order-of-a'), findsNothing);
  });

  testWidgets('a launch with no notification behind it is unaffected by a sign-out', (tester) async {
    await pumpApp(tester);

    final reading = startInitialRead();
    await auth.logout();
    read.complete(null);
    await reading;

    await signInB(tester);

    await expectInboxEmpty();
    expect(find.text('SHELL'), findsOneWidget);
  });
}
