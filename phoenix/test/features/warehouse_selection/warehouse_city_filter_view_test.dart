import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:feniq/core/services/fcm_service.dart';
import 'package:feniq/core/services/secure_storage_service.dart';
import 'package:feniq/core/widgets/empty_view.dart';
import 'package:feniq/features/auth/data/repositories/auth_repository_impl.dart';
import 'package:feniq/features/auth/presentation/managers/auth_cubit.dart';
import 'package:feniq/features/banners/data/repositories/banners_repository.dart';
import 'package:feniq/features/banners/presentation/managers/banners_cubit.dart';
import 'package:feniq/features/cart/data/repositories/order_repository.dart';
import 'package:feniq/features/cart/presentation/managers/cart_cubit.dart';
import 'package:feniq/features/exchange_rate/data/models/exchange_rate_model.dart';
import 'package:feniq/features/exchange_rate/data/repositories/exchange_rate_repository.dart';
import 'package:feniq/features/exchange_rate/presentation/managers/exchange_rate_cubit.dart';
import 'package:feniq/features/notifications/data/models/notification_model.dart';
import 'package:feniq/features/notifications/data/repositories/notification_repository.dart';
import 'package:feniq/features/notifications/presentation/managers/notification_cubit.dart';
import 'package:feniq/features/warehouse_selection/data/models/warehouse_list_result.dart';
import 'package:feniq/features/warehouse_selection/data/models/warehouse_model.dart';
import 'package:feniq/features/warehouse_selection/data/repositories/warehouse_repository.dart';
import 'package:feniq/features/warehouse_selection/presentation/managers/warehouse_selection_cubit.dart';
import 'package:feniq/features/warehouse_selection/presentation/views/warehouse_selection_view.dart';
import 'package:feniq/features/warehouse_selection/presentation/widgets/warehouse_card.dart';
import 'package:feniq/features/warehouse_selection/presentation/widgets/warehouse_city_scope_bar.dart';
import 'package:feniq/generated/app_localizations.dart';
import 'package:feniq/routes/route_names.dart';

class _MockWarehouseRepository extends Mock implements WarehouseRepository {}

class _MockAuthRepository extends Mock implements AuthRepositoryImpl {}

class _MockSecureStorage extends Mock implements SecureStorageService {}

class _MockFcmService extends Mock implements FcmService {}

class _MockBannersRepository extends Mock implements BannersRepository {}

class _MockNotificationRepository extends Mock implements NotificationRepository {}

class _MockOrderRepository extends Mock implements OrderRepository {}

class _MockExchangeRateRepository extends Mock implements ExchangeRateRepository {}

WarehouseModel _warehouse({required String id, required String name, required String city}) =>
    WarehouseModel(
      id: id,
      nameAr: 'مستودع $name',
      nameEn: name,
      city: city,
      phone: '0940000001',
      // No logo, so the card draws its placeholder rather than reaching for
      // the network from a widget test.
      logo: null,
    );

// The pharmacy in these tests is in Latakia, which is what every pharmacy's
// stored city is today (the backend's auth.service.js hardcodes it).
final _homeWarehouse = _warehouse(id: 'w1', name: 'Home Warehouse', city: 'Latakia');
final _otherHomeWarehouse = _warehouse(id: 'w2', name: 'Second Home Warehouse', city: 'Latakia');
final _awayWarehouse = _warehouse(id: 'w3', name: 'Away Warehouse', city: 'Aleppo');

