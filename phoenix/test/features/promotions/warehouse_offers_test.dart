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
import 'package:feniq/core/widgets/quantity_stepper.dart';
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
import 'package:feniq/features/promotions/data/models/promotion.dart';
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

// WarehouseOffersCubit/View: the offers running at ONE given warehouse, and
// nothing else. Opened today by tapping an Offer card on the Offers & Ads
// tab (see promotions_view_test.dart), scoped to that offer's own warehouse.
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
    // CartCubit fetches the warehouse's order limits whenever the cart binds
    // to a warehouse and swallows any failure - the limits are not what these
    // tests are about.
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

    // The add path, copied from the catalog: the pre-add quantity sheet, then
    // CartCubit.addProduct. Tapping an offer no longer hands off to the
    // manufacturer -> catalog flow to find the same product again.
    testWidgets('a tapped offer goes into the cart, not into the manufacturers hand-off', (
      tester,
    ) async {
      stubOffers([
        offer(id: 'o1', warehouseId: 'W1', titleEn: 'Offer One', manufacturerAr: 'شركة الاختبار'),
      ]);

      await pumpView(tester);
      await tester.tap(find.byType(PromotionListCard));
      await tester.pumpAndSettle();
      // The app's existing pre-add sheet, exactly as the catalog opens it.
      await tester.tap(find.text('Add'));
      await tester.pumpAndSettle();

      expect(find.text('MANUFACTURERS'), findsNothing);
      expect(tappedWarehouseId, isNull);
      expect(tappedManufacturer, isNull);
      expect(cartCubit.state.items, hasLength(1));
      // The PRODUCT's id, not the offer's - so the same product added from the
      // catalog lands on this very line.
      expect(cartCubit.state.items.single.productId, 'p-o1');
      expect(cartCubit.state.items.single.quantity, 1);
      expect(cartCubit.state.warehouseId, 'W1');
      expect(cartCubit.state.warehouseName, 'Warehouse One');
    });

    testWidgets('the cart line is priced at the offer price, not the list price', (tester) async {
      stubOffers([
        offer(id: 'o1', warehouseId: 'W1', priceUsd: 10, discountPercentage: 20),
      ]);

      await pumpView(tester);
      await tester.tap(find.byType(PromotionListCard));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Add'));
      await tester.pumpAndSettle();

      final line = cartCubit.state.items.single;
      expect(line.discountPriceUsd, 8);
      expect(line.unitPriceUsd, 10);
      expect(line.hasOffer, isTrue);
    });

    testWidgets('the card carries the catalog\'s own add button, running the same flow', (
      tester,
    ) async {
      stubOffers([offer(id: 'o1', warehouseId: 'W1')]);

      await pumpView(tester);
      expect(find.text('Add to cart'), findsOneWidget);

      await tester.tap(find.text('Add to cart'));
      await tester.pumpAndSettle();
      // Step the sheet to 2, then confirm - the catalog's exact flow.
      await tester.tap(find.byIcon(Icons.add));
      await tester.pump();
      await tester.tap(find.text('Add'));
      await tester.pumpAndSettle();

      expect(cartCubit.state.items.single.quantity, 2);
    });

    testWidgets('once in the cart the slot is a stepper and the card stops adding', (tester) async {
      stubOffers([offer(id: 'o1', warehouseId: 'W1')]);

      await pumpView(tester);
      await tester.tap(find.byType(PromotionListCard));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Add'));
      await tester.pumpAndSettle();

      expect(find.byType(QuantityStepper), findsOneWidget);
      expect(find.text('Add to cart'), findsNothing);

      // The stepper owns the quantity from here - a tap on the card body adds
      // nothing and opens no sheet (the catalog has no add action left either).
      await tester.tap(find.byType(PromotionListCard));
      await tester.pumpAndSettle();
      expect(find.text('Add'), findsNothing);
      expect(cartCubit.state.items.single.quantity, 1);

      // ...and it is wired straight to the cart.
      await tester.tap(find.byIcon(Icons.add));
      await tester.pumpAndSettle();
      expect(cartCubit.state.items.single.quantity, 2);
    });

    testWidgets('a cart from another warehouse runs the existing conflict confirmation', (
      tester,
    ) async {
      stubOffers([offer(id: 'o1', warehouseId: 'W1')]);
      cartCubit.addProduct(
        const ProductModel(
          id: 'p-other',
          nameAr: 'دواء آخر',
          nameEn: 'Other product',
          manufacturerAr: 'شركة',
          priceUsd: 5,
          discountPriceUsd: 5,
          isAvailable: true,
          hasActiveOffer: false,
        ),
        warehouseId: 'W2',
        warehouseName: 'Warehouse Two',
        quantity: 3,
      );

      await pumpView(tester);
      await tester.tap(find.byType(PromotionListCard));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Add'));
      await tester.pumpAndSettle();

      // The project's own cross-warehouse copy (CatalogView), not a new dialog.
      expect(find.text('Start a new cart?'), findsOneWidget);
      expect(find.textContaining('Warehouse Two'), findsOneWidget);
      // Nothing is touched until it is confirmed.
      expect(cartCubit.state.warehouseId, 'W2');

      await tester.tap(find.text('Start new cart'));
      await tester.pumpAndSettle();

      expect(cartCubit.state.warehouseId, 'W1');
      expect(cartCubit.state.items.single.productId, 'p-o1');
    });

    testWidgets('an unavailable offer is listed, faded, and cannot be added', (tester) async {
      stubOffers([offer(id: 'o1', warehouseId: 'W1', titleEn: 'Offer One', isAvailable: false)]);

      await pumpView(tester);

      expect(find.text('Offer One'), findsOneWidget);
      expect(find.text('Unavailable'), findsOneWidget);
      expect(find.text('Add to cart'), findsNothing);

      await tester.tap(find.byType(PromotionListCard));
      await tester.pumpAndSettle();

      expect(find.text('Add'), findsNothing);
      expect(cartCubit.state.items, isEmpty);
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

  // "Offers" and "Packages" are a plain in-place kind filter on the tab's
  // already-loaded list - neither navigates anywhere, has a cart dependency,
  // or a "no warehouse" gate. (They did briefly for Offers; reverted per an
  // explicit owner request the same day - see promotions_view.dart.)
  group('the kind chips on the Offers & Ads tab', () {
    late PromotionsCubit promotionsCubit;
    late NotificationCubit notificationCubit;

    setUp(() async {
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

    testWidgets('Offers filters the list to offer-kind items only, in place', (tester) async {
      stubOffers([offer(id: 'o1', warehouseId: 'W1', titleEn: 'Offer One')]);

      await pumpTab(tester);
      await tester.tap(find.widgetWithText(ChoiceChip, 'Offers'));
      await tester.pumpAndSettle();

      expect(promotionsCubit.state.kindFilter, PromotionKind.offer);
      // No navigation - still the same tab.
      expect(find.byType(PromotionsView), findsOneWidget);
    });

    testWidgets('Packages still filters the list in place', (tester) async {
      stubOffers([offer(id: 'o1', warehouseId: 'W1', titleEn: 'Offer One')]);

      await pumpTab(tester);
      await tester.tap(find.widgetWithText(ChoiceChip, 'Packages'));
      await tester.pumpAndSettle();

      expect(promotionsCubit.state.kindFilter, PromotionKind.package);
    });
  });
}
