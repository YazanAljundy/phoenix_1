import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:feniq/core/constants/app_colors.dart';
import 'package:feniq/core/theme/dark_theme.dart';
import 'package:feniq/core/theme/light_theme.dart';
import 'package:feniq/core/widgets/custom_card.dart';
import 'package:feniq/features/warehouse_selection/data/models/warehouse_model.dart';
import 'package:feniq/features/warehouse_selection/presentation/widgets/warehouse_card.dart';
import 'package:feniq/generated/app_localizations.dart';

// The redesigned card has a fixed budget: WarehouseSelectionView lays it out
// in a grid tile of at most 210pt wide and exactly 220pt tall. A card that
// overflows that renders a yellow-and-black overflow stripe in front of the
// pharmacist, so the budget is worth pinning - especially against the two
// things that stretch it, a long name and a large text scale.
//
// A RenderFlex overflow throws in a widget test, so simply pumping the card
// inside the real tile size is the assertion; the expects below just prove
// the content actually made it in.
void main() {
  // A touch narrower than the tile the grid produces on a phone (two columns
  // inside a 390pt screen), which is about the tightest the card ever has to
  // be. The card's height doesn't depend on its width, only its text wrapping
  // does.
  const tileSize = Size(171, 220);

  WarehouseModel warehouse({String? name, String? logo}) => WarehouseModel(
    id: 'w1',
    nameAr: name ?? 'مستودع اللاذقية',
    nameEn: name ?? 'Latakia Warehouse',
    city: 'Latakia',
    phone: '0940000001',
    logo: logo,
  );

  Future<void> pumpCard(
    WidgetTester tester, {
    required ThemeData theme,
    required Locale locale,
    WarehouseModel? model,
    double textScale = 1.0,
  }) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: theme,
        locale: locale,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          body: Center(
            child: MediaQuery(
              data: MediaQueryData(textScaler: TextScaler.linear(textScale)),
              child: SizedBox(
                width: tileSize.width,
                height: tileSize.height,
                child: WarehouseCard(
                  warehouse: model ?? warehouse(),
                  onSelect: () {},
                  onViewProfile: () {},
                ),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('fits its grid tile in light mode', (tester) async {
    await pumpCard(tester, theme: LightTheme.data, locale: const Locale('en'));

    expect(find.text('Latakia Warehouse'), findsOneWidget);
    expect(find.text('Latakia'), findsOneWidget);
    expect(find.text('Profile'), findsOneWidget);
  });

  testWidgets('fits its grid tile in dark mode', (tester) async {
    // The card draws every colour through AppColors.*Of(context), so dark mode
    // is a matter of the theme resolving - but the layout has to hold up in it
    // just the same.
    await pumpCard(tester, theme: DarkTheme.data, locale: const Locale('en'));

    expect(find.text('Latakia Warehouse'), findsOneWidget);
    expect(find.byType(CustomCard), findsOneWidget);
    // The label was once drawn in navyOf, which in night mode is the card's
    // own fill colour - present in the tree, invisible on screen.
    expect(
      tester.widget<Text>(find.text('Profile')).style?.color,
      isNot(AppColors.darkSurfaceElevated),
    );
  });

  testWidgets('fits its grid tile in Arabic, right to left', (tester) async {
    await pumpCard(tester, theme: LightTheme.data, locale: const Locale('ar'));

    expect(find.text('مستودع اللاذقية'), findsOneWidget);
    expect(
      Directionality.of(tester.element(find.byType(WarehouseCard))),
      TextDirection.rtl,
    );
  });

  testWidgets('survives a name far longer than the tile', (tester) async {
    await pumpCard(
      tester,
      theme: LightTheme.data,
      locale: const Locale('en'),
      model: warehouse(name: 'A Very Long Warehouse Name That Will Not Fit On Two Lines Either'),
    );

    expect(find.byType(WarehouseCard), findsOneWidget);
    // The city pill must survive the name, not be pushed out by it.
    expect(find.text('Latakia'), findsOneWidget);
    expect(find.text('Profile'), findsOneWidget);
  });

  testWidgets('survives a larger accessibility text scale', (tester) async {
    await pumpCard(
      tester,
      theme: LightTheme.data,
      locale: const Locale('en'),
      textScale: 1.3,
    );

    expect(find.byType(WarehouseCard), findsOneWidget);
    expect(find.text('Profile'), findsOneWidget);
  });

  testWidgets('survives a long name at a larger text scale together', (tester) async {
    // The worst case the tile height is sized for: a name wrapping to two
    // lines, with every line taller.
    await pumpCard(
      tester,
      theme: LightTheme.data,
      locale: const Locale('ar'),
      model: warehouse(name: 'مستودع النور الطبي الكبير للتوزيع والتجارة'),
      textScale: 1.3,
    );

    expect(find.text('Latakia'), findsOneWidget);
    expect(find.byType(OutlinedButton), findsOneWidget);
  });

  testWidgets('a warehouse with no logo still draws its placeholder', (tester) async {
    await pumpCard(tester, theme: LightTheme.data, locale: const Locale('en'));

    // No network image is attempted for a null logo - the card falls back to
    // the shipping glyph, which is what a not-yet-branded warehouse shows.
    expect(find.byIcon(Icons.local_shipping_outlined), findsOneWidget);
  });
}
