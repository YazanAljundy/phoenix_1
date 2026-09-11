import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:feniq/core/error/failure.dart';
import 'package:feniq/core/services/storage_service.dart';
import 'package:feniq/core/theme/dark_theme.dart';
import 'package:feniq/core/theme/light_theme.dart';
import 'package:feniq/core/widgets/empty_view.dart';
import 'package:feniq/features/advertisements/data/models/advertisement_model.dart';
import 'package:feniq/features/advertisements/data/repositories/advertisements_repository.dart';
import 'package:feniq/features/cart/data/repositories/order_repository.dart';
import 'package:feniq/features/cart/presentation/managers/cart_cubit.dart';
import 'package:feniq/features/catalog/data/models/manufacturers_route_args.dart';
import 'package:feniq/features/catalog/data/models/product_model.dart';
import 'package:feniq/features/exchange_rate/data/models/exchange_rate_model.dart';
import 'package:feniq/features/exchange_rate/data/repositories/exchange_rate_repository.dart';
import 'package:feniq/features/exchange_rate/presentation/managers/exchange_rate_cubit.dart';
import 'package:feniq/features/notifications/data/repositories/notification_repository.dart';
import 'package:feniq/features/notifications/presentation/managers/notification_cubit.dart';
import 'package:feniq/features/offers/data/models/offer_model.dart';
import 'package:feniq/features/offers/data/repositories/offers_repository.dart';
import 'package:feniq/features/promotions/presentation/managers/promotions_cubit.dart';
import 'package:feniq/features/promotions/presentation/managers/promotions_state.dart';
import 'package:feniq/features/promotions/presentation/managers/warehouse_offers_cubit.dart';
import 'package:feniq/features/promotions/presentation/views/promotions_view.dart';
import 'package:feniq/features/promotions/presentation/views/warehouse_offers_view.dart';
import 'package:feniq/features/promotions/presentation/widgets/promotion_hero_card.dart';
import 'package:feniq/features/warehouse_selection/data/repositories/warehouse_repository.dart';
import 'package:feniq/generated/app_localizations.dart';
import 'package:feniq/routes/route_names.dart';
import 'package:feniq/routes/route_paths.dart';

import 'promotions_fixtures.dart';

class _MockOffersRepository extends Mock implements OffersRepository {}

class _MockAdvertisementsRepository extends Mock implements AdvertisementsRepository {}

class _MockOrderRepository extends Mock implements OrderRepository {}

class _MockWarehouseRepository extends Mock implements WarehouseRepository {}

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

