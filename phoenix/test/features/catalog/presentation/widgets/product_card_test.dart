import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:feniq/core/utils/currency_formatter.dart';
import 'package:feniq/core/widgets/quantity_stepper.dart';
import 'package:feniq/features/catalog/data/models/product_model.dart';
import 'package:feniq/features/catalog/presentation/widgets/product_card.dart';
import 'package:feniq/features/exchange_rate/data/models/exchange_rate_model.dart';
import 'package:feniq/features/exchange_rate/data/repositories/exchange_rate_repository.dart';
import 'package:feniq/features/exchange_rate/presentation/managers/exchange_rate_cubit.dart';
import 'package:feniq/generated/app_localizations.dart';

class _MockExchangeRateRepository extends Mock implements ExchangeRateRepository {}

const _product = ProductModel(
  id: 'p1',
  nameAr: 'دواء',
  nameEn: 'Med',
  manufacturerAr: 'شركة',
  manufacturerEn: 'Co',
  priceUsd: 5,
  discountPriceUsd: 5,
  isAvailable: true,
  hasActiveOffer: false,
);

void main() {
  late ExchangeRateCubit rateCubit;
  late _MockExchangeRateRepository rateRepository;

  setUp(() {
    rateRepository = _MockExchangeRateRepository();
    rateCubit = ExchangeRateCubit(exchangeRateRepository: rateRepository);
  });
  tearDown(() => rateCubit.close());

  Future<void> loadRate(double usdToSyp) async {
    when(() => rateRepository.getExchangeRate())
        .thenAnswer((_) async => ExchangeRateModel(usdToSyp: usdToSyp));
    await rateCubit.load();
  }

  Future<void> pumpCard(
    WidgetTester tester, {
    int cartQuantity = 0,
    bool isGrid = true,
    Locale? locale,
    ValueChanged<int>? onAdd,
    ValueChanged<int>? onCartQuantityChanged,
    VoidCallback? onCartRemove,
  }) {
    return tester.pumpWidget(
      MaterialApp(
        locale: locale,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: BlocProvider<ExchangeRateCubit>.value(
          value: rateCubit,
          child: Scaffold(
            body: Center(
              // A grid cell at the catalog's real metrics, or a list row as wide
              // as a 360pt phone leaves it (minus the screen's side padding).
              child: SizedBox(
                width: isGrid ? 160 : 328,
                height: isGrid ? 316 : null,
                child: ProductCard(
                  product: _product,
                  isGrid: isGrid,
                  cartQuantity: cartQuantity,
                  onAdd: onAdd ?? (_) {},
                  onCartQuantityChanged: onCartQuantityChanged,
                  onCartRemove: onCartRemove,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  testWidgets('not in the cart -> shows the Add button, no stepper', (tester) async {
    await pumpCard(tester, cartQuantity: 0);

    expect(find.text('Add'), findsOneWidget);
    expect(find.byType(QuantityStepper), findsNothing);
  });

  testWidgets('price is shown in SYP only, with no USD figure anywhere', (tester) async {
    await loadRate(5000); // 1 USD = 5000 SYP -> $5 product => 25,000 ل.س
    await pumpCard(tester, cartQuantity: 0);

    expect(find.text('25,000 SYP'), findsOneWidget);
    expect(find.textContaining('\$'), findsNothing);
  });

  testWidgets('shows a placeholder, not a USD figure, when no exchange rate has loaded', (tester) async {
    await pumpCard(tester, cartQuantity: 0);

    expect(find.text(kMoneyUnavailable), findsOneWidget);
    expect(find.textContaining('\$'), findsNothing);
  });

  testWidgets('in the cart -> shows a stepper reflecting the cart quantity', (tester) async {
    await pumpCard(tester, cartQuantity: 4);

    expect(find.byType(QuantityStepper), findsOneWidget);
    expect(find.text('4'), findsOneWidget);
    expect(find.text('Add'), findsNothing);
  });

  testWidgets('stepper + and typing both report through onCartQuantityChanged', (tester) async {
    final reported = <int>[];
    await pumpCard(tester, cartQuantity: 2, onCartQuantityChanged: reported.add);

    await tester.tap(find.byIcon(Icons.add));
    await tester.pump();

    await tester.enterText(find.byType(TextField), '30');
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pump();

    expect(reported, [3, 30]);
  });

  // The list row - the catalog's default layout - used to offer a bare "+"
  // here. It is the same button now, labelled.
  group('list row add button', () {
    testWidgets('reads "Add to cart" instead of a bare +', (tester) async {
      await pumpCard(tester, isGrid: false);

      expect(find.text('Add to cart'), findsOneWidget);
      expect(find.byIcon(Icons.add), findsNothing);
      expect(find.byType(QuantityStepper), findsNothing);
    });

    testWidgets('runs the same quantity sheet -> onAdd flow the + did', (tester) async {
      final added = <int>[];
      await pumpCard(tester, isGrid: false, onAdd: added.add);

      await tester.tap(find.text('Add to cart'));
      await tester.pumpAndSettle();

      // The existing pre-add quantity sheet: step to 2, then confirm.
      await tester.tap(find.byIcon(Icons.add));
      await tester.pump();
      await tester.tap(find.text('Add'));
      await tester.pumpAndSettle();

      expect(added, [2]);
    });

    testWidgets('once the product is in the cart the slot is still the stepper', (tester) async {
      await pumpCard(tester, isGrid: false, cartQuantity: 3);

      expect(find.byType(QuantityStepper), findsOneWidget);
      expect(find.text('Add to cart'), findsNothing);
    });

    testWidgets('fits a phone-width row in Arabic', (tester) async {
      await loadRate(15000);
      await pumpCard(tester, isGrid: false, locale: const Locale('ar'));

      expect(find.text('إضافة إلى السلة'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}
