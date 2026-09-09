import 'package:bloc_test/bloc_test.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:feniq/core/widgets/app_skeleton.dart';
import 'package:feniq/features/cart/data/repositories/order_repository.dart';
import 'package:feniq/features/cart/presentation/managers/cart_cubit.dart';
import 'package:feniq/features/catalog/presentation/managers/catalog_cubit.dart';
import 'package:feniq/features/catalog/presentation/managers/catalog_state.dart';
import 'package:feniq/features/catalog/presentation/managers/manufacturers_cubit.dart';
import 'package:feniq/features/catalog/presentation/managers/manufacturers_state.dart';
import 'package:feniq/features/catalog/presentation/views/catalog_view.dart';
import 'package:feniq/features/catalog/presentation/views/manufacturers_view.dart';
import 'package:feniq/features/complaints/presentation/managers/my_complaints_cubit.dart';
import 'package:feniq/features/complaints/presentation/managers/my_complaints_state.dart';
import 'package:feniq/features/complaints/presentation/views/my_complaints_view.dart';
import 'package:feniq/features/exchange_rate/presentation/managers/exchange_rate_cubit.dart';
import 'package:feniq/features/exchange_rate/presentation/managers/exchange_rate_state.dart';
import 'package:feniq/features/my_orders/presentation/managers/my_orders_cubit.dart';
import 'package:feniq/features/my_orders/presentation/managers/my_orders_state.dart';
import 'package:feniq/features/my_orders/presentation/views/my_orders_view.dart';
import 'package:feniq/features/reviews/presentation/managers/pharmacy_reviews_cubit.dart';
import 'package:feniq/features/reviews/presentation/managers/pharmacy_reviews_state.dart';
import 'package:feniq/features/reviews/presentation/views/pharmacy_reviews_view.dart';
import 'package:feniq/features/warehouse_selection/data/repositories/warehouse_repository.dart';
import 'package:feniq/generated/app_localizations.dart';

// Every screen that used to answer a first load with a bare spinner now
// answers it with a placeholder shaped like the content that is coming. This
// checks the swap on a representative screen of each shape: a card list, a
// grid, and a detail-ish page.

class MockMyOrdersCubit extends MockCubit<MyOrdersState>
    implements MyOrdersCubit {}

class MockCatalogCubit extends MockCubit<CatalogState> implements CatalogCubit {}

class MockManufacturersCubit extends MockCubit<ManufacturersState>
    implements ManufacturersCubit {}

class MockMyComplaintsCubit extends MockCubit<MyComplaintsState>
    implements MyComplaintsCubit {}

class MockPharmacyReviewsCubit extends MockCubit<PharmacyReviewsState>
    implements PharmacyReviewsCubit {}

class MockExchangeRateCubit extends MockCubit<ExchangeRateState>
    implements ExchangeRateCubit {}

class MockOrderRepository extends Mock implements OrderRepository {}

class MockWarehouseRepository extends Mock implements WarehouseRepository {}

