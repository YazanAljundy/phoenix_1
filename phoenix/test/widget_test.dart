import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:phoenix/core/network/api_client.dart';
import 'package:phoenix/core/services/fcm_service.dart';
import 'package:phoenix/core/services/secure_storage_service.dart';
import 'package:phoenix/core/services/storage_service.dart';
import 'package:phoenix/features/auth/data/repositories/auth_repository_impl.dart';
import 'package:phoenix/features/auth/presentation/views/password_login_view.dart';
import 'package:phoenix/features/auth/presentation/views/splash_view.dart';
import 'package:phoenix/features/banners/data/repositories/banners_repository_impl.dart';
import 'package:phoenix/features/cart/data/repositories/order_repository_impl.dart';
import 'package:phoenix/features/catalog/data/repositories/catalog_repository_impl.dart';
import 'package:phoenix/features/debts/data/repositories/debt_repository_impl.dart';
import 'package:phoenix/features/exchange_rate/data/repositories/exchange_rate_repository_impl.dart';
import 'package:phoenix/features/notifications/data/repositories/notification_repository.dart';
import 'package:phoenix/features/returns/data/repositories/return_repository_impl.dart';
import 'package:phoenix/features/reviews/data/repositories/review_repository_impl.dart';
import 'package:phoenix/features/settings/presentation/managers/settings_cubit.dart';
import 'package:phoenix/features/settings/presentation/managers/settings_state.dart';
import 'package:phoenix/features/warehouse_selection/data/repositories/warehouse_repository_impl.dart';
import 'package:phoenix/main.dart';
import 'package:phoenix/routes/app_router.dart';

Future<AppRouter> _pumpApp(WidgetTester tester) async {
  final storageService = StorageService(await SharedPreferences.getInstance());
  final secureStorage = SecureStorageService();
  final apiClient = ApiClient(secureStorage: secureStorage);
  final authRepository = AuthRepositoryImpl(apiClient: apiClient);
  final warehouseRepository = WarehouseRepositoryImpl(apiClient: apiClient);
  final catalogRepository = CatalogRepositoryImpl(apiClient: apiClient);
  final exchangeRateRepository = ExchangeRateRepositoryImpl(
    apiClient: apiClient,
  );
  final orderRepository = OrderRepositoryImpl(apiClient: apiClient);
  final returnRepository = ReturnRepositoryImpl(apiClient: apiClient);
  final reviewRepository = ReviewRepositoryImpl(apiClient: apiClient);
  final debtRepository = DebtRepositoryImpl(apiClient: apiClient);
  final bannersRepository = BannersRepositoryImpl(apiClient: apiClient);
  final notificationRepository = NotificationRepository(storageService);
  final fcmService = FcmService(
    authRepository: authRepository,
    notificationRepository: notificationRepository,
  );
  final appRouter = AppRouter();

  await tester.pumpWidget(
    MyApp(
      initialState: const SettingsState(),
      storageService: storageService,
      secureStorage: secureStorage,
      authRepository: authRepository,
      warehouseRepository: warehouseRepository,
      catalogRepository: catalogRepository,
      exchangeRateRepository: exchangeRateRepository,
      orderRepository: orderRepository,
      returnRepository: returnRepository,
      reviewRepository: reviewRepository,
      debtRepository: debtRepository,
      bannersRepository: bannersRepository,
      notificationRepository: notificationRepository,
      fcmService: fcmService,
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
}
