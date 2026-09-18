import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:feniq/core/network/api_client.dart';
import 'package:feniq/core/services/app_update_service.dart';
import 'package:feniq/core/services/fcm_service.dart';
import 'package:feniq/core/services/remote_config_service.dart';
import 'package:feniq/core/services/secure_storage_service.dart';
import 'package:feniq/core/services/storage_service.dart';
import 'package:feniq/core/session/session_scope.dart';
import 'package:feniq/features/auth/data/repositories/auth_repository_impl.dart';
import 'package:feniq/features/auth/presentation/views/password_login_view.dart';
import 'package:feniq/features/auth/presentation/views/splash_view.dart';
import 'package:feniq/features/account_history/data/repositories/savings_repository_impl.dart';
import 'package:feniq/features/advertisements/data/repositories/advertisements_repository_impl.dart';
import 'package:feniq/features/banners/data/repositories/banners_repository_impl.dart';
import 'package:feniq/features/cart/data/repositories/order_repository_impl.dart';
import 'package:feniq/features/catalog/data/repositories/catalog_repository_impl.dart';
import 'package:feniq/features/complaints/data/repositories/complaint_repository_impl.dart';
import 'package:feniq/features/debts/data/repositories/debt_repository_impl.dart';
import 'package:feniq/features/exchange_rate/data/models/exchange_rate_model.dart';
import 'package:feniq/features/exchange_rate/data/repositories/exchange_rate_repository.dart';
import 'package:feniq/features/exchange_rate/data/repositories/exchange_rate_repository_impl.dart';
import 'package:feniq/features/notifications/data/repositories/notification_repository.dart';
import 'package:feniq/features/offers/data/repositories/offers_repository_impl.dart';
import 'package:feniq/features/returns/data/repositories/return_repository_impl.dart';
import 'package:feniq/features/reviews/data/repositories/review_repository_impl.dart';
import 'package:feniq/features/settings/presentation/managers/settings_cubit.dart';
import 'package:feniq/features/settings/presentation/managers/settings_state.dart';
import 'package:feniq/features/warehouse_selection/data/repositories/warehouse_repository_impl.dart';
import 'package:feniq/main.dart';
import 'package:feniq/routes/app_router.dart';

class _MockExchangeRateRepository extends Mock implements ExchangeRateRepository {}

