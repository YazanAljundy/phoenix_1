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

// The cart screen after a RATE_CHANGED refusal: the order was converted at a
// rate that has since moved, so the pharmacist is shown what the same cart now
// comes to and asked again. Nothing is resent on its own.
void main() {
  late CartCubit cartCubit;
  late ExchangeRateCubit rateCubit;
  late _MockOrderRepository orderRepo;
  late _MockExchangeRateRepository rateRepo;
  // The rate each submit carried, in order.
  late List<double?> sentRates;

  setUpAll(() {
    registerFallbackValue(<CartItem>[]);
  });

  setUp(() async {
    sentRates = [];
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
      sentRates.add(invocation.namedArguments[#rateUsed] as double?);
      calls += 1;
      if (calls == 1) {
        // The server's refusal, exactly as exchangeRate.service.js builds it.
        throw ServerFailure(
          'The exchange rate changed since this amount was converted.',
          code: 'RATE_CHANGED',
          details: {'rateUsed': 1000, 'currentUsdToSyp': 1200},
          statusCode: 409,
        );
      }
      return _placedOrder;
    });

    final warehouseRepo = _MockWarehouseRepository();
    when(
      () => warehouseRepo.getWarehouseProfile(any()),
    ).thenAnswer((_) async => throw Exception('limits fetch not exercised here'));
    cartCubit = CartCubit(orderRepository: orderRepo, warehouseRepository: warehouseRepo);

    // The rate the screen is showing: 1 USD = 1,000 SYP.
    rateRepo = _MockExchangeRateRepository();
    when(() => rateRepo.getExchangeRate())
        .thenAnswer((_) async => const ExchangeRateModel(usdToSyp: 1000));
    rateCubit = ExchangeRateCubit(exchangeRateRepository: rateRepo);
    await rateCubit.load();

    cartCubit.addProduct(_product('p1'), warehouseId: 'A', warehouseName: 'Warehouse A', quantity: 2);
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

  Future<void> tapSubmitButton(WidgetTester tester) async {
    final button = find.text('Submit order').first;
    await tester.ensureVisible(button);
    await tester.tap(button);
    await tester.pumpAndSettle();
  }

  // Submit through the ordinary confirmation, which the server refuses on the
  // rate.
  Future<void> submitIntoRateChange(WidgetTester tester) async {
    await tapSubmitButton(tester);
    expect(find.text('Submit order?'), findsOneWidget);
    await tester.tap(inDialog('Submit order'));
    await tester.pumpAndSettle();
  }

  testWidgets('the submit carries the rate the screen is showing', (tester) async {
    await pumpCart(tester);

    await submitIntoRateChange(tester);

    expect(sentRates, [1000.0]);
  });

  testWidgets('the refusal opens a dialog with both totals, not a plain error', (tester) async {
    await pumpCart(tester);

    await submitIntoRateChange(tester);

    expect(find.text('The exchange rate changed'), findsOneWidget);
    // 2 x $10: 24,000 SYP at the new rate, against the 20,000 on screen.
    expect(
      find.text(
        'Your order comes to 24,000 SYP at the new rate, instead of 20,000 SYP.\n\n'
        'Submit again to place the order at the new rate.',
      ),
      findsOneWidget,
    );
    expect(inDialog('Submit order'), findsOneWidget);
    expect(inDialog('Close'), findsOneWidget);
  });

  testWidgets('the refusal re-reads the rate, so every screen stops showing the old one', (tester) async {
    await pumpCart(tester);
    // Once for the setUp load; the refusal is what triggers the second.
    verify(() => rateRepo.getExchangeRate()).called(1);

    await submitIntoRateChange(tester);

    verify(() => rateRepo.getExchangeRate()).called(1);
  });

  testWidgets('closing the dialog sends nothing, and the submit button brings it back', (tester) async {
    await pumpCart(tester);
    await submitIntoRateChange(tester);

    await tester.tap(inDialog('Close'));
    await tester.pumpAndSettle();

    expect(sentRates, hasLength(1), reason: 'nothing resent on its own');

    await tapSubmitButton(tester);
    // The ordinary confirmation again - the cart itself is unchanged, so this
    // is the normal path, and it is still the pharmacist who decides.
    expect(find.text('Submit order?'), findsOneWidget);
    expect(sentRates, hasLength(1));
  });

  testWidgets('confirming resends once, at the new rate, and the order goes through', (tester) async {
    await pumpCart(tester);
    await submitIntoRateChange(tester);

    await tester.tap(inDialog('Submit order'));
    await tester.pumpAndSettle();

    expect(sentRates, [1000.0, 1200.0]);
    expect(find.text('tracking o1'), findsOneWidget);
  });

  testWidgets('the cart and its idempotency key survive the refusal', (tester) async {
    await pumpCart(tester);

    await submitIntoRateChange(tester);

    // Nothing about what is ordered changed, so the cart is untouched and the
    // key stands - the confirmed resubmit is still the same order to the
    // server (order.service.js keeps rateUsed out of the fingerprint).
    expect(cartCubit.state.items.single.productId, 'p1');
    expect(cartCubit.state.items.single.quantity, 2);
    expect(cartCubit.state.hasUnconfirmedPriceChanges, isFalse);
    expect(cartCubit.state.pendingIdempotencyKey, isNotNull);

    final key = cartCubit.state.pendingIdempotencyKey;
    await tester.tap(inDialog('Submit order'));
    await tester.pumpAndSettle();

    verify(
      () => orderRepo.submitOrder(
        warehouseId: any(named: 'warehouseId'),
        items: any(named: 'items'),
        notes: any(named: 'notes'),
        idempotencyKey: key,
        rateUsed: 1200.0,
      ),
    ).called(1);
  });

  testWidgets('in Arabic too', (tester) async {
    await pumpCart(tester, locale: const Locale('ar'));

    await tester.tap(find.text('إرسال الطلب').first);
    await tester.pumpAndSettle();
    await tester.tap(inDialog('إرسال الطلب'));
    await tester.pumpAndSettle();

    expect(find.text('تغيّر سعر الصرف'), findsOneWidget);
    expect(
      find.text(
        'مجموع طلبك بالسعر الجديد 24,000 ل.س بدل 20,000 ل.س.\n\n'
        'أرسل الطلب مرة أخرى لتأكيده بالسعر الجديد.',
      ),
      findsOneWidget,
    );
  });
}
