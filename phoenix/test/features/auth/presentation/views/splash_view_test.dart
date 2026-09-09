import 'package:bloc_test/bloc_test.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:feniq/features/auth/presentation/managers/auth_cubit.dart';
import 'package:feniq/features/auth/presentation/managers/auth_state.dart';
import 'package:feniq/features/auth/presentation/views/splash_view.dart';
import 'package:feniq/generated/app_localizations.dart';
import 'package:feniq/routes/route_names.dart';
import 'package:feniq/routes/route_paths.dart';

class MockAuthCubit extends MockCubit<AuthState> implements AuthCubit {}

void main() {
  late MockAuthCubit authCubit;

  setUp(() {
    authCubit = MockAuthCubit();
    when(() => authCubit.state).thenReturn(const AuthState());
    when(() => authCubit.checkSession()).thenAnswer((_) async {});
  });

  Future<void> pumpSplash(WidgetTester tester) async {
    final router = GoRouter(
      initialLocation: RoutePaths.splash,
      routes: [
        GoRoute(
          path: RoutePaths.splash,
          name: RouteNames.splash,
          builder: (context, state) => BlocProvider<AuthCubit>.value(
            value: authCubit,
            child: const SplashView(),
          ),
        ),
        GoRoute(
          path: RoutePaths.login,
          name: RouteNames.login,
          builder: (_, __) => const Scaffold(body: Text('LOGIN PAGE')),
        ),
        GoRoute(
          path: RoutePaths.warehouseSelection,
          name: RouteNames.warehouseSelection,
          builder: (_, __) => const Scaffold(body: Text('WAREHOUSES PAGE')),
        ),
        GoRoute(
          path: RoutePaths.approvalPending,
          name: RouteNames.approvalPending,
          builder: (_, __) => const Scaffold(body: Text('APPROVAL PAGE')),
        ),
      ],
    );

    await tester.pumpWidget(
      MaterialApp.router(
        routerConfig: router,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
      ),
    );
    // Never pumpAndSettle here: the logo breathes on a repeating controller,
    // so the splash screen never reaches a settled frame by design.
    await tester.pump();
  }

  testWidgets('shows only the logo - no connectivity error UI', (tester) async {
    await pumpSplash(tester);

    expect(find.byType(Image), findsOneWidget);
    // The old offline gate: a wifi-off glyph over a "no connection" message
    // with a Retry button. None of it should exist any more.
    expect(find.byIcon(Icons.wifi_off_rounded), findsNothing);
    expect(find.byType(ElevatedButton), findsNothing);
    expect(find.text('Retry'), findsNothing);
  });

  testWidgets('an unreachable server on launch does not strand the user - it '
      'carries on into the app', (tester) async {
    whenListen(
      authCubit,
      Stream.value(const AuthState(sessionStatus: SessionStatus.offline)),
      initialState: const AuthState(),
    );

    await pumpSplash(tester);
    await tester.pump();

    expect(find.text('WAREHOUSES PAGE'), findsOneWidget);
    expect(find.byIcon(Icons.wifi_off_rounded), findsNothing);
  });

  double scaleValue(WidgetTester tester) => tester
      .widget<ScaleTransition>(find.byKey(splashLogoScaleKey))
      .scale
      .value;

  double opacityValue(WidgetTester tester) => tester
      .widget<FadeTransition>(find.byKey(splashLogoFadeKey))
      .opacity
      .value;

  testWidgets('the logo runs a repeating animation', (tester) async {
    await pumpSplash(tester);

    final firstScale = scaleValue(tester);
    final firstOpacity = opacityValue(tester);

    // Part-way into the 900ms half-cycle, the logo has grown a little and
    // dimmed a little.
    await tester.pump(const Duration(milliseconds: 450));

    expect(scaleValue(tester), greaterThan(firstScale));
    expect(opacityValue(tester), lessThan(firstOpacity));

    // Two full half-cycles later it is back where it started and still
    // driving frames - it repeats rather than running once and stopping.
    await tester.pump(const Duration(milliseconds: 1350));
    expect(scaleValue(tester), closeTo(firstScale, 0.001));
    expect(opacityValue(tester), closeTo(firstOpacity, 0.001));
    expect(tester.binding.hasScheduledFrame, isTrue);
  });

  testWidgets('the pulse stays subtle', (tester) async {
    await pumpSplash(tester);

    // At the far end of its travel: a 4% grow and a 15% fade, nothing louder.
    await tester.pump(const Duration(milliseconds: 900));

    expect(scaleValue(tester), closeTo(1.04, 0.001));
    expect(opacityValue(tester), closeTo(0.85, 0.001));
  });
}
