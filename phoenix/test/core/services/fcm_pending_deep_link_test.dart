import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:feniq/core/services/fcm_service.dart';
import 'package:feniq/core/services/navigation_service.dart';
import 'package:feniq/core/session/session_scope.dart';
import 'package:feniq/features/auth/data/repositories/auth_repository.dart';
import 'package:feniq/features/notifications/data/repositories/notification_repository.dart';
import 'package:feniq/routes/route_names.dart';
import 'package:feniq/routes/route_paths.dart';

// A cold-start notification is parked until the app shell is up (audit P7).
// These drive the real FcmService against a real GoRouter wired to the app's
// NavigationService key - the same key FcmService navigates with - with the
// order and complaint screens stubbed by their route names.

class _MockAuthRepository extends Mock implements AuthRepository {}

class _MockNotificationRepository extends Mock implements NotificationRepository {}

void main() {
  late SessionScope scope;
  late FcmService fcm;

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

  setUp(() {
    scope = SessionScope();
    fcm = FcmService(
      authRepository: _MockAuthRepository(),
      notificationRepository: _MockNotificationRepository(),
      sessionScope: scope,
    );
  });

  test('FcmService registers itself with the session scope', () {
    expect(scope.memberCount, 1);
  });

  testWidgets('control: a parked order link opens once the shell is ready', (tester) async {
    await pumpApp(tester);
    fcm.parkInitialMessage(const RemoteMessage(data: {'relatedOrderId': 'order-1'}));
    await tester.pumpAndSettle();
    // Parked, not opened: the shell hasn't said it is ready.
    expect(find.text('ORDER order-1'), findsNothing);

    fcm.markAppReady();
    await tester.pumpAndSettle();

    expect(find.text('ORDER order-1'), findsOneWidget);
  });

  testWidgets('a link parked before a sign-out does not open for the next account', (tester) async {
    await pumpApp(tester);
    fcm.parkInitialMessage(const RemoteMessage(data: {'relatedOrderId': 'order-of-account-a'}));
    await tester.pumpAndSettle();

    // Account A's session ends (AuthCubit -> SessionScope.resetAll), then
    // account B signs in and its shell comes up.
    scope.resetAll();
    fcm.markAppReady();
    await tester.pumpAndSettle();

    expect(find.text('ORDER order-of-account-a'), findsNothing);
    expect(find.text('SHELL'), findsOneWidget);
  });

  testWidgets('the same holds for a complaint link', (tester) async {
    await pumpApp(tester);
    fcm.parkInitialMessage(const RemoteMessage(data: {'relatedComplaintId': 'complaint-of-account-a'}));

    scope.resetAll();
    fcm.markAppReady();
    await tester.pumpAndSettle();

    expect(find.text('COMPLAINT complaint-of-account-a'), findsNothing);
    expect(find.text('SHELL'), findsOneWidget);
  });

  testWidgets('only the parked link is dropped - the deep-link mechanism still works', (tester) async {
    await pumpApp(tester);
    fcm.parkInitialMessage(const RemoteMessage(data: {'relatedOrderId': 'order-of-account-a'}));
    scope.resetAll();

    // A link parked after the reset belongs to the new session and still
    // waits for, then opens on, markAppReady.
    fcm.parkInitialMessage(const RemoteMessage(data: {'relatedOrderId': 'order-of-account-b'}));
    await tester.pumpAndSettle();
    expect(find.text('ORDER order-of-account-b'), findsNothing);

    fcm.markAppReady();
    await tester.pumpAndSettle();

    expect(find.text('ORDER order-of-account-b'), findsOneWidget);
    expect(find.text('ORDER order-of-account-a'), findsNothing);
  });

  testWidgets('a sign-out with nothing parked is harmless', (tester) async {
    await pumpApp(tester);

    expect(scope.resetAll, returnsNormally);
    fcm.markAppReady();
    await tester.pumpAndSettle();

    expect(find.text('SHELL'), findsOneWidget);
  });
}
