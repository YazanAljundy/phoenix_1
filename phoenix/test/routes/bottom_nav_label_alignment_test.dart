import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:feniq/core/theme/dark_theme.dart';
import 'package:feniq/core/theme/light_theme.dart';
import 'package:feniq/generated/app_localizations.dart';
import 'package:feniq/routes/scaffold_with_bottom_nav.dart';

// "سجل الحسابات" used to sit lower than the icons beside it. The cause is in
// NavigationBar itself: it builds each label as a bare `Text` with no
// maxLines, and its layout delegate offsets a destination's icon by half that
// destination's own label height. So the moment one label wrapped to a second
// line, that tab's icon lifted out of line with the other four.
//
// These pin the fix from both ends: every label stays one line, and every icon
// therefore resolves to the same vertical offset.

const _arabicLabels = ['المستودعات', 'العروض', 'طلباتي', 'سجل الحسابات', 'البروفايل'];
const _englishLabels = ['Warehouses', 'Offers', 'My Orders', 'Account History', 'Profile'];

// The real face matters here - this is a measurement test, and the stand-in
// font flutter_test ships is fixed-width, which would make every label wrap.
Future<void> _loadTajawal(WidgetTester tester) async {
  await tester.runAsync(() async {
    final loader = FontLoader('Tajawal');
    for (final file in ['Tajawal-Regular.ttf', 'Tajawal-Medium.ttf', 'Tajawal-Bold.ttf']) {
      final bytes = await File('assets/fonts/$file').readAsBytes();
      loader.addFont(Future.value(ByteData.view(bytes.buffer)));
    }
    await loader.load();
  });
}

GoRouter _shellRouter() => GoRouter(
  initialLocation: '/warehouses',
  routes: [
    StatefulShellRoute.indexedStack(
      builder: (context, state, navigationShell) =>
          ScaffoldWithBottomNav(navigationShell: navigationShell),
      branches: [
        for (final path in const [
          '/warehouses',
          '/offers-and-ads',
          '/my-orders',
          '/account-history',
          '/profile',
        ])
          StatefulShellBranch(
            routes: [GoRoute(path: path, builder: (_, __) => Scaffold(body: Text(path)))],
          ),
      ],
    ),
  ],
);

Future<void> _pump(WidgetTester tester, {required Locale locale, required ThemeData theme}) async {
  await _loadTajawal(tester);
  await tester.pumpWidget(
    MaterialApp.router(
      routerConfig: _shellRouter(),
      theme: theme,
      locale: locale,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
    ),
  );
  await tester.pumpAndSettle();
}

List<double> _iconTops(WidgetTester tester) {
  final icons = find.descendant(
    of: find.byType(NavigationBar),
    matching: find.byType(Icon),
  );
  return [
    for (var i = 0; i < icons.evaluate().length; i++) tester.getRect(icons.at(i)).top,
  ];
}

void main() {
  // 360dp is the tightest of the common Android widths, so it is the one the
  // longest label has to survive - a fifth of it is ~72pt.
  for (final width in const [360.0, 390.0]) {
    for (final (localeCode, labels) in [('ar', _arabicLabels), ('en', _englishLabels)]) {
      testWidgets('every tab label is one line at ${width.toInt()}dp in $localeCode', (tester) async {
        tester.view.physicalSize = Size(width, 800);
        tester.view.devicePixelRatio = 1.0;
        addTearDown(tester.view.reset);

        await _pump(tester, locale: Locale(localeCode), theme: LightTheme.data);

        final singleLineHeight = tester.getSize(find.text(labels[1])).height;
        for (final label in labels) {
          expect(
            tester.getSize(find.text(label)).height,
            singleLineHeight,
            reason: '"$label" wrapped to more than one line at ${width.toInt()}dp',
          );
        }
      });

      testWidgets('every tab icon shares one baseline at ${width.toInt()}dp in $localeCode', (tester) async {
        tester.view.physicalSize = Size(width, 800);
        tester.view.devicePixelRatio = 1.0;
        addTearDown(tester.view.reset);

        await _pump(tester, locale: Locale(localeCode), theme: LightTheme.data);

        final tops = _iconTops(tester);
        expect(tops, hasLength(5));
        expect(tops.toSet(), hasLength(1), reason: 'icon tops drifted apart: $tops');
      });
    }
  }

  testWidgets('the Account History label is not truncated at 360dp in Arabic', (tester) async {
    tester.view.physicalSize = const Size(360, 800);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await _pump(tester, locale: const Locale('ar'), theme: LightTheme.data);

    // didExceedMaxLines is what an ellipsis is drawn from, so this is the
    // difference between "fits" and "fits because it was cut short".
    final paragraph = tester.renderObject<RenderParagraph>(find.text('سجل الحسابات'));
    expect(paragraph.didExceedMaxLines, isFalse);
  });

  testWidgets('the dark theme aligns the same way', (tester) async {
    tester.view.physicalSize = const Size(360, 800);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await _pump(tester, locale: const Locale('ar'), theme: DarkTheme.data);

    expect(_iconTops(tester).toSet(), hasLength(1));
  });
}
