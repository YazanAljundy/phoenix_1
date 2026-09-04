import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:phoenix/generated/app_localizations.dart';
import 'package:phoenix/routes/scaffold_with_bottom_nav.dart';

// The Returns tab was renamed to "Account History" (and localized). This
// exercises the real ScaffoldWithBottomNav against a minimal shell router so
// the label change is pinned without pulling in the whole app.
GoRouter _shellRouter() => GoRouter(
  initialLocation: '/warehouses',
  routes: [
    StatefulShellRoute.indexedStack(
      builder: (context, state, navigationShell) =>
          ScaffoldWithBottomNav(navigationShell: navigationShell),
      branches: [
        StatefulShellBranch(
          routes: [GoRoute(path: '/warehouses', builder: (_, __) => const Scaffold(body: Text('W')))],
        ),
        StatefulShellBranch(
          routes: [GoRoute(path: '/my-orders', builder: (_, __) => const Scaffold(body: Text('O')))],
        ),
        StatefulShellBranch(
          routes: [GoRoute(path: '/account-history', builder: (_, __) => const Scaffold(body: Text('A')))],
        ),
        StatefulShellBranch(
          routes: [GoRoute(path: '/profile', builder: (_, __) => const Scaffold(body: Text('P')))],
        ),
      ],
    ),
  ],
);

Future<void> _pump(WidgetTester tester, {Locale? locale}) async {
  await tester.pumpWidget(
    MaterialApp.router(
      routerConfig: _shellRouter(),
      locale: locale,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('Test 1: the third tab reads "Account History", not "Returns"', (tester) async {
    await _pump(tester);

    final bar = find.byType(NavigationBar);
    expect(bar, findsOneWidget);
    expect(find.descendant(of: bar, matching: find.text('Account History')), findsOneWidget);
    expect(find.descendant(of: bar, matching: find.text('Returns')), findsNothing);
  });

  testWidgets('Test 10: the tab label is localized to Arabic', (tester) async {
    await _pump(tester, locale: const Locale('ar'));

    expect(
      find.descendant(of: find.byType(NavigationBar), matching: find.text('سجل الحسابات')),
      findsOneWidget,
    );
    expect(
      find.descendant(of: find.byType(NavigationBar), matching: find.text('المرتجعات')),
      findsNothing,
    );
  });

  testWidgets('tapping the Account History tab activates its branch', (tester) async {
    await _pump(tester);

    await tester.tap(find.text('Account History'));
    await tester.pumpAndSettle();

    expect(find.text('A'), findsOneWidget);
  });
}
