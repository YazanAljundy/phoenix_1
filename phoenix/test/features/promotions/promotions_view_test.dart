import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:feniq/core/constants/app_colors.dart';
import 'package:feniq/core/services/storage_service.dart';
import 'package:feniq/core/theme/dark_theme.dart';
import 'package:feniq/core/theme/light_theme.dart';
import 'package:feniq/core/widgets/empty_view.dart';
import 'package:feniq/features/advertisements/data/models/advertisement_model.dart';
import 'package:feniq/features/advertisements/data/repositories/advertisements_repository.dart';
import 'package:feniq/features/cart/data/repositories/order_repository.dart';
import 'package:feniq/features/cart/presentation/managers/cart_cubit.dart';
import 'package:feniq/features/exchange_rate/data/models/exchange_rate_model.dart';
import 'package:feniq/features/exchange_rate/data/repositories/exchange_rate_repository.dart';
import 'package:feniq/features/exchange_rate/presentation/managers/exchange_rate_cubit.dart';
import 'package:feniq/features/notifications/data/repositories/notification_repository.dart';
import 'package:feniq/features/notifications/presentation/managers/notification_cubit.dart';
import 'package:feniq/features/offers/data/models/offer_model.dart';
import 'package:feniq/features/offers/data/repositories/offers_repository.dart';
import 'package:feniq/features/promotions/presentation/managers/promotions_cubit.dart';
import 'package:feniq/features/promotions/presentation/views/promotions_view.dart';
import 'package:feniq/features/promotions/presentation/widgets/promotion_card_parts.dart';
import 'package:feniq/features/promotions/presentation/widgets/promotion_hero_card.dart';
import 'package:feniq/features/promotions/presentation/widgets/promotions_hero_carousel.dart';
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