// The Offers chip on the Offers & Ads tab and the screen it opens: the offers
// of the ONE warehouse the pharmacist is ordering from (the cart's warehouse),
// never another warehouse's, and never a warehouse picked on their behalf.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late _MockOffersRepository offersRepository;
  late _MockAdvertisementsRepository advertisementsRepository;
  late _MockWarehouseRepository warehouseRepository;
  late _MockExchangeRateRepository exchangeRateRepository;
  late CartCubit cartCubit;
  late ExchangeRateCubit exchangeRateCubit;

  setUp(() {
    offersRepository = _MockOffersRepository();
    advertisementsRepository = _MockAdvertisementsRepository();
    warehouseRepository = _MockWarehouseRepository();
    exchangeRateRepository = _MockExchangeRateRepository();

    when(() => exchangeRateRepository.getExchangeRate())
        .thenAnswer((_) async => ExchangeRateModel(usdToSyp: 15000));
    // The cart looks up its warehouse's order limits when it binds - not what
    // is under test here.
    when(() => warehouseRepository.getWarehouseProfile(any()))
        .thenAnswer((_) async => throw Exception('limits fetch not exercised here'));

    cartCubit = CartCubit(
      orderRepository: _MockOrderRepository(),
      warehouseRepository: warehouseRepository,
    );
    exchangeRateCubit = ExchangeRateCubit(exchangeRateRepository: exchangeRateRepository);
  });

  tearDown(() async {
    await cartCubit.close();
    await exchangeRateCubit.close();
  });

  void stubOffers(List<OfferModel> offers) {
    when(() => offersRepository.getActiveOffers()).thenAnswer((_) async => offers);
  }

  group('WarehouseOffersCubit', () {
    test('keeps only the given warehouse offers, deepest saving first', () async {
      stubOffers([
        offer(id: 'o1', warehouseId: 'W1', discountPercentage: 10),
        offer(id: 'o2', warehouseId: 'W2', discountPercentage: 50),
        offer(id: 'o3', warehouseId: 'W1', discountPercentage: 30),
      ]);
      final cubit = WarehouseOffersCubit(offersRepository: offersRepository, warehouseId: 'W1');
      addTearDown(cubit.close);

      await cubit.load();

      expect(cubit.state.status, PromotionsStatus.loaded);
      expect(cubit.state.promotions.map((p) => p.id).toList(), ['o3', 'o1']);
      expect(cubit.state.promotions.map((p) => p.warehouseId).toSet(), {'W1'});
    });

    test('nothing running at this warehouse is an empty list, never another warehouse', () async {
      stubOffers([offer(id: 'o2', warehouseId: 'W2')]);
      final cubit = WarehouseOffersCubit(offersRepository: offersRepository, warehouseId: 'W1');
      addTearDown(cubit.close);

      await cubit.load();

      expect(cubit.state.status, PromotionsStatus.loaded);
      expect(cubit.state.promotions, isEmpty);
    });

    test('a failed load is the error state', () async {
      when(() => offersRepository.getActiveOffers()).thenAnswer(
        (_) async => throw ServerFailure('offers are down', code: 'SERVER_ERROR'),
      );
      final cubit = WarehouseOffersCubit(offersRepository: offersRepository, warehouseId: 'W1');
      addTearDown(cubit.close);

      await cubit.load();

      expect(cubit.state.status, PromotionsStatus.error);
      expect(cubit.state.errorCode, 'SERVER_ERROR');
    });
  });

  group('WarehouseOffersView', () {
    late WarehouseOffersCubit cubit;
    String? tappedWarehouseId;
    String? tappedManufacturer;

    setUp(() {
      tappedWarehouseId = null;
      tappedManufacturer = null;
      cubit = WarehouseOffersCubit(offersRepository: offersRepository, warehouseId: 'W1');
    });

    tearDown(() => cubit.close());

    Future<void> pumpView(
      WidgetTester tester, {
      ThemeMode themeMode = ThemeMode.light,
      Locale? locale,
    }) async {
      await cubit.load();
      final router = GoRouter(
        initialLocation: '/warehouses/W1/offers',
        routes: [
          GoRoute(
            name: RouteNames.warehouseOffers,
            path: RoutePaths.warehouseOffers,
            builder: (context, state) => BlocProvider.value(
              value: cubit,
              child: const WarehouseOffersView(warehouseName: 'Alpha'),
            ),
          ),
          GoRoute(
            name: RouteNames.manufacturers,
            path: RoutePaths.manufacturers,
            builder: (context, state) {
              tappedWarehouseId = state.pathParameters['warehouseId'];
              tappedManufacturer = (state.extra as ManufacturersRouteArgs?)?.autoFilterManufacturer;
              return const Scaffold(body: Text('MANUFACTURERS'));
            },
          ),
          GoRoute(
            name: RouteNames.cart,
            path: RoutePaths.cart,
            builder: (context, state) => const Scaffold(body: Text('CART')),
          ),
        ],
      );

      await tester.pumpWidget(
        MultiBlocProvider(
          providers: [
            BlocProvider<CartCubit>.value(value: cartCubit),
            BlocProvider<ExchangeRateCubit>.value(value: exchangeRateCubit),
          ],
          child: MaterialApp.router(
            routerConfig: router,
            theme: LightTheme.data,
            darkTheme: DarkTheme.data,
            themeMode: themeMode,
            locale: locale,
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
          ),
        ),
      );
      await tester.pumpAndSettle();
    }

    testWidgets('lists only this warehouse offers and names the warehouse', (tester) async {
      stubOffers([
        offer(id: 'o1', warehouseId: 'W1', titleEn: 'Offer One'),
        offer(id: 'o2', warehouseId: 'W2', titleEn: 'Offer Two'),
      ]);

      await pumpView(tester);

      expect(find.text('Warehouse offers'), findsOneWidget);
      expect(find.text('Alpha · 1 running now'), findsOneWidget);
      expect(find.text('Offer One'), findsOneWidget);
      expect(find.text('Offer Two'), findsNothing);
    });

    testWidgets('a tapped offer takes the existing catalog hand-off, into this warehouse', (
      tester,
    ) async {
      stubOffers([
        offer(id: 'o1', warehouseId: 'W1', titleEn: 'Offer One', manufacturerAr: 'شركة الاختبار'),
      ]);

      await pumpView(tester);
      await tester.tap(find.byType(PromotionListCard));
      await tester.pumpAndSettle();

      expect(find.text('MANUFACTURERS'), findsOneWidget);
      expect(tappedWarehouseId, 'W1');
      expect(tappedManufacturer, 'شركة الاختبار');
    });

    testWidgets('nothing running here shows the calm empty state', (tester) async {
      stubOffers([offer(id: 'o2', warehouseId: 'W2', titleEn: 'Offer Two')]);

      await pumpView(tester);

      expect(find.byType(EmptyView), findsOneWidget);
      expect(find.text('Nothing on offer right now'), findsOneWidget);
      expect(find.text('Offer Two'), findsNothing);
    });

    for (final themeMode in [ThemeMode.light, ThemeMode.dark]) {
      testWidgets('fits a 390pt phone in Arabic, ${themeMode.name} mode', (tester) async {
        tester.view.physicalSize = const Size(390, 844);
        tester.view.devicePixelRatio = 1.0;
        addTearDown(tester.view.reset);
        await exchangeRateCubit.load();
        stubOffers([
          offer(
            id: 'o1',
            warehouseId: 'W1',
            titleEn: 'A deliberately long winter promotion title',
            discountPercentage: 35,
          ),
          offer(id: 'o2', warehouseId: 'W1', isPermanent: true),
        ]);

        await pumpView(tester, themeMode: themeMode, locale: const Locale('ar'));

        expect(find.text('عروض المستودع'), findsOneWidget);
        expect(find.byType(PromotionListCard), findsNWidgets(2));
        expect(tester.takeException(), isNull);
      });
    }
  });

  group('the Offers chip on the Offers & Ads tab', () {
    late PromotionsCubit promotionsCubit;
    late NotificationCubit notificationCubit;
    String? openedWarehouseId;

    setUp(() async {
      openedWarehouseId = null;
      SharedPreferences.setMockInitialValues({});
      notificationCubit = NotificationCubit(
        repository: NotificationRepository(
          StorageService(await SharedPreferences.getInstance()),
        ),
      );
      promotionsCubit = PromotionsCubit(
        offersRepository: offersRepository,
        advertisementsRepository: advertisementsRepository,
      );
      when(() => advertisementsRepository.getActiveAdvertisements())
          .thenAnswer((_) async => const <AdvertisementModel>[]);
    });

    tearDown(() async {
      await promotionsCubit.close();
      await notificationCubit.close();
    });

    Future<void> pumpTab(WidgetTester tester) async {
      final router = GoRouter(
        initialLocation: RoutePaths.promotions,
        routes: [
          GoRoute(
            name: RouteNames.promotions,
            path: RoutePaths.promotions,
            builder: (context, state) => BlocProvider.value(
              value: promotionsCubit,
              child: const PromotionsView(),
            ),
          ),
          GoRoute(
            name: RouteNames.warehouseOffers,
            path: RoutePaths.warehouseOffers,
            builder: (context, state) {
              openedWarehouseId = state.pathParameters['warehouseId'];
              return Scaffold(body: Text('WAREHOUSE OFFERS ${state.extra}'));
            },
          ),
          GoRoute(
            name: RouteNames.warehouseSelection,
            path: RoutePaths.warehouseSelection,
            builder: (context, state) => const Scaffold(body: Text('WAREHOUSE SELECTION')),
          ),
        ],
      );

      await tester.pumpWidget(
        MultiRepositoryProvider(
          providers: [
            RepositoryProvider<OffersRepository>.value(value: offersRepository),
            RepositoryProvider<AdvertisementsRepository>.value(value: advertisementsRepository),
          ],
          child: MultiBlocProvider(
            providers: [
              BlocProvider<CartCubit>.value(value: cartCubit),
              BlocProvider<NotificationCubit>.value(value: notificationCubit),
              BlocProvider<ExchangeRateCubit>.value(value: exchangeRateCubit),
            ],
            child: MaterialApp.router(
              routerConfig: router,
              localizationsDelegates: AppLocalizations.localizationsDelegates,
              supportedLocales: AppLocalizations.supportedLocales,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
    }

    testWidgets('opens the offers of the warehouse the cart is ordering from', (tester) async {
      cartCubit.addProduct(_product, warehouseId: 'W2', warehouseName: 'Beta', quantity: 1);
      stubOffers([
        offer(id: 'o1', warehouseId: 'W1', warehouseNameEn: 'Alpha', titleEn: 'Offer One'),
        offer(id: 'o2', warehouseId: 'W2', warehouseNameEn: 'Beta', titleEn: 'Offer Two'),
      ]);

      await pumpTab(tester);
      await tester.tap(find.widgetWithText(ChoiceChip, 'Offers'));
      await tester.pumpAndSettle();

      expect(openedWarehouseId, 'W2');
      expect(find.text('WAREHOUSE OFFERS Beta'), findsOneWidget);
      // It navigates - it no longer narrows the all-warehouses list in place.
      expect(promotionsCubit.state.kindFilter, isNull);
    });

    testWidgets('with nothing in the cart it never picks a warehouse itself', (tester) async {
      stubOffers([offer(id: 'o1', warehouseId: 'W1', titleEn: 'Offer One')]);

      await pumpTab(tester);
      await tester.tap(find.widgetWithText(ChoiceChip, 'Offers'));
      await tester.pumpAndSettle();

      expect(openedWarehouseId, isNull);
      expect(find.text('No warehouse selected'), findsOneWidget);

      // The empty cart's own way out: go and choose a warehouse.
      await tester.tap(find.text('Browse products'));
      await tester.pumpAndSettle();

      expect(find.text('WAREHOUSE SELECTION'), findsOneWidget);
      expect(openedWarehouseId, isNull);
    });

    testWidgets('Packages still filters the list in place', (tester) async {
      stubOffers([offer(id: 'o1', warehouseId: 'W1', titleEn: 'Offer One')]);

      await pumpTab(tester);
      await tester.tap(find.widgetWithText(ChoiceChip, 'Packages'));
      await tester.pumpAndSettle();

      expect(openedWarehouseId, isNull);
      expect(promotionsCubit.state.kindFilter, isNotNull);
    });
  });
}
