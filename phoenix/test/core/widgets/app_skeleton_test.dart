import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:feniq/core/constants/app_colors.dart';
import 'package:feniq/core/theme/dark_theme.dart';
import 'package:feniq/core/widgets/app_skeleton.dart';

void main() {
  Future<void> pumpSkeleton(
    WidgetTester tester,
    Widget child, {
    ThemeData? theme,
  }) async {
    await tester.pumpWidget(
      MaterialApp(theme: theme, home: Scaffold(body: child)),
    );
    // Never pumpAndSettle: a skeleton pulses forever by design.
    await tester.pump();
  }

  Color barColor(WidgetTester tester, {int index = 0}) {
    final container = tester.widgetList<Container>(
      find.descendant(
        of: find.byType(SkeletonBar).at(index),
        matching: find.byType(Container),
      ),
    ).first;
    return (container.decoration! as BoxDecoration).color!;
  }

  group('SkeletonCardList', () {
    testWidgets('renders the requested number of card placeholders', (
      tester,
    ) async {
      await pumpSkeleton(tester, const SkeletonCardList(itemCount: 5));

      expect(find.byType(SkeletonListCard), findsNWidgets(5));
      expect(find.byType(SkeletonCard), findsNWidgets(5));
    });

    testWidgets('defaults to four cards', (tester) async {
      await pumpSkeleton(tester, const SkeletonCardList());

      expect(find.byType(SkeletonListCard), findsNWidgets(4));
    });

    testWidgets('a card carries a title, a status pill, its body lines and a '
        'value', (tester) async {
      await pumpSkeleton(tester, const SkeletonCardList(itemCount: 1, lines: 3));

      // Title + pill + 3 body lines + value.
      expect(find.byType(SkeletonBar), findsNWidgets(6));
    });

    testWidgets('the whole list breathes from one controller', (tester) async {
      await pumpSkeleton(tester, const SkeletonCardList(itemCount: 4));

      // One pulse for the list, not one per card.
      expect(find.byType(SkeletonPulse), findsOneWidget);
      expect(find.byType(FadeTransition), findsOneWidget);
    });

    testWidgets('never scrolls under a finger that arrives before the data', (
      tester,
    ) async {
      await pumpSkeleton(tester, const SkeletonCardList());

      final listView = tester.widget<ListView>(find.byType(ListView));
      expect(listView.physics, isA<NeverScrollableScrollPhysics>());
    });
  });

  group('SkeletonPulse', () {
    testWidgets('drives a repeating animation', (tester) async {
      await pumpSkeleton(
        tester,
        const SkeletonPulse(child: SizedBox(width: 100, height: 100)),
      );

      double opacity() => tester
          .widget<FadeTransition>(find.byType(FadeTransition))
          .opacity
          .value;

      final first = opacity();
      await tester.pump(const Duration(milliseconds: 450));
      expect(opacity(), greaterThan(first));

      // Back to the start of the cycle, and still scheduling frames.
      await tester.pump(const Duration(milliseconds: 1350));
      expect(opacity(), closeTo(first, 0.001));
      expect(tester.binding.hasScheduledFrame, isTrue);
    });

    testWidgets('fades between half and full opacity, never to nothing', (
      tester,
    ) async {
      await pumpSkeleton(
        tester,
        const SkeletonPulse(child: SizedBox(width: 100, height: 100)),
      );

      expect(
        tester.widget<FadeTransition>(find.byType(FadeTransition)).opacity.value,
        closeTo(0.5, 0.001),
      );

      await tester.pump(const Duration(milliseconds: 900));
      expect(
        tester.widget<FadeTransition>(find.byType(FadeTransition)).opacity.value,
        closeTo(1.0, 0.001),
      );
    });
  });

  group('SkeletonBar', () {
    testWidgets('honours an explicit width and fills the row without one', (
      tester,
    ) async {
      await pumpSkeleton(
        tester,
        const SizedBox(
          width: 300,
          child: SkeletonCard(
            padding: EdgeInsets.zero,
            children: [SkeletonBar(width: 90), SkeletonBar()],
          ),
        ),
      );

      expect(tester.getSize(find.byType(SkeletonBar).at(0)).width, 90);
      // 300 less the card's 1px border on each side.
      expect(tester.getSize(find.byType(SkeletonBar).at(1)).width, 298);
    });

    testWidgets('takes its fill from the theme in light mode', (tester) async {
      await pumpSkeleton(tester, const SkeletonCardList(itemCount: 1));

      expect(barColor(tester), AppColors.lightBorder);
    });

    testWidgets('takes its fill from the theme in dark mode', (tester) async {
      await pumpSkeleton(
        tester,
        const SkeletonCardList(itemCount: 1),
        theme: DarkTheme.data,
      );

      expect(barColor(tester), AppColors.darkBorder);
    });
  });

  group('SkeletonCard', () {
    BoxDecoration cardDecoration(WidgetTester tester) =>
        tester
                .widgetList<Container>(
                  find.descendant(
                    of: find.byType(SkeletonCard),
                    matching: find.byType(Container),
                  ),
                )
                .first
                .decoration!
            as BoxDecoration;

    testWidgets('uses the elevated card surface in light mode', (tester) async {
      await pumpSkeleton(tester, const SkeletonCardList(itemCount: 1));

      expect(cardDecoration(tester).color, AppColors.lightSurfaceElevated);
      expect(
        (cardDecoration(tester).border! as Border).top.color,
        AppColors.lightBorder,
      );
    });

    testWidgets('uses the elevated card surface in dark mode', (tester) async {
      await pumpSkeleton(
        tester,
        const SkeletonCardList(itemCount: 1),
        theme: DarkTheme.data,
      );

      expect(cardDecoration(tester).color, AppColors.darkSurfaceElevated);
      expect(
        (cardDecoration(tester).border! as Border).top.color,
        AppColors.darkBorder,
      );
    });
  });

  group('SkeletonGrid', () {
    testWidgets('renders the requested number of cells', (tester) async {
      await pumpSkeleton(
        tester,
        SkeletonGrid(
          itemCount: 4,
          maxCrossAxisExtent: 210,
          mainAxisExtent: 260,
          itemBuilder: (context, index) =>
              const SkeletonCard(children: [SkeletonBar()]),
        ),
      );

      expect(find.byType(SkeletonCard), findsNWidgets(4));
      expect(find.byType(SkeletonPulse), findsOneWidget);
    });
  });

  group('SkeletonPage', () {
    testWidgets('renders its blocks in order under one pulse', (tester) async {
      await pumpSkeleton(
        tester,
        const SkeletonPage(
          children: [
            SkeletonBar(height: 120),
            SkeletonListCard(),
            SkeletonListCard(),
          ],
        ),
      );

      expect(find.byType(SkeletonListCard), findsNWidgets(2));
      expect(find.byType(SkeletonPulse), findsOneWidget);
    });
  });
}
