import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:phoenix/features/catalog/data/models/manufacturer_model.dart';
import 'package:phoenix/features/catalog/presentation/widgets/manufacturer_card.dart';
import 'package:phoenix/generated/app_localizations.dart';

void main() {
  Future<void> pumpCard(
    WidgetTester tester,
    ManufacturerModel manufacturer, {
    Locale locale = const Locale('en'),
    Brightness brightness = Brightness.light,
    VoidCallback? onSelect,
  }) {
    return tester.pumpWidget(
      MaterialApp(
        locale: locale,
        theme: ThemeData(brightness: brightness),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          body: Center(
            child: SizedBox(
              width: 160,
              height: 200,
              child: ManufacturerCard(
                manufacturer: manufacturer,
                onSelect: onSelect ?? () {},
              ),
            ),
          ),
        ),
      ),
    );
  }

  testWidgets('shows the company discount from the model inside the card', (tester) async {
    await pumpCard(
      tester,
      const ManufacturerModel(name: 'شركة ABC', discountPercentage: 15),
    );

    expect(find.text('شركة ABC'), findsOneWidget);
    expect(find.text('Company Discount: 15%'), findsOneWidget);
  });

  testWidgets('a zero discount is shown as 0%, the card is not hidden', (tester) async {
    await pumpCard(
      tester,
      const ManufacturerModel(name: 'شركة XYZ', discountPercentage: 0),
    );

    expect(find.text('شركة XYZ'), findsOneWidget);
    expect(find.text('Company Discount: 0%'), findsOneWidget);
  });

  testWidgets('renders the Arabic label and value in the ar locale', (tester) async {
    await pumpCard(
      tester,
      const ManufacturerModel(name: 'شركة ABC', discountPercentage: 15),
      locale: const Locale('ar'),
    );

    expect(find.text('خصم الشركة: 15٪'), findsOneWidget);
    expect(Directionality.of(tester.element(find.text('خصم الشركة: 15٪'))), TextDirection.rtl);
  });

  testWidgets('renders the discount in dark mode (Arabic RTL) without error', (tester) async {
    await pumpCard(
      tester,
      const ManufacturerModel(name: 'شركة ABC', discountPercentage: 15),
      locale: const Locale('ar'),
      brightness: Brightness.dark,
    );

    expect(tester.takeException(), isNull);
    expect(find.text('خصم الشركة: 15٪'), findsOneWidget);
  });

  testWidgets('a fractional discount is shown exactly, never rounded', (tester) async {
    await pumpCard(
      tester,
      const ManufacturerModel(name: 'شركة ABC', discountPercentage: 25.5),
    );

    expect(find.text('Company Discount: 25.5%'), findsOneWidget);
  });

  testWidgets('a whole-number discount stored as a double drops the .0', (tester) async {
    await pumpCard(
      tester,
      const ManufacturerModel(name: 'شركة ABC', discountPercentage: 20.0),
    );

    expect(find.text('Company Discount: 20%'), findsOneWidget);
  });

  testWidgets('tapping the card fires onSelect', (tester) async {
    var tapped = false;
    await pumpCard(
      tester,
      const ManufacturerModel(name: 'شركة ABC', discountPercentage: 5),
      onSelect: () => tapped = true,
    );

    await tester.tap(find.byType(ManufacturerCard));
    expect(tapped, isTrue);
  });
}
