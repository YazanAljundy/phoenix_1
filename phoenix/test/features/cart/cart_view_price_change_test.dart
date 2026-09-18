import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:feniq/core/error/failure.dart';
import 'package:feniq/features/cart/data/models/cart_item.dart';
import 'package:feniq/features/cart/data/models/order_model.dart';
import 'package:feniq/features/cart/data/repositories/order_repository.dart';
import 'package:feniq/features/cart/presentation/managers/cart_cubit.dart';
import 'package:feniq/features/cart/presentation/views/cart_view.dart';
import 'package:feniq/features/catalog/data/models/product_model.dart';
import 'package:feniq/features/exchange_rate/data/models/exchange_rate_model.dart';
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

const _placedOrder = OrderModel(
  id: 'o1',
  orderNumber: 1,
  status: 'pending',
  totalPrice: 0,
  discountAmount: 0,
  commissionAmount: 0,
  finalPrice: 0,
);

// The cart screen after a PRICE_CHANGED refusal: the new prices are shown in a
// dialog whose button is the only way to send them, and closing it sends
// nothing.
void main() {
  late CartCubit cartCubit;
  late ExchangeRateCubit rateCubit;
  late _MockOrderRepository orderRepo;
  // Every submit's lines, in order.
  late List<List<CartItem>> sentItems;

  setUpAll(() {
    registerFallbackValue(<CartItem>[]);
  });

  setUp(() async {
    sentItems = [];
    orderRepo = _MockOrderRepository();
    var calls = 0;
    when(
      () => orderRepo.submitOrder(
        warehouseId: any(named: 'warehouseId'),
        items: any(named: 'items'),
        notes: any(named: 'notes'),
        idempotencyKey: any(named: 'idempotencyKey'),
        rateUsed: any(named: 'rateUsed'),
      ),
    ).thenAnswer((invocation) async {
      sentItems.add(List.of(invocation.namedArguments[#items] as List<CartItem>));
      calls += 1;
      if (calls == 1) {
        throw ServerFailure(
          'Product p1 is now \$12 (was \$10).',
          code: 'PRICE_CHANGED',
          details: {
            'problems': [
              {'code': 'PRICE_CHANGED', 'productId': 'p1', 'displayedPriceUsd': 10, 'currentPriceUsd': 12},
            ],
          },
          statusCode: 400,
        );
      }
      return _placedOrder;
    });

    final warehouseRepo = _MockWarehouseRepository();
    when(
      () => warehouseRepo.getWarehouseProfile(any()),
    ).thenAnswer((_) async => throw Exception('limits fetch not exercised here'));
    cartCubit = CartCubit(orderRepository: orderRepo, warehouseRepository: warehouseRepo);

    // A real rate, so the dialog quotes real SYP figures (1 USD = 1,000 SYP).
    final rateRepo = _MockExchangeRateRepository();
    when(() => rateRepo.getExchangeRate()).thenAnswer((_) async => const ExchangeRateModel(usdToSyp: 1000));
    rateCubit = ExchangeRateCubit(exchangeRateRepository: rateRepo);
    await rateCubit.load();

    cartCubit.addProduct(_product('p1'), warehouseId: 'A', warehouseName: 'Warehouse A', quantity: 1);
    cartCubit.addProduct(_product('p2'), warehouseId: 'A', warehouseName: 'Warehouse A', quantity: 1);
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
          path: '/orders/:orderId',
          name: RouteNames.orderTracking,
          builder: (context, state) =>
              Scaffold(body: Text('tracking ${state.pathParameters['orderId']}')),
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

  Finder inDialog(String text) =>
      find.descendant(of: find.byType(AlertDialog), matching: find.text(text));

  // The cart's own submit button - the only "Submit order" outside a dialog.
  Future<void> tapSubmitButton(WidgetTester tester) async {
    final button = find.text('Submit order').first;
    await tester.ensureVisible(button);
    await tester.tap(button);
    await tester.pumpAndSettle();
  }

  // Submit through the ordinary confirmation, which the server refuses.
  Future<void> submitIntoPriceChange(WidgetTester tester) async {
    await tapSubmitButton(tester);
    expect(find.text('Submit order?'), findsOneWidget);
    await tester.tap(inDialog('Submit order'));
    await tester.pumpAndSettle();
  }

  testWidgets('the refusal opens a dialog listing the new price, with a submit button', (tester) async {
    await pumpCart(tester);

    await submitIntoPriceChange(tester);

    expect(sentItems, hasLength(1));
    expect(find.text('Some prices in your cart have changed.'), findsOneWidget);
    expect(
      find.text(
        'Product p1 is now 12,000 SYP (was 10,000 SYP). '
        'Submit again to place the order at the new prices.',
      ),
      findsOneWidget,
    );
    expect(inDialog('Submit order'), findsOneWidget);
    expect(inDialog('Close'), findsOneWidget);
    // The cart itself already shows the new subtotal: 12 + 10 USD.
    expect(find.text('22,000 SYP'), findsOneWidget);
  });

  testWidgets('closing the dialog sends nothing, and the submit button brings it back', (tester) async {
    await pumpCart(tester);
    await submitIntoPriceChange(tester);

    await tester.tap(inDialog('Close'));
    await tester.pumpAndSettle();

    expect(sentItems, hasLength(1), reason: 'nothing resent on its own');
    expect(cartCubit.state.hasUnconfirmedPriceChanges, isTrue);

    await tapSubmitButton(tester);

    // The price-change dialog again, not the generic confirmation that said
    // nothing about prices.
    expect(find.text('Some prices in your cart have changed.'), findsOneWidget);
    expect(find.text('Submit order?'), findsNothing);
    expect(sentItems, hasLength(1));
  });

  testWidgets('its submit button sends the cart at the new prices', (tester) async {
    await pumpCart(tester);
    await submitIntoPriceChange(tester);

    await tester.tap(inDialog('Submit order'));
    await tester.pumpAndSettle();

    expect(sentItems, hasLength(2));
    final p1 = sentItems.last.firstWhere((item) => item.productId == 'p1');
    expect(p1.discountPriceUsd, 12);
    expect(find.text('tracking o1'), findsOneWidget, reason: 'on to order tracking');
  });

  testWidgets('the dialog is localised in Arabic', (tester) async {
    await pumpCart(tester, locale: const Locale('ar'));

    final button = find.text('إرسال الطلب').first;
    await tester.ensureVisible(button);
    await tester.tap(button);
    await tester.pumpAndSettle();
    await tester.tap(inDialog('إرسال الطلب'));
    await tester.pumpAndSettle();

    expect(find.text('تغيّرت بعض الأسعار في سلتك.'), findsOneWidget);
    expect(inDialog('إرسال الطلب'), findsOneWidget);
    expect(inDialog('إغلاق'), findsOneWidget);
  });
}
