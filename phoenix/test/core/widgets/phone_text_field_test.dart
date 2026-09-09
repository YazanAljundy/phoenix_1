import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:feniq/core/widgets/phone_text_field.dart';

// The field is a fixed, non-editable "09" box followed by the digits the
// pharmacist actually types. Both auth screens share this one widget, so the
// prefix can only ever be in one place.
void main() {
  late TextEditingController controller;

  setUp(() => controller = TextEditingController());
  tearDown(() => controller.dispose());

  Future<void> pumpField(WidgetTester tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: PhoneTextField(label: 'Phone', controller: controller),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('shows a fixed "09" prefix', (tester) async {
    await pumpField(tester);
    expect(find.text('09'), findsOneWidget);
  });

  testWidgets('the prefix is not editable - there is exactly one input', (tester) async {
    await pumpField(tester);

    expect(find.byType(TextFormField), findsOneWidget);
    // The "09" is a Text, not an EditableText, so it cannot be selected,
    // focused or backspaced away.
    expect(
      find.descendant(of: find.text('09'), matching: find.byType(EditableText)),
      findsNothing,
    );
  });

  testWidgets('the prefix sits before the input in the reading direction', (tester) async {
    await pumpField(tester);

    // LTR: the box is to the left of the field it prefixes.
    expect(
      tester.getTopLeft(find.text('09')).dx,
      lessThan(tester.getTopLeft(find.byType(TextFormField)).dx),
    );
  });

  testWidgets('in Arabic the prefix still leads the field (to its right)', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        locale: const Locale('ar'),
        home: Directionality(
          textDirection: TextDirection.rtl,
          child: Scaffold(
            body: PhoneTextField(label: 'الهاتف', controller: controller),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(
      tester.getTopRight(find.text('09')).dx,
      greaterThan(tester.getTopRight(find.byType(TextFormField)).dx),
    );
  });

  testWidgets('the controller holds only what was typed, never the prefix', (tester) async {
    await pumpField(tester);

    await tester.enterText(find.byType(TextFormField), '12345678');

    expect(controller.text, '12345678');
    expect(phoneTextFieldFullValue(controller.text), '+963912345678');
  });

  testWidgets('non-digits are rejected by the field itself', (tester) async {
    await pumpField(tester);

    await tester.enterText(find.byType(TextFormField), '+963 91a2-345678');

    expect(controller.text, '963912345678');
    expect(phoneTextFieldFullValue(controller.text), '+963912345678');
  });
}
