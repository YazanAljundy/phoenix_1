import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:phoenix/core/widgets/quantity_stepper.dart';
import 'package:phoenix/features/cart/data/models/cart_item.dart';
import 'package:phoenix/features/cart/presentation/widgets/cart_item_tile.dart';
import 'package:phoenix/features/exchange_rate/data/repositories/exchange_rate_repository.dart';
import 'package:phoenix/features/exchange_rate/presentation/managers/exchange_rate_cubit.dart';
import 'package:phoenix/generated/app_localizations.dart';

class _MockExchangeRateRepository extends Mock implements ExchangeRateRepository {}

const _item = CartItem(
  productId: 'p1',
  nameAr: 'دواء',
  nameEn: 'Med',
  manufacturerAr: 'شركة',
  manufacturerEn: 'Co',
  unitPriceUsd: 10,
  discountPriceUsd: 10,
  quantity: 3,
);

void main() {
  late ExchangeRateCubit rateCubit;

  setUp(() {
    rateCubit = ExchangeRateCubit(exchangeRateRepository: _MockExchangeRateRepository());
  });
  tearDown(() => rateCubit.close());

  Future<void> pumpTile(
    WidgetTester tester, {
    required CartItem item,
    ValueChanged<int>? onQuantityChanged,
    VoidCallback? onRemove,
  }) {
    return tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: BlocProvider<ExchangeRateCubit>.value(
          value: rateCubit,
          child: Scaffold(
            body: CartItemTile(
              item: item,
              onQuantityChanged: onQuantityChanged ?? (_) {},
              onRemove: onRemove ?? () {},
            ),
          ),
        ),
      ),
    );
  }

  testWidgets('displays the real quantity from the cart item', (tester) async {
    await pumpTile(tester, item: _item);

    expect(find.byType(QuantityStepper), findsOneWidget);
    expect(find.text('3'), findsOneWidget);
  });

  testWidgets('+ asks the cart for quantity + 1', (tester) async {
    int? requested;
    await pumpTile(tester, item: _item, onQuantityChanged: (q) => requested = q);

    await tester.tap(find.byIcon(Icons.add));
    expect(requested, 4);
  });

  testWidgets('- above 1 asks the cart for quantity - 1', (tester) async {
    int? requested;
    await pumpTile(tester, item: _item, onQuantityChanged: (q) => requested = q);

    await tester.tap(find.byIcon(Icons.remove));
    expect(requested, 2);
  });

  testWidgets('typing a large quantity is passed straight to the cart', (tester) async {
    int? requested;
    await pumpTile(tester, item: _item, onQuantityChanged: (q) => requested = q);

    await tester.enterText(find.byType(TextField), '250');
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pump();

    expect(requested, 250);
  });

  testWidgets('- at quantity 1 confirms removal instead of dropping to 0', (tester) async {
    int? requested;
    var removed = false;
    await pumpTile(
      tester,
      item: _item.copyWith(quantity: 1),
      onQuantityChanged: (q) => requested = q,
      onRemove: () => removed = true,
    );

    await tester.tap(find.byIcon(Icons.remove));
    await tester.pumpAndSettle();

    expect(requested, isNull, reason: 'never emits quantity 0');
    expect(find.byType(AlertDialog), findsOneWidget);

    await tester.tap(find.text('Remove'));
    await tester.pumpAndSettle();
    expect(removed, isTrue);
  });
}
