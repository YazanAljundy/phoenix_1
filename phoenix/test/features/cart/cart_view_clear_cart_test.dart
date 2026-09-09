import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:feniq/features/cart/data/repositories/order_repository.dart';
import 'package:feniq/features/cart/presentation/managers/cart_cubit.dart';
import 'package:feniq/features/cart/presentation/views/cart_view.dart';
import 'package:feniq/features/catalog/data/models/product_model.dart';
import 'package:feniq/features/exchange_rate/data/repositories/exchange_rate_repository.dart';
import 'package:feniq/features/exchange_rate/presentation/managers/exchange_rate_cubit.dart';
import 'package:feniq/features/warehouse_selection/data/repositories/warehouse_repository.dart';
import 'package:feniq/generated/app_localizations.dart';
import 'package:feniq/routes/route_names.dart';

class _MockOrderRepository extends Mock implements OrderRepository {}

class _MockWarehouseRepository extends Mock implements WarehouseRepository {}

class _MockExchangeRateRepository extends Mock implements ExchangeRateRepository {}

ProductModel _product(String id) => ProductModel(
  id: id,
  nameAr: 'دواء $id',
  nameEn: 'Product $id',
  manufacturerAr: 'شركة',
  manufacturerEn: 'Pharma',
  priceUsd: 10,
  discountPriceUsd: 10,
  isAvailable: true,
  hasActiveOffer: false,
);

// The "Clear cart" control on the cart screen: hidden while there is nothing
// to clear, and always behind a confirmation before it empties anything.
void main() {
  late CartCubit cartCubit;
  late ExchangeRateCubit rateCubit;

  setUp(() {
    final warehouseRepo = _MockWarehouseRepository();
    when(
      () => warehouseRepo.getWarehouseProfile(any()),
    ).thenAnswer((_) async => throw Exception('limits fetch not exercised here'));
    cartCubit = CartCubit(
      orderRepository: _MockOrderRepository(),
      warehouseRepository: warehouseRepo,
    );
    rateCubit = ExchangeRateCubit(exchangeRateRepository: _MockExchangeRateRepository());
  });

  tearDown(() {
    cartCubit.close();
    rateCubit.close();
  });

  Future<void> pumpCart(WidgetTester tester, {Locale locale = const Locale('en')}) async {
    final router = GoRouter(
      initialLocation: '/cart',
      routes: [
        GoRoute(
          path: '/cart',
          name: RouteNames.cart,
          builder: (context, state) => const CartView(),
        ),
        GoRoute(
          path: '/warehouses',
          name: RouteNames.warehouseSelection,
          builder: (context, state) => const Scaffold(body: Text('warehouse-selection')),
        ),
      ],
    );

    await tester.pumpWidget(
      MultiBlocProvider(
        providers: [
          BlocProvider<CartCubit>.value(value: cartCubit),
          BlocProvider<ExchangeRateCubit>.value(value: rateCubit),
        ],
        child: MaterialApp.router(
          locale: locale,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          routerConfig: router,
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  Future<void> tapClearCart(WidgetTester tester, String label) async {
    await tester.ensureVisible(find.text(label));
    await tester.tap(find.text(label));
    await tester.pumpAndSettle();
  }

  testWidgets('an empty cart shows no Clear cart button', (tester) async {
    await pumpCart(tester);

    expect(cartCubit.state.isEmpty, isTrue);
    // The empty-cart screen is untouched - nothing to clear, no button.
    expect(find.text('Your cart is empty.'), findsOneWidget);
    expect(find.text('Clear cart'), findsNothing);
  });

  testWidgets('a cart with products shows the Clear cart button', (tester) async {
    cartCubit.addProduct(_product('p1'), warehouseId: 'A', warehouseName: 'Warehouse A', quantity: 1);
    await pumpCart(tester);

    expect(find.text('Clear cart'), findsOneWidget);
  });

  testWidgets('tapping it asks for confirmation and clears nothing until confirmed', (tester) async {
    cartCubit.addProduct(_product('p1'), warehouseId: 'A', warehouseName: 'Warehouse A', quantity: 1);
    cartCubit.addProduct(_product('p2'), warehouseId: 'A', warehouseName: 'Warehouse A', quantity: 2);
    await pumpCart(tester);

    await tapClearCart(tester, 'Clear cart');

    expect(find.text('Clear cart?'), findsOneWidget);
    expect(
      find.text('Are you sure you want to clear all the contents of your cart?'),
      findsOneWidget,
    );
    // Dismissing the dialog leaves the cart exactly as it was.
    await tester.tap(find.text('Close'));
    await tester.pumpAndSettle();

    expect(cartCubit.state.items, hasLength(2));
    expect(find.text('Product p1'), findsOneWidget);
  });

  testWidgets('confirming empties the cart and the UI updates immediately', (tester) async {
    cartCubit.addProduct(_product('p1'), warehouseId: 'A', warehouseName: 'Warehouse A', quantity: 1);
    cartCubit.addProduct(_product('p2'), warehouseId: 'A', warehouseName: 'Warehouse A', quantity: 2);
    await pumpCart(tester);

    await tapClearCart(tester, 'Clear cart');
    // The dialog's action carries the same label as the button that opened it,
    // so target the one inside the dialog.
    await tester.tap(find.descendant(of: find.byType(AlertDialog), matching: find.text('Clear cart')));
    await tester.pumpAndSettle();

    expect(cartCubit.state.isEmpty, isTrue);
    // The screen has already swapped to the empty-cart state - no rebuild
    // needed beyond the cubit's own emit.
    expect(find.text('Your cart is empty.'), findsOneWidget);
    expect(find.text('Product p1'), findsNothing);
    // And the button is gone with the items it would have cleared.
    expect(find.text('Clear cart'), findsNothing);
  });

  testWidgets('the button and its confirmation are localised in Arabic', (tester) async {
    cartCubit.addProduct(_product('p1'), warehouseId: 'A', warehouseName: 'مستودع أ', quantity: 1);
    await pumpCart(tester, locale: const Locale('ar'));

    expect(find.text('مسح السلة'), findsOneWidget);

    await tapClearCart(tester, 'مسح السلة');

    expect(find.text('مسح السلة؟'), findsOneWidget);
    expect(find.text('هل أنت متأكد من مسح جميع محتويات السلة؟'), findsOneWidget);
  });
}
