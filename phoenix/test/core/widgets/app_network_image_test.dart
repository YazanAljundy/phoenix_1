import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:phoenix/core/widgets/app_network_image.dart';

Widget _host(Widget child) => MaterialApp(home: Scaffold(body: Center(child: child)));

void main() {
  group('AppNetworkImage', () {
    testWidgets('null url shows the placeholder, never attempts a request', (tester) async {
      await tester.pumpWidget(_host(const AppNetworkImage(url: null, width: 40, height: 40)));

      expect(find.byType(Image), findsNothing);
      expect(find.byIcon(Icons.image_not_supported_outlined), findsOneWidget);
    });

    testWidgets('empty / whitespace url shows the placeholder', (tester) async {
      await tester.pumpWidget(_host(const AppNetworkImage(url: '   ', width: 40, height: 40)));
      expect(find.byIcon(Icons.image_not_supported_outlined), findsOneWidget);
    });

    testWidgets('9. a failing image URL falls back to the placeholder, no exception', (tester) async {
      // flutter_test blocks real network image loads, so this URL fails just
      // like a 404 would in production.
      await tester.pumpWidget(
        _host(const AppNetworkImage(url: 'https://example.com/does-not-exist.png', width: 40, height: 40)),
      );
      await tester.pump();
      await tester.pump(const Duration(seconds: 1));

      expect(tester.takeException(), isNull);
      expect(find.byIcon(Icons.image_not_supported_outlined), findsOneWidget);
    });

    testWidgets('a custom fallback widget is used when provided', (tester) async {
      await tester.pumpWidget(
        _host(const AppNetworkImage(url: null, fallback: Text('no image'))),
      );
      expect(find.text('no image'), findsOneWidget);
    });
  });
}