Future<AppRouter> _pumpApp(
  WidgetTester tester, {
  ExchangeRateRepository? exchangeRateRepository,
}) async {
  final storageService = StorageService(await SharedPreferences.getInstance());
  final secureStorage = SecureStorageService();
  final apiClient = ApiClient(secureStorage: secureStorage);
  final authRepository = AuthRepositoryImpl(apiClient: apiClient);
  final warehouseRepository = WarehouseRepositoryImpl(apiClient: apiClient);
  final catalogRepository = CatalogRepositoryImpl(apiClient: apiClient);
  final resolvedExchangeRateRepository =
      exchangeRateRepository ?? ExchangeRateRepositoryImpl(apiClient: apiClient);
  final orderRepository = OrderRepositoryImpl(apiClient: apiClient);
  final savingsRepository = SavingsRepositoryImpl(apiClient: apiClient);
  final returnRepository = ReturnRepositoryImpl(apiClient: apiClient);
  final complaintRepository = ComplaintRepositoryImpl(apiClient: apiClient);
  final reviewRepository = ReviewRepositoryImpl(apiClient: apiClient);
  final debtRepository = DebtRepositoryImpl(apiClient: apiClient);
  final bannersRepository = BannersRepositoryImpl(apiClient: apiClient);
  final advertisementsRepository = AdvertisementsRepositoryImpl(apiClient: apiClient);
  final offersRepository = OffersRepositoryImpl(apiClient: apiClient);
  final notificationRepository = NotificationRepository(storageService);
  final sessionScope = SessionScope();
  final fcmService = FcmService(
    authRepository: authRepository,
    notificationRepository: notificationRepository,
    sessionScope: sessionScope,
  );
  // Remote Config is never initialised in the widget test - checkForUpdate()
  // catches the resulting error and returns `none`, so no dialog appears.
  final appRouter = AppRouter();
  final appUpdateService = AppUpdateService(
    remoteConfigService: RemoteConfigService(),
    storageService: storageService,
    currentVersion: '1.0.0',
  );

  await tester.pumpWidget(
    MyApp(
      initialState: const SettingsState(),
      storageService: storageService,
      appUpdateService: appUpdateService,
      secureStorage: secureStorage,
      authRepository: authRepository,
      warehouseRepository: warehouseRepository,
      catalogRepository: catalogRepository,
      exchangeRateRepository: resolvedExchangeRateRepository,
      orderRepository: orderRepository,
      savingsRepository: savingsRepository,
      returnRepository: returnRepository,
      complaintRepository: complaintRepository,
      reviewRepository: reviewRepository,
      debtRepository: debtRepository,
      bannersRepository: bannersRepository,
      advertisementsRepository: advertisementsRepository,
      offersRepository: offersRepository,
      notificationRepository: notificationRepository,
      fcmService: fcmService,
      sessionScope: sessionScope,
      appRouter: appRouter,
    ),
  );

  return appRouter;
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    FlutterSecureStorage.setMockInitialValues({});
  });

  testWidgets('App boots to the splash screen', (tester) async {
    await _pumpApp(tester);
    expect(find.byType(SplashView), findsOneWidget);
  });

  // Regression: a SettingsCubit change (theme / locale) rebuilds
  // MaterialApp.router but must NOT rebuild the GoRouter or reset navigation
  // back to the splash route. See main.dart's `routerConfig: appRouter.router`.
  testWidgets('changing theme keeps the current route (no reset to splash)', (
    tester,
  ) async {
    final appRouter = await _pumpApp(tester);

    // No stored token -> checkSession resolves to unauthenticated -> the
    // splash routes us to the login screen.
    await tester.pumpAndSettle();
    expect(find.byType(PasswordLoginView), findsOneWidget);
    expect(find.byType(SplashView), findsNothing);

    final routerBefore = GoRouter.of(
      tester.element(find.byType(PasswordLoginView)),
    );

    // Flip the theme the same way the Profile screen does.
    final context = tester.element(find.byType(PasswordLoginView));
    await context.read<SettingsCubit>().changeTheme(ThemeMode.dark);
    await tester.pumpAndSettle();

    // Still on login - navigation state survived the rebuild.
    expect(find.byType(PasswordLoginView), findsOneWidget);
    expect(find.byType(SplashView), findsNothing);

    // And it is literally the same GoRouter instance, not a fresh one.
    final routerAfter = GoRouter.of(
      tester.element(find.byType(PasswordLoginView)),
    );
    expect(identical(routerBefore, routerAfter), isTrue);
    expect(identical(appRouter.router, routerAfter), isTrue);
  });

  // ExchangeRateCubit used to own its own AppLifecycleListener; that call now
  // lives in main.dart's single _SessionLifecycleObserver, alongside
  // AuthCubit.revalidateOnResume and NotificationCubit.refresh. This is the
  // end-to-end proof that the OS resume event still reaches the cubit through
  // that shared observer.
  testWidgets('coming back to the foreground re-reads a stale exchange rate through the central observer', (
    tester,
  ) async {
    final rateRepository = _MockExchangeRateRepository();
    when(() => rateRepository.getExchangeRate())
        .thenAnswer((_) async => const ExchangeRateModel(usdToSyp: 12500));

    await _pumpApp(tester, exchangeRateRepository: rateRepository);
    await tester.pumpAndSettle();

    // Nothing has read the rate yet: the app never reached
    // WarehouseSelectionView (no token -> the login screen), so the cubit's
    // state is still at its just-constructed default - stale by definition
    // (no rate, no fetchedAt).
    verifyNever(() => rateRepository.getExchangeRate());

    // The OS transitions of putting the app away and coming back, one step at
    // a time - AppLifecycleListener-derived observers assert on a skipped
    // step, and stepping through them is what the phone actually does.
    final binding = WidgetsBinding.instance;
    for (final state in const [
      AppLifecycleState.inactive,
      AppLifecycleState.hidden,
      AppLifecycleState.paused,
      AppLifecycleState.hidden,
      AppLifecycleState.inactive,
      AppLifecycleState.resumed,
    ]) {
      binding.handleAppLifecycleStateChanged(state);
    }
    await tester.pumpAndSettle();

    verify(() => rateRepository.getExchangeRate()).called(1);
  });

  // A system dialog, the camera, or the task switcher briefly takes focus
  // without the app ever truly leaving the foreground: resumed -> inactive
  // -> resumed, never touching paused. That must NOT be treated as a real
  // return from the background - this is the case the central observer's
  // "only a full round trip" guard exists for.
  testWidgets('a momentary inactive blip that never reaches paused does not trigger a resume refresh', (
    tester,
  ) async {
    final rateRepository = _MockExchangeRateRepository();
    when(() => rateRepository.getExchangeRate())
        .thenAnswer((_) async => const ExchangeRateModel(usdToSyp: 12500));

    await _pumpApp(tester, exchangeRateRepository: rateRepository);
    await tester.pumpAndSettle();

    final binding = WidgetsBinding.instance;
    binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pumpAndSettle();

    verifyNever(() => rateRepository.getExchangeRate());
  });
}
