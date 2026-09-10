import 'package:bloc_test/bloc_test.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:feniq/features/cart/data/repositories/order_repository.dart';
import 'package:feniq/features/cart/presentation/managers/cart_cubit.dart';
import 'package:feniq/features/cart/presentation/widgets/cart_button.dart';
import 'package:feniq/features/catalog/data/models/product_model.dart';
import 'package:feniq/features/my_orders/presentation/managers/my_orders_cubit.dart';
import 'package:feniq/features/my_orders/presentation/managers/my_orders_state.dart';
import 'package:feniq/features/my_orders/presentation/views/my_orders_view.dart';
import 'package:feniq/features/warehouse_selection/data/repositories/warehouse_repository.dart';
import 'package:feniq/generated/app_localizations.dart';
import 'package:feniq/routes/route_names.dart';
import 'package:feniq/routes/route_paths.dart';

class MockMyOrdersCubit extends MockCubit<MyOrdersState> implements MyOrdersCubit {}

class MockOrderRepository extends Mock implements OrderRepository {}

class MockWarehouseRepository extends Mock implements WarehouseRepository {}

ProductModel _product(String id) => ProductModel(
  id: id,
  nameAr: 'دواء $id',
  manufacturerAr: 'شركة',
  priceUsd: 10,
  discountPriceUsd: 10,
  isAvailable: true,
  hasActiveOffer: false,
);

void main() {
  late MockMyOrdersCubit ordersCubit;
  late CartCubit cartCubit;
  late MockWarehouseRepository warehouseRepo;

  setUp(() {
    ordersCubit = MockMyOrdersCubit();
    when(() => ordersCubit.state).thenReturn(const MyOrdersState(status: MyOrdersStatus.loaded));
    when(() => ordersCubit.load()).thenAnswer((_) async {});
    when(() => ordersCubit.loadMore()).thenAnswer((_) async {});

    warehouseRepo = MockWarehouseRepository();
    when(
      () => warehouseRepo.getWarehouseProfile(any()),
    ).thenAnswer((_) async => throw Exception('limits fetch not exercised here'));
    cartCubit = CartCubit(orderRepository: MockOrderRepository(), warehouseRepository: warehouseRepo);
  });

  tearDown(() => cartCubit.close());

  Future<void> pumpMyOrders(WidgetTester tester) async {
    final router = GoRouter(
      initialLocation: RoutePaths.myOrders,
      routes: [
        GoRoute(
          path: RoutePaths.myOrders,
          name: RouteNames.myOrders,
          builder: (context, state) => MultiBlocProvider(
            providers: [
              BlocProvider<MyOrdersCubit>.value(value: ordersCubit),
              BlocProvider<CartCubit>.value(value: cartCubit),
            ],
            child: const MyOrdersView(),
          ),
        ),
        GoRoute(
          path: RoutePaths.cart,
          name: RouteNames.cart,
          builder: (context, state) => const Scaffold(body: Text('CART PAGE')),
        ),
      ],
    );

    await tester.pumpWidget(
      MaterialApp.router(
        routerConfig: router,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
      ),
    );
    await tester.pumpAndSettle();
  }

  group('Test 7: My Orders shows the shared CartButton', () {
    testWidgets('the button is in the AppBar and the badge is hidden for an empty cart', (
      tester,
    ) async {
      await pumpMyOrders(tester);

      expect(find.byType(CartButton), findsOneWidget);
      expect(find.descendant(of: find.byType(AppBar), matching: find.byType(CartButton)), findsOneWidget);
      // Empty cart -> Badge label not shown.
      expect(find.text('0'), findsNothing);
    });

    testWidgets('the badge counts the lines in the cart', (tester) async {
      cartCubit.addProduct(_product('p1'), warehouseId: 'A', warehouseName: 'Warehouse A', quantity: 2);
      cartCubit.addProduct(_product('p2'), warehouseId: 'A', warehouseName: 'Warehouse A', quantity: 1);

      await pumpMyOrders(tester);

      // Two lines - the badge answers "how many things are in my cart", not
      // how many units, so a package counts once too.
      expect(find.text('2'), findsOneWidget);
    });

    testWidgets('tapping it navigates to the existing cart route', (tester) async {
      await pumpMyOrders(tester);

      await tester.tap(find.byType(CartButton));
      await tester.pumpAndSettle();

      expect(find.text('CART PAGE'), findsOneWidget);
    });
  });

  group('Test 8: the badge updates live with CartCubit', () {
    testWidgets('add / change quantity / remove / clear all reflect immediately', (tester) async {
      await pumpMyOrders(tester);
      expect(find.text('0'), findsNothing);

      cartCubit.addProduct(_product('p1'), warehouseId: 'A', warehouseName: 'Warehouse A', quantity: 1);
      await tester.pumpAndSettle();
      expect(find.text('1'), findsOneWidget);

      cartCubit.addProduct(_product('p2'), warehouseId: 'A', warehouseName: 'Warehouse A', quantity: 1);
      await tester.pumpAndSettle();
      expect(find.text('2'), findsOneWidget);

      // A quantity change leaves the badge alone: still two lines.
      cartCubit.updateQuantity('p1', 5);
      await tester.pumpAndSettle();
      expect(find.text('2'), findsOneWidget);

      cartCubit.removeItem('p2');
      await tester.pumpAndSettle();
      expect(find.text('1'), findsOneWidget);

      cartCubit.removeItem('p1');
      await tester.pumpAndSettle();
      expect(find.text('1'), findsNothing);
      expect(find.text('0'), findsNothing); // empty cart hides the badge
    });
  });
}
