import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:phoenix/core/theme/dark_theme.dart';
import 'package:phoenix/core/theme/light_theme.dart';
import 'package:phoenix/core/widgets/failure_widget.dart';
import 'package:phoenix/generated/app_localizations.dart';

Widget _host({
  required Widget child,
  ThemeData? theme,
  Locale locale = const Locale('en'),
}) {
  return MaterialApp(
    locale: locale,
    theme: theme ?? LightTheme.data,
    localizationsDelegates: AppLocalizations.localizationsDelegates,
    supportedLocales: AppLocalizations.supportedLocales,
    home: Scaffold(body: child),
  );
}

void main() {
  group('FailureWidget', () {
    testWidgets('1. shows the message it is given', (tester) async {
      await tester.pumpWidget(
        _host(child: const FailureWidget(message: 'تعذر تحميل البيانات، حاول مرة أخرى.')),
      );
      expect(find.text('تعذر تحميل البيانات، حاول مرة أخرى.'), findsOneWidget);
    });

    testWidgets('2. renders in dark mode', (tester) async {
      await tester.pumpWidget(
        _host(theme: DarkTheme.data, child: const FailureWidget(message: 'Dark mode error')),
      );
      expect(tester.takeException(), isNull);
      expect(find.text('Dark mode error'), findsOneWidget);
    });

    testWidgets('3. renders in light mode', (tester) async {
      await tester.pumpWidget(
        _host(theme: LightTheme.data, child: const FailureWidget(message: 'Light mode error')),
      );
      expect(tester.takeException(), isNull);
      expect(find.text('Light mode error'), findsOneWidget);
    });

    testWidgets('4. lays out under an Arabic (RTL) locale', (tester) async {
      await tester.pumpWidget(
        _host(
          locale: const Locale('ar'),
          child: const FailureWidget(message: 'خطأ', onRetry: null),
        ),
      );
      expect(Directionality.of(tester.element(find.text('خطأ'))), TextDirection.rtl);
      // the retry label is localized to Arabic
      await tester.pumpWidget(
        _host(
          locale: const Locale('ar'),
          child: FailureWidget(message: 'خطأ', onRetry: () {}),
        ),
      );
      expect(find.text('إعادة المحاولة'), findsOneWidget);
    });

    testWidgets('5. lays out under an English (LTR) locale', (tester) async {
      await tester.pumpWidget(
        _host(child: FailureWidget(message: 'error', onRetry: () {})),
      );
      expect(Directionality.of(tester.element(find.text('error'))), TextDirection.ltr);
      expect(find.text('Retry'), findsOneWidget);
    });

    testWidgets('6. calls onRetry when the button is tapped', (tester) async {
      var retries = 0;
      await tester.pumpWidget(
        _host(child: FailureWidget(message: 'error', onRetry: () => retries++)),
      );
      await tester.tap(find.text('Retry'));
      expect(retries, 1);
    });

    testWidgets('7. shows no retry button when onRetry is null', (tester) async {
      await tester.pumpWidget(_host(child: const FailureWidget(message: 'error')));
      expect(find.text('Retry'), findsNothing);
      expect(find.byType(OutlinedButton), findsNothing);
    });

    testWidgets('8. a very long message renders without overflow', (tester) async {
      final long = List.filled(60, 'تعذر تحميل البيانات').join(' ');
      await tester.pumpWidget(_host(child: FailureWidget(message: long, onRetry: () {})));
      expect(tester.takeException(), isNull);
      expect(find.textContaining('تعذر تحميل البيانات'), findsOneWidget);
    });

    testWidgets('dense variant also renders message + retry', (tester) async {
      var retried = false;
      await tester.pumpWidget(
        _host(child: FailureWidget(message: 'section failed', dense: true, onRetry: () => retried = true)),
      );
      expect(find.text('section failed'), findsOneWidget);
      await tester.tap(find.text('Retry'));
      expect(retried, isTrue);
    });
  });
}
