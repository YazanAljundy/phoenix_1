import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:feniq/features/cart/data/models/cart_item.dart';
import 'package:feniq/features/cart/data/models/order_model.dart';
import 'package:feniq/features/cart/data/repositories/order_repository.dart';
import 'package:feniq/features/cart/presentation/managers/cart_cubit.dart';
import 'package:feniq/features/cart/presentation/views/cart_view.dart';
import 'package:feniq/features/cart/presentation/widgets/cart_item_tile.dart';
import 'package:feniq/features/catalog/data/models/product_model.dart';
import 'package:feniq/features/exchange_rate/data/models/exchange_rate_model.dart';
import 'package:feniq/features/exchange_rate/data/repositories/exchange_rate_repository.dart';
import 'package:feniq/features/exchange_rate/presentation/managers/exchange_rate_cubit.dart';
import 'package:feniq/features/warehouse_selection/data/models/warehouse_profile_model.dart';
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

WarehouseProfileModel _profile({num min = 0, num? max}) => WarehouseProfileModel(
  id: 'A',
  nameAr: 'مستودع',
  nameEn: 'Warehouse A',
  address: 'a',
  city: 'Latakia',
  phone: '0940000000',
  deliveryType: 'self',
  minOrderAmountUsd: min,
  maxOrderAmountUsd: max,
  averageRating: 0,
  reviewsCount: 0,
  recentReviews: const [],
);

// Opening the cart re-reads this warehouse's order-size limits, because the
// warehouse can change them while a cart sits open. What the screen must NOT
// do is go blank or freeze while that read is in the air.
void main() {
  late CartCubit cartCubit;
  late ExchangeRateCubit rateCubit;
  late _MockWarehouseRepository warehouseRepo;
  // The limits reads, in order, each answered by the test.
  late List<Completer<WarehouseProfileModel>> reads;

  setUpAll(() {
    registerFallbackValue(<CartItem>[]);
  });

  setUp(() async {
    reads = [];
    warehouseRepo = _MockWarehouseRepository();
    when(() => warehouseRepo.getWarehouseProfile(any())).thenAnswer((_) {
      final read = Completer<WarehouseProfileModel>();
      reads.add(read);
      return read.future;
    });

    final orderRepo = _MockOrderRepository();
    when(
      () => orderRepo.submitOrder(
        warehouseId: any(named: 'warehouseId'),
        items: any(named: 'items'),
        notes: any(named: 'notes'),
        idempotencyKey: any(named: 'idempotencyKey'),
        rateUsed: any(named: 'rateUsed'),
      ),
    ).thenAnswer((_) async => _placedOrder);
    cartCubit = CartCubit(orderRepository: orderRepo, warehouseRepository: warehouseRepo);

    final rateRepo = _MockExchangeRateRepository();
    when(() => rateRepo.getExchangeRate())
        .thenAnswer((_) async => const ExchangeRateModel(usdToSyp: 1000));
    rateCubit = ExchangeRateCubit(exchangeRateRepository: rateRepo);
    await rateCubit.load();

    // A $20 cart. The read this kicks off is the warehouse-bound one; the
    // test answers it so the screen starts from a settled state.
    cartCubit.addProduct(_product('p1'), warehouseId: 'A', warehouseName: 'Warehouse A', quantity: 2);
    await pumpEventQueue();
    reads.removeAt(0).complete(_profile(min: 5));
    await pumpEventQueue();
    reads.clear();
  });

  tearDown(() {
    cartCubit.close();
    rateCubit.close();
  });

  Future<void> pumpCart(WidgetTester tester) async {
    final router = GoRouter(
      initialLocation: '/cart',
      routes: [
        GoRoute(path: '/cart', name: RouteNames.cart, builder: (context, state) => const CartView()),
        GoRoute(
          path: '/orders/:orderId',
          name: RouteNames.orderTracking,
          builder: (context, state) => const Scaffold(body: Text('tracking')),
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
          locale: const Locale('en'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          routerConfig: router,
        ),
      ),
    );
    await tester.pump();
  }

  testWidgets('opening the cart re-reads the limits', (tester) async {
    await pumpCart(tester);

    // One read, opened by this screen: `reads` was emptied after the
    // warehouse-bound read that building the cart kicks off.
    expect(reads, hasLength(1));

    reads.removeAt(0).complete(_profile(min: 50));
    await tester.pumpAndSettle();

    // The screen shows the limit that is true now, not the one the cart was
    // built under.
    expect(find.text('Minimum order: 50,000 SYP'), findsOneWidget);
  });

  testWidgets('the cart keeps rendering, and stays usable, while the read is in the air', (tester) async {
    await pumpCart(tester);
    await tester.pump();

    // Mid-read: the line, the subtotal and the previous limit are all on
    // screen, and the submit button is still live.
    expect(reads, hasLength(1));
    expect(find.byType(CartItemTile), findsOneWidget);
    expect(find.text('20,000 SYP'), findsWidgets);
    expect(find.text('Minimum order: 5,000 SYP'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    final submit = tester.widget<ElevatedButton>(find.byType(ElevatedButton).first);
    expect(submit.onPressed, isNotNull, reason: 'not frozen while the limits are re-read');

    reads.removeAt(0).complete(_profile(min: 5));
    await tester.pumpAndSettle();

    // ...and the indicator goes when the answer lands, with the cart intact.
    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(find.byType(CartItemTile), findsOneWidget);
  });

  testWidgets('a raised minimum disables the button, a lowered one re-enables it', (tester) async {
    await pumpCart(tester);
    reads.removeAt(0).complete(_profile(min: 50));
    await tester.pumpAndSettle();

    expect(
      tester.widget<ElevatedButton>(find.byType(ElevatedButton).first).onPressed,
      isNull,
      reason: '\$20 no longer clears a \$50 minimum',
    );
    expect(find.text('Add 30,000 SYP more to reach the minimum'), findsOneWidget);

    // The pharmacist comes back to the cart later; by then the warehouse has
    // lowered it again.
    await pumpCart(tester);
    reads.removeAt(0).complete(_profile(min: 5));
    await tester.pumpAndSettle();

    expect(
      tester.widget<ElevatedButton>(find.byType(ElevatedButton).first).onPressed,
      isNotNull,
    );
  });

  testWidgets('a failed read leaves the cart and its limits exactly as they were', (tester) async {
    await pumpCart(tester);
    reads.removeAt(0).completeError(Exception('offline'));
    await tester.pumpAndSettle();

    expect(find.byType(CartItemTile), findsOneWidget);
    expect(find.text('Minimum order: 5,000 SYP'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(
      tester.widget<ElevatedButton>(find.byType(ElevatedButton).first).onPressed,
      isNotNull,
    );
  });
}
