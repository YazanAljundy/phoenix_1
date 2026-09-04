import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:phoenix/features/cart/data/models/cart_item.dart';
import 'package:phoenix/features/cart/data/repositories/order_repository.dart';
import 'package:phoenix/features/cart/presentation/managers/cart_cubit.dart';
import 'package:phoenix/features/cart/presentation/views/cart_view.dart';
import 'package:phoenix/features/catalog/data/models/catalog_route_args.dart';
import 'package:phoenix/features/catalog/data/models/manufacturers_route_args.dart';
import 'package:phoenix/features/catalog/data/models/product_model.dart';
import 'package:phoenix/features/exchange_rate/data/repositories/exchange_rate_repository.dart';
import 'package:phoenix/features/exchange_rate/presentation/managers/exchange_rate_cubit.dart';
import 'package:phoenix/features/warehouse_selection/data/repositories/warehouse_repository.dart';
import 'package:phoenix/generated/app_localizations.dart';
import 'package:phoenix/routes/route_names.dart';

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

// The "Add Product" flow inside the cart: shown only when the cart has items,
// and always entered at the CART'S OWN warehouse so another warehouse's
// companies can never be reached for this cart.
void main() {
  late CartCubit cartCubit;
  late ExchangeRateCubit rateCubit;
  // Records where the Add Product button actually navigated.
  String? pushedWarehouseId;
  String? pushedRouteName;

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
    pushedWarehouseId = null;
    pushedRouteName = null;
  });

  tearDown(() {
    cartCubit.close();
    rateCubit.close();
  });

  Future<void> pumpCart(WidgetTester tester) async {
    final router = GoRouter(
      initialLocation: '/cart',
      routes: [
        GoRoute(
          path: '/cart',
          name: RouteNames.cart,
          builder: (context, state) => const CartView(),
          routes: [
            GoRoute(
              path: 'manufacturers/:warehouseId',
              name: RouteNames.manufacturers,
              builder: (context, state) {
                pushedRouteName = RouteNames.manufacturers;
                pushedWarehouseId = state.pathParameters['warehouseId'];
                return const Scaffold(body: Text('manufacturers-screen'));
              },
            ),
          ],
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
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          routerConfig: router,
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('an empty cart keeps its existing UI and shows no Add Product button', (tester) async {
    await pumpCart(tester);

    expect(cartCubit.state.isEmpty, isTrue);
    // The existing empty-cart copy and its browse button are untouched.
    expect(find.text('Your cart is empty.'), findsOneWidget);
    expect(find.text('Choose a warehouse and start adding medicines to your cart.'), findsOneWidget);
    expect(find.text('Browse products'), findsOneWidget);
    // The new flow must not appear here.
    expect(find.text('Add product'), findsNothing);
  });

  testWidgets('a cart with products shows the Add Product button', (tester) async {
    cartCubit.addProduct(_product('p1'), warehouseId: 'A', warehouseName: 'Warehouse A', quantity: 1);
    await pumpCart(tester);

    expect(find.text('Add product'), findsOneWidget);
  });

  testWidgets('Add Product navigates to the manufacturers of the CART\'S warehouse', (tester) async {
    cartCubit.addProduct(_product('p1'), warehouseId: 'A', warehouseName: 'Warehouse A', quantity: 1);
    await pumpCart(tester);

    await tester.ensureVisible(find.text('Add product'));
    await tester.tap(find.text('Add product'));
    await tester.pumpAndSettle();

    expect(pushedRouteName, RouteNames.manufacturers);
    // The destination is the cart's own warehouse - there is no warehouse
    // picker in this flow, so a product from another warehouse can't be added.
    expect(pushedWarehouseId, 'A');
    expect(find.text('manufacturers-screen'), findsOneWidget);
  });

  testWidgets('a package cart shows the discount and the payable total', (tester) async {
    cartCubit.loadAdvertisement(
      advertisementId: 'ad1',
      warehouseId: 'A',
      warehouseName: 'Warehouse A',
      items: [
        CartItem.fromProduct(_product('p1'), quantity: 1, advertisementId: 'ad1'),
        CartItem.fromProduct(_product('p2'), quantity: 1, advertisementId: 'ad1'),
      ],
      itemsSubtotalUsd: 20,
      totalUsd: 15,
    );
    await pumpCart(tester);

    expect(find.text('Package discount'), findsOneWidget);
    expect(find.text('Total to pay'), findsOneWidget);
    // Add Product still works on a package cart.
    expect(find.text('Add product'), findsOneWidget);
  });

  testWidgets('a normal cart shows no package rows at all', (tester) async {
    cartCubit.addProduct(_product('p1'), warehouseId: 'A', warehouseName: 'Warehouse A', quantity: 1);
    await pumpCart(tester);

    expect(find.text('Package discount'), findsNothing);
    expect(find.text('Total to pay'), findsNothing);
    expect(find.text('Subtotal'), findsOneWidget);
  });
}

// Referenced by the route builders above so the imports stay honest about
// what the real router passes through.
// ignore: unused_element
void _unusedRouteArgTypes(ManufacturersRouteArgs a, CatalogRouteArgs b) {}
