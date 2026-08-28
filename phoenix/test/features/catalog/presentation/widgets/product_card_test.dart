import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:phoenix/core/widgets/quantity_stepper.dart';
import 'package:phoenix/features/catalog/data/models/product_model.dart';
import 'package:phoenix/features/catalog/presentation/widgets/product_card.dart';
import 'package:phoenix/features/exchange_rate/data/repositories/exchange_rate_repository.dart';
import 'package:phoenix/features/exchange_rate/presentation/managers/exchange_rate_cubit.dart';
import 'package:phoenix/generated/app_localizations.dart';

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

  setUp(() {
    rateCubit = ExchangeRateCubit(exchangeRateRepository: _MockExchangeRateRepository());
  });
  tearDown(() => rateCubit.close());

  Future<void> pumpCard(
    WidgetTester tester, {
    int cartQuantity = 0,
    ValueChanged<int>? onAdd,
    ValueChanged<int>? onCartQuantityChanged,
    VoidCallback? onCartRemove,
  }) {
    return tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: BlocProvider<ExchangeRateCubit>.value(
          value: rateCubit,
          child: Scaffold(
            body: Center(
              child: SizedBox(
                width: 160,
                height: 300,
                child: ProductCard(
                  product: _product,
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
}
