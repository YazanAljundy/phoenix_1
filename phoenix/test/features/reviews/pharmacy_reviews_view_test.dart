import 'package:bloc_test/bloc_test.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:phoenix/core/theme/dark_theme.dart';
import 'package:phoenix/core/widgets/custom_card.dart';
import 'package:phoenix/features/reviews/data/models/review_model.dart';
import 'package:phoenix/features/reviews/presentation/managers/pharmacy_reviews_cubit.dart';
import 'package:phoenix/features/reviews/presentation/managers/pharmacy_reviews_state.dart';
import 'package:phoenix/features/reviews/presentation/views/pharmacy_reviews_view.dart';
import 'package:phoenix/generated/app_localizations.dart';

class MockPharmacyReviewsCubit extends MockCubit<PharmacyReviewsState>
    implements PharmacyReviewsCubit {}

ReviewModel _review(String id, {String? comment}) => ReviewModel(
  id: id,
  orderId: 'o-$id',
  orderNumber: 1,
  warehouseNameAr: 'مستودع $id',
  warehouseNameEn: 'Warehouse $id',
  rating: 4,
  comment: comment,
  createdAt: DateTime(2026, 3, 2),
);

void main() {
  late MockPharmacyReviewsCubit cubit;

  setUp(() {
    cubit = MockPharmacyReviewsCubit();
    when(() => cubit.load()).thenAnswer((_) async {});
  });

  Future<void> pump(WidgetTester tester, {ThemeData? theme}) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: theme,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: BlocProvider<PharmacyReviewsCubit>.value(
          value: cubit,
          child: const PharmacyReviewsView(),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('renders every review (not capped at 3 like the old inline block)', (tester) async {
    when(() => cubit.state).thenReturn(
      PharmacyReviewsState(
        status: PharmacyReviewsStatus.loaded,
        averageRating: 4.2,
        reviews: [
          _review('a', comment: 'Great'),
          _review('b', comment: 'Good'),
          _review('c'),
          _review('d'),
          _review('e'),
        ],
      ),
    );
    await pump(tester);

    // summary card + 5 review cards
    expect(find.byType(CustomCard), findsNWidgets(6));
    expect(find.text('Warehouse e'), findsOneWidget);
  });

  testWidgets('shows the empty state when there are no reviews', (tester) async {
    when(() => cubit.state).thenReturn(
      const PharmacyReviewsState(status: PharmacyReviewsStatus.loaded),
    );
    await pump(tester);

    expect(find.text('No warehouse has rated you yet.'), findsOneWidget);
  });

  testWidgets('renders in dark mode without error', (tester) async {
    when(() => cubit.state).thenReturn(
      PharmacyReviewsState(
        status: PharmacyReviewsStatus.loaded,
        averageRating: 5,
        reviews: [_review('a')],
      ),
    );
    await pump(tester, theme: DarkTheme.data);

    expect(tester.takeException(), isNull);
    expect(find.byType(PharmacyReviewsView), findsOneWidget);
  });
}