/// The warehouses screen's city filter: what a pharmacy sees when it opens the
/// screen, how it widens the search, and what the dead end looks like.
///
/// The filtering itself is the server's job (see the backend's
/// warehouse.service.js and its own tests) - these tests stand in for it with
/// a repository that answers differently per scope, and pin the half that
/// lives in the app: that the screen asks for its own city without being told
/// to, that the toggle actually re-asks, and that an empty city is never a
/// dead end.
void main() {
  late _MockWarehouseRepository warehouseRepository;
  late AuthCubit authCubit;
  late WarehouseSelectionCubit warehouseCubit;
  late ExchangeRateCubit exchangeRateCubit;
  late BannersCubit bannersCubit;
  late NotificationCubit notificationCubit;
  late CartCubit cartCubit;

  setUp(() {
    warehouseRepository = _MockWarehouseRepository();

    final fcmService = _MockFcmService();
    when(() => fcmService.markAppReady()).thenReturn(null);
    authCubit = AuthCubit(
      authRepository: _MockAuthRepository(),
      secureStorage: _MockSecureStorage(),
      fcmService: fcmService,
    );

    final notificationRepository = _MockNotificationRepository();
    when(() => notificationRepository.current).thenReturn(const <NotificationModel>[]);
    when(() => notificationRepository.changes)
        .thenAnswer((_) => const Stream<List<NotificationModel>>.empty());
    notificationCubit = NotificationCubit(repository: notificationRepository);

    // The screen fires these off on open. They render nothing on failure by
    // design, so a thrown stub keeps them out of the way without affecting
    // what is under test.
    final bannersRepository = _MockBannersRepository();
    when(() => bannersRepository.getActiveBanners()).thenAnswer((_) async => []);
    bannersCubit = BannersCubit(bannersRepository: bannersRepository);

    final exchangeRateRepository = _MockExchangeRateRepository();
    when(() => exchangeRateRepository.getExchangeRate())
        .thenAnswer((_) async => ExchangeRateModel(usdToSyp: 15000));
    exchangeRateCubit = ExchangeRateCubit(exchangeRateRepository: exchangeRateRepository);

    cartCubit = CartCubit(
      orderRepository: _MockOrderRepository(),
      warehouseRepository: warehouseRepository,
    );

    warehouseCubit = WarehouseSelectionCubit(warehouseRepository: warehouseRepository);
  });

  tearDown(() {
    authCubit.close();
    warehouseCubit.close();
    exchangeRateCubit.close();
    bannersCubit.close();
    notificationCubit.close();
    cartCubit.close();
  });

  /// Stands in for the server: the same endpoint answering differently
  /// depending on the scope the app asked for.
  void stubServer({
    required List<WarehouseModel> inMyCity,
    required List<WarehouseModel> everywhere,
    bool cityFilterApplied = true,
  }) {
    when(() => warehouseRepository.getWarehouses(onlyMyCity: true)).thenAnswer(
      (_) async => WarehouseListResult(
        warehouses: inMyCity,
        cityFilterApplied: cityFilterApplied,
        pharmacyCity: 'Latakia',
      ),
    );
    when(() => warehouseRepository.getWarehouses(onlyMyCity: false)).thenAnswer(
      (_) async => WarehouseListResult(
        warehouses: everywhere,
        cityFilterApplied: false,
        pharmacyCity: 'Latakia',
      ),
    );
  }

  Future<void> pumpScreen(WidgetTester tester) async {
    final router = GoRouter(
      initialLocation: '/warehouses',
      routes: [
        GoRoute(
          path: '/warehouses',
          name: RouteNames.warehouseSelection,
          builder: (context, state) => const WarehouseSelectionView(),
        ),
        GoRoute(
          path: '/manufacturers/:warehouseId',
          name: RouteNames.manufacturers,
          builder: (context, state) => const Scaffold(body: Text('manufacturers')),
        ),
        GoRoute(
          path: '/warehouse-profile/:warehouseId',
          name: RouteNames.warehouseProfile,
          builder: (context, state) => const Scaffold(body: Text('profile')),
        ),
      ],
    );

    await tester.pumpWidget(
      MultiBlocProvider(
        providers: [
          BlocProvider<AuthCubit>.value(value: authCubit),
          BlocProvider<WarehouseSelectionCubit>.value(value: warehouseCubit),
          BlocProvider<ExchangeRateCubit>.value(value: exchangeRateCubit),
          BlocProvider<BannersCubit>.value(value: bannersCubit),
          BlocProvider<NotificationCubit>.value(value: notificationCubit),
          BlocProvider<CartCubit>.value(value: cartCubit),
        ],
        child: MaterialApp.router(
          locale: const Locale('en'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          routerConfig: router,
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('the screen opens showing only the pharmacy\'s own city', (tester) async {
    stubServer(
      inMyCity: [_homeWarehouse, _otherHomeWarehouse],
      everywhere: [_homeWarehouse, _otherHomeWarehouse, _awayWarehouse],
    );

    await pumpScreen(tester);

    // Pre-filtered without the pharmacist doing anything: the very first
    // request already asks for the narrowed scope.
    verify(() => warehouseRepository.getWarehouses(onlyMyCity: true)).called(1);
    verifyNever(() => warehouseRepository.getWarehouses(onlyMyCity: false));

    expect(find.text('Home Warehouse'), findsOneWidget);
    expect(find.text('Second Home Warehouse'), findsOneWidget);
    expect(find.text('Away Warehouse'), findsNothing);
    expect(find.byType(WarehouseCard), findsNWidgets(2));
  });

  testWidgets('the "all cities" toggle widens the list to other cities', (tester) async {
    stubServer(
      inMyCity: [_homeWarehouse],
      everywhere: [_homeWarehouse, _awayWarehouse],
    );

    await pumpScreen(tester);
    expect(find.text('Away Warehouse'), findsNothing);

    // The escape hatch is in the open above the list, not behind a menu.
    expect(find.byType(WarehouseCityScopeBar), findsOneWidget);
    await tester.tap(find.text('All cities'));
    await tester.pumpAndSettle();

    verify(() => warehouseRepository.getWarehouses(onlyMyCity: false)).called(1);
    expect(find.text('Home Warehouse'), findsOneWidget);
    expect(find.text('Away Warehouse'), findsOneWidget);
    expect(find.byType(WarehouseCard), findsNWidgets(2));
  });

  testWidgets('switching back to "my city" narrows the list again', (tester) async {
    stubServer(
      inMyCity: [_homeWarehouse],
      everywhere: [_homeWarehouse, _awayWarehouse],
    );

    await pumpScreen(tester);
    await tester.tap(find.text('All cities'));
    await tester.pumpAndSettle();
    expect(find.text('Away Warehouse'), findsOneWidget);

    await tester.tap(find.text('My city'));
    await tester.pumpAndSettle();

    expect(find.text('Away Warehouse'), findsNothing);
    expect(find.text('Home Warehouse'), findsOneWidget);
  });

  testWidgets('an empty own city shows the calm message and its way out', (tester) async {
    stubServer(
      inMyCity: const [],
      everywhere: [_awayWarehouse],
    );

    await pumpScreen(tester);

    // The dead end reads as a normal state, not a failure.
    expect(find.text('No warehouses in your city'), findsOneWidget);
    expect(find.byType(EmptyView), findsOneWidget);
    // Not the generic "nothing on the platform" message - the pharmacist is
    // being told something specific and true.
    expect(find.text('No warehouses available yet.'), findsNothing);

    // And the way out is right there, not back up the screen.
    expect(find.text('View all cities'), findsOneWidget);
    await tester.tap(find.text('View all cities'));
    await tester.pumpAndSettle();

    verify(() => warehouseRepository.getWarehouses(onlyMyCity: false)).called(1);
    expect(find.text('Away Warehouse'), findsOneWidget);
    expect(find.text('No warehouses in your city'), findsNothing);
  });

  testWidgets('the scope toggle stays reachable from the empty state itself', (tester) async {
    stubServer(inMyCity: const [], everywhere: [_awayWarehouse]);

    await pumpScreen(tester);

    // Two independent ways out of the dead end - the chip above and the
    // button in the empty state - and the chip must not vanish just because
    // the list under it came back empty.
    expect(find.byType(WarehouseCityScopeBar), findsOneWidget);
    await tester.tap(find.text('All cities'));
    await tester.pumpAndSettle();

    expect(find.text('Away Warehouse'), findsOneWidget);
  });

  testWidgets('a pharmacy the server cannot filter gets no toggle and the full list', (tester) async {
    // The server reports it did not narrow the list (an unusable stored city).
    // Showing a "my city" chip here would promise something it cannot do.
    stubServer(
      inMyCity: [_homeWarehouse, _awayWarehouse],
      everywhere: [_homeWarehouse, _awayWarehouse],
      cityFilterApplied: false,
    );

    await pumpScreen(tester);

    expect(find.byType(WarehouseCityScopeBar), findsNothing);
    expect(find.text('Home Warehouse'), findsOneWidget);
    expect(find.text('Away Warehouse'), findsOneWidget);
  });

  testWidgets('an empty platform still shows the generic message, not the city one', (tester) async {
    // Nothing anywhere, and no city filter in play: this is the pre-existing
    // "no warehouses yet" state and it must not be replaced by a message that
    // would blame the pharmacy's city.
    stubServer(
      inMyCity: const [],
      everywhere: const [],
      cityFilterApplied: false,
    );

    await pumpScreen(tester);

    expect(find.text('No warehouses available yet.'), findsOneWidget);
    expect(find.text('No warehouses in your city'), findsNothing);
  });

  testWidgets('the search box still filters within whichever scope is showing', (tester) async {
    stubServer(
      inMyCity: [_homeWarehouse, _otherHomeWarehouse],
      everywhere: [_homeWarehouse, _otherHomeWarehouse, _awayWarehouse],
    );

    await pumpScreen(tester);
    await tester.enterText(find.byType(TextField), 'Second');
    await tester.pumpAndSettle();

    expect(find.text('Second Home Warehouse'), findsOneWidget);
    expect(find.text('Home Warehouse'), findsNothing);
  });
}