void main() {
  late CartCubit cartCubit;

  setUp(() {
    final warehouseRepo = MockWarehouseRepository();
    when(
      () => warehouseRepo.getWarehouseProfile(any()),
    ).thenAnswer((_) async => throw Exception('limits fetch not exercised'));
    cartCubit = CartCubit(
      orderRepository: MockOrderRepository(),
      warehouseRepository: warehouseRepo,
    );
  });

  tearDown(() => cartCubit.close());

  // A loading screen animates forever, so nothing here may pumpAndSettle.
  Future<void> pumpScreen(WidgetTester tester, Widget child) async {
    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: InheritedGoRouter(
          goRouter: GoRouter(
            routes: [GoRoute(path: '/', builder: (_, __) => const SizedBox())],
          ),
          child: child,
        ),
      ),
    );
    await tester.pump();
  }

  void expectSkeletonNotSpinner(WidgetTester tester) {
    expect(find.byType(SkeletonPulse), findsWidgets);
    expect(find.byType(CircularProgressIndicator), findsNothing);
  }

  testWidgets('My Orders shows order-card placeholders while loading', (
    tester,
  ) async {
    final cubit = MockMyOrdersCubit();
    when(() => cubit.state).thenReturn(
      const MyOrdersState(status: MyOrdersStatus.loading),
    );
    when(() => cubit.load()).thenAnswer((_) async {});
    when(() => cubit.loadMore()).thenAnswer((_) async {});

    await pumpScreen(
      tester,
      MultiBlocProvider(
        providers: [
          BlocProvider<MyOrdersCubit>.value(value: cubit),
          BlocProvider<CartCubit>.value(value: cartCubit),
        ],
        child: const MyOrdersView(),
      ),
    );

    expectSkeletonNotSpinner(tester);
    expect(find.byType(SkeletonCardList), findsOneWidget);
    expect(find.byType(SkeletonListCard), findsNWidgets(4));
  });

  testWidgets('My Complaints shows complaint-card placeholders while loading', (
    tester,
  ) async {
    final cubit = MockMyComplaintsCubit();
    when(() => cubit.state).thenReturn(
      const MyComplaintsState(status: MyComplaintsStatus.loading),
    );
    when(() => cubit.load()).thenAnswer((_) async {});
    when(() => cubit.loadMore()).thenAnswer((_) async {});

    await pumpScreen(
      tester,
      MultiBlocProvider(
        providers: [
          BlocProvider<MyComplaintsCubit>.value(value: cubit),
          BlocProvider<CartCubit>.value(value: cartCubit),
        ],
        child: const MyComplaintsView(),
      ),
    );

    expectSkeletonNotSpinner(tester);
    expect(find.byType(SkeletonCardList), findsOneWidget);
  });

  testWidgets('the catalog shows product-cell placeholders in its grid '
      'metrics while loading', (tester) async {
    final cubit = MockCatalogCubit();
    when(
      () => cubit.state,
    ).thenReturn(const CatalogState(status: CatalogStatus.loading));
    when(() => cubit.initialize()).thenAnswer((_) async {});
    when(() => cubit.loadMore()).thenAnswer((_) async {});

    final rate = MockExchangeRateCubit();
    when(() => rate.state).thenReturn(const ExchangeRateState(usdToSyp: 15000));

    await pumpScreen(
      tester,
      MultiBlocProvider(
        providers: [
          BlocProvider<CatalogCubit>.value(value: cubit),
          BlocProvider<CartCubit>.value(value: cartCubit),
          BlocProvider<ExchangeRateCubit>.value(value: rate),
        ],
        child: const CatalogView(
          warehouseId: 'w1',
          warehouseName: 'Warehouse',
          manufacturer: 'Acme',
        ),
      ),
    );

    expectSkeletonNotSpinner(tester);
    expect(find.byType(SkeletonCard), findsWidgets);
  });

  testWidgets('the manufacturers grid shows cell placeholders while loading', (
    tester,
  ) async {
    final cubit = MockManufacturersCubit();
    when(() => cubit.state).thenReturn(
      const ManufacturersState(status: ManufacturersStatus.loading),
    );
    when(() => cubit.loadManufacturers()).thenAnswer((_) async {});

    await pumpScreen(
      tester,
      MultiBlocProvider(
        providers: [
          BlocProvider<ManufacturersCubit>.value(value: cubit),
          BlocProvider<CartCubit>.value(value: cartCubit),
        ],
        child: const ManufacturersView(
          warehouseId: 'w1',
          warehouseName: 'Warehouse',
        ),
      ),
    );

    expectSkeletonNotSpinner(tester);
    expect(find.byType(SkeletonGrid), findsOneWidget);
  });

  testWidgets('the ratings page shows a summary block and review placeholders', (
    tester,
  ) async {
    final cubit = MockPharmacyReviewsCubit();
    when(() => cubit.state).thenReturn(
      const PharmacyReviewsState(status: PharmacyReviewsStatus.loading),
    );
    when(() => cubit.load()).thenAnswer((_) async {});

    await pumpScreen(
      tester,
      BlocProvider<PharmacyReviewsCubit>.value(
        value: cubit,
        child: const PharmacyReviewsView(),
      ),
    );

    expectSkeletonNotSpinner(tester);
    expect(find.byType(SkeletonPage), findsOneWidget);
    expect(find.byType(SkeletonListCard), findsNWidgets(3));
  });
}
