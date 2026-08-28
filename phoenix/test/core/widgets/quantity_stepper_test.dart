import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:phoenix/core/widgets/quantity_stepper.dart';

// A realistic host: the parent owns the quantity and feeds it back into the
// widget on every change, exactly like CartView / CatalogView do via
// CartCubit. `reported` records every value the stepper emitted.
class _Host extends StatefulWidget {
  const _Host({
    required this.initial,
    required this.reported,
    this.onBelowMin,
    this.minQuantity = 1,
    this.liveUpdate = false,
    this.compact = false,
    this.direction = TextDirection.ltr,
  });

  final int initial;
  final List<int> reported;
  final VoidCallback? onBelowMin;
  final int minQuantity;
  final bool liveUpdate;
  final bool compact;
  final TextDirection direction;

  @override
  State<_Host> createState() => _HostState();
}

class _HostState extends State<_Host> {
  late int _quantity = widget.initial;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      home: Directionality(
        textDirection: widget.direction,
        child: Scaffold(
          body: Center(
            child: QuantityStepper(
              quantity: _quantity,
              minQuantity: widget.minQuantity,
              liveUpdate: widget.liveUpdate,
              compact: widget.compact,
              onBelowMin: widget.onBelowMin,
              onChanged: (value) {
                widget.reported.add(value);
                setState(() => _quantity = value);
              },
            ),
          ),
        ),
      ),
    );
  }
}

void main() {
  group('QuantityStepper', () {
    testWidgets('renders exactly the quantity it is given', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(home: Scaffold(body: QuantityStepper(quantity: 7, onChanged: _noop))),
      );
      expect(find.text('7'), findsOneWidget);
    });

    testWidgets('consecutive + then - walk the value up and back down', (tester) async {
      final reported = <int>[];
      await tester.pumpWidget(_Host(initial: 2, reported: reported));

      await tester.tap(find.byIcon(Icons.add));
      await tester.pump();
      await tester.tap(find.byIcon(Icons.remove));
      await tester.pump();

      expect(reported, [3, 2]);
      expect(find.text('2'), findsOneWidget);
    });

    testWidgets('typing a quantity reports it on submit - the 100-in-one-keystroke case', (tester) async {
      final reported = <int>[];
      await tester.pumpWidget(_Host(initial: 1, reported: reported));

      await tester.enterText(find.byType(TextField), '100');
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.pump();

      expect(reported, [100]);
      expect(find.text('100'), findsOneWidget);
    });

    testWidgets('non-digits are stripped by the field', (tester) async {
      final reported = <int>[];
      await tester.pumpWidget(_Host(initial: 5, reported: reported));

      await tester.enterText(find.byType(TextField), 'a1b2c');
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.pump();

      expect(reported, [12]);
    });

    testWidgets('with no onBelowMin, going below the minimum snaps back to it', (tester) async {
      final reported = <int>[];
      await tester.pumpWidget(_Host(initial: 1, minQuantity: 1, reported: reported));

      final decrementButton = tester.widget<IconButton>(
        find.ancestor(of: find.byIcon(Icons.remove), matching: find.byType(IconButton)),
      );
      expect(decrementButton.onPressed, isNull, reason: '- disabled at the floor');

      await tester.enterText(find.byType(TextField), '0');
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.pump();

      expect(reported, isEmpty);
      expect(find.text('1'), findsOneWidget);
    });

    testWidgets('onBelowMin fires instead of ever reporting a sub-minimum value', (tester) async {
      final reported = <int>[];
      var belowMin = 0;
      await tester.pumpWidget(
        _Host(initial: 1, reported: reported, onBelowMin: () => belowMin++),
      );

      await tester.tap(find.byIcon(Icons.remove));
      await tester.pump();
      expect(belowMin, 1);

      await tester.enterText(find.byType(TextField), '0');
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.pump();
      expect(belowMin, 2);

      expect(reported, isEmpty);
    });

    testWidgets('liveUpdate reports every valid keystroke', (tester) async {
      final reported = <int>[];
      await tester.pumpWidget(_Host(initial: 1, reported: reported, liveUpdate: true));

      await tester.enterText(find.byType(TextField), '4');
      await tester.pump();
      await tester.enterText(find.byType(TextField), '42');
      await tester.pump();

      expect(reported, [4, 42]);
    });

    testWidgets('the +/- tap targets stay comfortably tappable', (tester) async {
      await tester.pumpWidget(_Host(initial: 1, reported: <int>[], compact: true));

      final size = tester.getSize(
        find.ancestor(of: find.byIcon(Icons.add), matching: find.byType(IconButton)),
      );
      expect(size.width, greaterThanOrEqualTo(44));
      expect(size.height, greaterThanOrEqualTo(44));
    });

    testWidgets('mirrors under RTL without breaking', (tester) async {
      await tester.pumpWidget(
        _Host(initial: 5, reported: <int>[], direction: TextDirection.rtl),
      );

      final addX = tester.getCenter(find.byIcon(Icons.add)).dx;
      final removeX = tester.getCenter(find.byIcon(Icons.remove)).dx;
      expect(addX, lessThan(removeX));
      expect(find.text('5'), findsOneWidget);
    });
  });
}

void _noop(int _) {}
