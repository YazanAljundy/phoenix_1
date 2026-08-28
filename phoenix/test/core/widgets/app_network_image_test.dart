import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:phoenix/core/widgets/app_network_image.dart';

Widget _host(Widget child) =>
    MaterialApp(home: Scaffold(body: Center(child: child)));

void main() {
  group('AppNetworkImage', () {
    testWidgets('null url shows the placeholder, never attempts a request', (
      tester,
    ) async {
      await tester.pumpWidget(
        _host(const AppNetworkImage(url: null, width: 40, height: 40)),
      );

      expect(find.byType(Image), findsNothing);
      expect(find.byType(CachedNetworkImage), findsNothing);
      expect(find.byIcon(Icons.image_not_supported_outlined), findsOneWidget);
    });

    testWidgets('empty / whitespace url shows the placeholder', (tester) async {
      await tester.pumpWidget(
        _host(const AppNetworkImage(url: '   ', width: 40, height: 40)),
      );
      expect(find.byType(CachedNetworkImage), findsNothing);
      expect(find.byIcon(Icons.image_not_supported_outlined), findsOneWidget);
    });

    testWidgets('a custom fallback widget is used when the url is empty', (
      tester,
    ) async {
      await tester.pumpWidget(
        _host(const AppNetworkImage(url: null, fallback: Text('no image'))),
      );
      expect(find.text('no image'), findsOneWidget);
    });

    testWidgets('a non-empty url builds a CachedNetworkImage (cached path)', (
      tester,
    ) async {
      await tester.pumpWidget(
        _host(
          const AppNetworkImage(
            url: 'https://res.cloudinary.com/demo/image/upload/v1/banners/a.jpg',
            width: 100,
            height: 100,
          ),
        ),
      );

      expect(find.byType(CachedNetworkImage), findsOneWidget);
      // No exception during build/layout (network itself never runs in tests).
      expect(tester.takeException(), isNull);
    });

    testWidgets(
      '9. error + placeholder builders both resolve to the calm placeholder, '
      'never Flutter\'s broken-image glyph',
      (tester) async {
        await tester.pumpWidget(
          _host(
            const AppNetworkImage(
              url: 'https://example.com/does-not-exist.png',
              width: 40,
              height: 40,
            ),
          ),
        );

        final widget = tester.widget<CachedNetworkImage>(
          find.byType(CachedNetworkImage),
        );

        // The contract this file has guarded since the banner-404 incident:
        // a failed load shows AppNetworkImage's own placeholder (which carries
        // the fallback icon), and the loading state is a plain calm block.
        final errorWidget = widget.errorWidget!(
          tester.element(find.byType(CachedNetworkImage)),
          'https://example.com/does-not-exist.png',
          Exception('boom'),
        );
        final loadingWidget = widget.placeholder!(
          tester.element(find.byType(CachedNetworkImage)),
          'https://example.com/does-not-exist.png',
        );

        await tester.pumpWidget(_host(errorWidget));
        expect(find.byIcon(Icons.image_not_supported_outlined), findsOneWidget);
        expect(tester.takeException(), isNull);

        await tester.pumpWidget(_host(loadingWidget));
        expect(find.byIcon(Icons.image_not_supported_outlined), findsNothing);
        expect(tester.takeException(), isNull);
      },
    );
  });
}
