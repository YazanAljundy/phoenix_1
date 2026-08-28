import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:phoenix/features/catalog/presentation/widgets/quantity_picker_sheet.dart';
import 'package:phoenix/generated/app_localizations.dart';

void main() {
  Future<int?> openAndReturn(
    WidgetTester tester, {
    required Future<void> Function(WidgetTester tester) interact,
  }) async {
    int? result;
    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          body: Builder(
            builder: (context) => Center(
              child: ElevatedButton(
                onPressed: () async {
                  result = await showQuantityPickerSheet(context);
                },
                child: const Text('open'),
              ),
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    await interact(tester);
    await tester.pumpAndSettle();
    return result;
  }

  testWidgets('typing 100 then Add returns 100', (tester) async {
    final result = await openAndReturn(
      tester,
      interact: (tester) async {
        await tester.enterText(find.byType(TextField), '100');
        await tester.tap(find.text('Add'));
      },
    );

    expect(result, 100);
  });

  testWidgets('stepping up from the default then Add returns the stepped value', (tester) async {
    final result = await openAndReturn(
      tester,
      interact: (tester) async {
        await tester.tap(find.byIcon(Icons.add));
        await tester.pump();
        await tester.tap(find.byIcon(Icons.add));
        await tester.pump();
        await tester.tap(find.text('Add'));
      },
    );

    expect(result, 3);
  });
}