// Where a tapped offer is meant to land: the offers of that offer's own
// warehouse (WarehouseOffersView), not the manufacturer catalog directly.
String? openedWarehouseId;
String? openedWarehouseName;

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late _MockOffersRepository offersRepository;
  late _MockAdvertisementsRepository advertisementsRepository;
  late _MockOrderRepository orderRepository;
  late _MockWarehouseRepository warehouseRepository;
  late _MockExchangeRateRepository exchangeRateRepository;
  late CartCubit cartCubit;
  late NotificationCubit notificationCubit;
  late ExchangeRateCubit exchangeRateCubit;
  late PromotionsCubit promotionsCubit;

  setUp(() async {
    openedWarehouseId = null;
    openedWarehouseName = null;

    SharedPreferences.setMockInitialValues({});
    offersRepository = _MockOffersRepository();
    advertisementsRepository = _MockAdvertisementsRepository();
    orderRepository = _MockOrderRepository();
    warehouseRepository = _MockWarehouseRepository();
    exchangeRateRepository = _MockExchangeRateRepository();

    when(() => exchangeRateRepository.getExchangeRate())
        .thenAnswer((_) async => ExchangeRateModel(usdToSyp: 15000));

    cartCubit = CartCubit(
      orderRepository: orderRepository,
      warehouseRepository: warehouseRepository,
    );
    notificationCubit = NotificationCubit(
      repository: NotificationRepository(
        StorageService(await SharedPreferences.getInstance()),
      ),
    );
    exchangeRateCubit = ExchangeRateCubit(exchangeRateRepository: exchangeRateRepository);
    promotionsCubit = PromotionsCubit(
      offersRepository: offersRepository,
      advertisementsRepository: advertisementsRepository,
    );
  });

  tearDown(() async {
    await promotionsCubit.close();
    await cartCubit.close();
    await notificationCubit.close();
    await exchangeRateCubit.close();
  });

  void stub({
    List<OfferModel> offers = const [],
    List<AdvertisementModel> advertisements = const [],
  }) {
    when(() => offersRepository.getActiveOffers()).thenAnswer((_) async => offers);
    when(() => advertisementsRepository.getActiveAdvertisements())
        .thenAnswer((_) async => advertisements);
  }

  Future<void> pumpView(
    WidgetTester tester, {
    ThemeMode themeMode = ThemeMode.light,
    Locale? locale,
  }) async {
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
            openedWarehouseName = state.extra as String?;
            return Scaffold(body: Text('WAREHOUSE OFFERS ${state.extra}'));
          },
        ),
        GoRoute(
          name: RouteNames.cart,
          path: RoutePaths.cart,
          builder: (context, state) => const Scaffold(body: Text('CART')),
        ),
        GoRoute(
          name: RouteNames.notifications,
          path: RoutePaths.notifications,
          builder: (context, state) => const Scaffold(body: Text('NOTIFICATIONS')),
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
            theme: LightTheme.data,
            darkTheme: DarkTheme.data,
            themeMode: themeMode,
            locale: locale,
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  group('the hero carousel', () {
    testWidgets('renders one card per featured promotion', (tester) async {
      stub(
        offers: [
          offer(id: 'o1', titleEn: 'Offer One', discountPercentage: 40),
          offer(id: 'o2', titleEn: 'Offer Two', discountPercentage: 30),
        ],
        advertisements: [advertisement(id: 'a1', titleEn: 'Package One', savingPercentage: 35)],
      );

      await pumpView(tester);

      final carousel = find.byType(PromotionsHeroCarousel);
      expect(carousel, findsOneWidget);
      expect(tester.widget<PromotionsHeroCarousel>(carousel).promotions, hasLength(3));
      // PageView only builds the visible page (plus its neighbour), so the
      // count is asserted on the strip's own contents; which one is on screen
      // is what the swipe test below covers.
      expect(find.byType(PromotionHeroCard), findsWidgets);
    });

    testWidgets('caps the strip even when far more is running', (tester) async {
      stub(offers: [for (var i = 0; i < 9; i++) offer(id: 'o$i', discountPercentage: 40 - i)]);

      await pumpView(tester);

      final carousel = tester.widget<PromotionsHeroCarousel>(
        find.byType(PromotionsHeroCarousel),
      );
      expect(carousel.promotions, hasLength(5));
    });

    testWidgets('swiping moves to the next card', (tester) async {
      stub(
        offers: [
          offer(id: 'o1', titleEn: 'Offer One', discountPercentage: 40),
          offer(id: 'o2', titleEn: 'Offer Two', discountPercentage: 30),
        ],
      );

      await pumpView(tester);

      // The hero shows the first card; the second is only a sliver away, so
      // the list heading below is what distinguishes "on screen" reliably -
      // assert on the PageView's own page instead.
      final pageView = find.descendant(
        of: find.byType(PromotionsHeroCarousel),
        matching: find.byType(PageView),
      );
      expect(pageView, findsOneWidget);
      final controller = tester.widget<PageView>(pageView).controller!;
      expect(controller.page?.round(), 0);

      await tester.drag(pageView, const Offset(-400, 0));
      await tester.pumpAndSettle();

      expect(controller.page?.round(), 1);
    });
  });

  group('the browsable list', () {
    testWidgets('lists everything running, not just the featured slice', (tester) async {
      stub(
        offers: [for (var i = 0; i < 7; i++) offer(id: 'o$i', titleEn: 'Offer $i')],
      );

      await pumpView(tester);
      // The screen holds three scrollables (the filter row, the carousel and
      // the page itself); this names the page's own.
      await tester.scrollUntilVisible(
        find.text('Offer 6'),
        200,
        scrollable: find
            .descendant(of: find.byType(CustomScrollView), matching: find.byType(Scrollable))
            .first,
      );

      expect(find.text('Offer 6'), findsOneWidget);
    });

    testWidgets('a type filter narrows it to that kind only', (tester) async {
      stub(
        offers: [offer(id: 'o1', titleEn: 'Offer One')],
        advertisements: [advertisement(id: 'a1', titleEn: 'Package One')],
      );

      await pumpView(tester);
      expect(find.text('Offer One'), findsWidgets);
      expect(find.text('Package One'), findsWidgets);

      await tester.tap(find.widgetWithText(ChoiceChip, 'Packages'));
      await tester.pumpAndSettle();

      expect(find.text('Offer One'), findsNothing);
      expect(find.text('Package One'), findsWidgets);
    });

    testWidgets('a warehouse filter narrows it to that warehouse only', (tester) async {
      stub(
        offers: [
          offer(id: 'o1', warehouseId: 'W1', warehouseNameEn: 'Alpha', titleEn: 'Offer One'),
          offer(id: 'o2', warehouseId: 'W2', warehouseNameEn: 'Beta', titleEn: 'Offer Two'),
        ],
      );

      await pumpView(tester);
      expect(find.text('Offer Two'), findsWidgets);

      await tester.tap(find.widgetWithText(ActionChip, 'All warehouses'));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(ListTile, 'Alpha'));
      await tester.pumpAndSettle();

      expect(find.text('Offer One'), findsWidgets);
      expect(find.text('Offer Two'), findsNothing);
    });

    testWidgets('a filter that matches nothing offers a way back', (tester) async {
      stub(offers: [offer(id: 'o1', titleEn: 'Offer One')]);

      await pumpView(tester);
      await tester.tap(find.widgetWithText(ChoiceChip, 'Packages'));
      await tester.pumpAndSettle();

      expect(find.text('Nothing matches these filters.'), findsOneWidget);
      expect(find.byType(PromotionHeroCard), findsNothing);

      await tester.tap(find.text('Clear filters'));
      await tester.pumpAndSettle();

      expect(find.text('Offer One'), findsWidgets);
    });
  });

  group('empty and error states', () {
    testWidgets('nothing running shows the calm empty state, not an error', (tester) async {
      stub();

      await pumpView(tester);

      expect(find.byType(EmptyView), findsOneWidget);
      expect(find.text('Nothing on offer right now'), findsOneWidget);
      expect(
        find.text('Offers and packages from your warehouses will show up here.'),
        findsOneWidget,
      );
      expect(find.byType(PromotionsHeroCarousel), findsNothing);
    });

    testWidgets('the app bar reports how much is running', (tester) async {
      stub(offers: [offer(id: 'o1'), offer(id: 'o2')]);

      await pumpView(tester);

      expect(find.text('Offers & Ads'), findsOneWidget);
      expect(find.text('2 running now'), findsOneWidget);
    });
  });

  group('tapping through', () {
    testWidgets('an offer opens the offers of its own warehouse, not the cart\'s', (tester) async {
      stub(
        offers: [
          offer(
            id: 'o1',
            titleEn: 'Offer One',
            warehouseId: 'W-42',
            warehouseNameEn: 'Warehouse 42',
          ),
        ],
      );

      await pumpView(tester);
      await tester.tap(find.byType(PromotionHeroCard).first);
      await tester.pumpAndSettle();

      expect(find.text('WAREHOUSE OFFERS Warehouse 42'), findsOneWidget);
      expect(openedWarehouseId, 'W-42');
      expect(openedWarehouseName, 'Warehouse 42');
    });

    testWidgets('a package goes through the shared package -> cart flow', (tester) async {
      stub(advertisements: [advertisement(id: 'a1', titleEn: 'Package One')]);
      // The launcher re-fetches the package on tap before it can reach the
      // cart - that re-fetch is the assertion here.
      when(() => advertisementsRepository.prepareAdvertisementCart(any()))
          .thenAnswer((_) async => throw Exception('not exercised past the re-fetch'));

      await pumpView(tester);
      await tester.tap(find.byType(PromotionHeroCard).first);
      await tester.pumpAndSettle();

      verify(() => advertisementsRepository.prepareAdvertisementCart('a1')).called(1);
    });
  });

  // Every surface and every piece of type on this screen comes from the app's
  // own theme tokens, so the same widgets have to read correctly under both
  // themes without a second code path.
  group('light and dark', () {
    Future<Color?> cardSurface(WidgetTester tester) async {
      final container = tester.widget<Container>(
        find
            .descendant(of: find.byType(PromotionSurface), matching: find.byType(Container))
            .first,
      );
      return (container.decoration as BoxDecoration?)?.color;
    }

    testWidgets('cards sit on the light elevated surface in light mode', (tester) async {
      stub(offers: [offer(id: 'o1', titleEn: 'Offer One')]);

      await pumpView(tester);

      expect(await cardSurface(tester), AppColors.lightSurfaceElevated);
      expect(tester.takeException(), isNull);
    });

    testWidgets('cards sit on the dark elevated surface in dark mode', (tester) async {
      stub(offers: [offer(id: 'o1', titleEn: 'Offer One')]);

      await pumpView(tester, themeMode: ThemeMode.dark);

      expect(await cardSurface(tester), AppColors.darkSurfaceElevated);
      expect(tester.takeException(), isNull);
    });

    testWidgets('the empty state renders in dark mode too', (tester) async {
      stub();

      await pumpView(tester, themeMode: ThemeMode.dark);

      expect(find.byType(EmptyView), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  // The default test surface is a wide 800x600; a real phone is far narrower,
  // and Arabic is both longer and right-to-left. A RenderFlex overflow surfaces
  // as a test exception, so these pin that the cards fit where they actually
  // have to fit.
  group('narrow screens and RTL', () {
    setUp(() {
      stub(
        offers: [
          offer(
            id: 'o1',
            titleEn: 'A deliberately long winter promotion title',
            warehouseNameEn: 'Al Noor Pharmaceutical Warehouse',
            discountPercentage: 35,
          ),
        ],
        advertisements: [
          advertisement(id: 'a1', titleEn: 'A long family package title', savingPercentage: 30),
        ],
      );
    });

    for (final themeMode in [ThemeMode.light, ThemeMode.dark]) {
      testWidgets('fits a 390pt phone in ${themeMode.name} mode', (tester) async {
        tester.view.physicalSize = const Size(390, 844);
        tester.view.devicePixelRatio = 1.0;
        addTearDown(tester.view.reset);

        await pumpView(tester, themeMode: themeMode);

        expect(find.byType(PromotionHeroCard), findsWidgets);
        expect(tester.takeException(), isNull);
      });

      testWidgets('fits a 390pt phone in Arabic, ${themeMode.name} mode', (tester) async {
        tester.view.physicalSize = const Size(390, 844);
        tester.view.devicePixelRatio = 1.0;
        addTearDown(tester.view.reset);

        await pumpView(tester, themeMode: themeMode, locale: const Locale('ar'));

        expect(find.text('العروض والإعلانات'), findsOneWidget);
        expect(find.byType(PromotionHeroCard), findsWidgets);
        expect(tester.takeException(), isNull);
      });
    }
  });
}
