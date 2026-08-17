import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:phoenix/core/network/api_client.dart';
import 'package:phoenix/core/services/secure_storage_service.dart';
import 'package:phoenix/core/services/storage_service.dart';
import 'package:phoenix/core/theme/dark_theme.dart';
import 'package:phoenix/features/auth/data/repositories/auth_repository_impl.dart';
import 'package:phoenix/features/auth/presentation/managers/auth_cubit.dart';
import 'package:phoenix/features/cart/data/repositories/order_repository.dart';
import 'package:phoenix/features/cart/data/repositories/order_repository_impl.dart';
import 'package:phoenix/features/cart/presentation/managers/cart_cubit.dart';
import 'package:phoenix/features/catalog/data/repositories/catalog_repository.dart';
import 'package:phoenix/features/catalog/data/repositories/catalog_repository_impl.dart';
import 'package:phoenix/features/exchange_rate/data/repositories/exchange_rate_repository.dart';
import 'package:phoenix/features/exchange_rate/data/repositories/exchange_rate_repository_impl.dart';
import 'package:phoenix/features/exchange_rate/presentation/managers/exchange_rate_cubit.dart';
import 'package:phoenix/features/returns/data/repositories/return_repository.dart';
import 'package:phoenix/features/returns/data/repositories/return_repository_impl.dart';
import 'package:phoenix/features/reviews/data/repositories/review_repository.dart';
import 'package:phoenix/features/reviews/data/repositories/review_repository_impl.dart';
import 'package:phoenix/features/settings/presentation/managers/settings_cubit.dart';
import 'package:phoenix/features/settings/presentation/managers/settings_state.dart';
import 'package:phoenix/features/warehouse_selection/data/repositories/warehouse_repository.dart';
import 'package:phoenix/features/warehouse_selection/data/repositories/warehouse_repository_impl.dart';
import 'package:phoenix/features/warehouse_selection/presentation/managers/warehouse_selection_cubit.dart';
import 'package:phoenix/generated/app_localizations.dart';
import 'package:phoenix/routes/app_router.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  final prefs = await SharedPreferences.getInstance();
  final storageService = StorageService(prefs);

  final initialState = await _loadInitialSettings(storageService);

  final secureStorage = SecureStorageService();
  final apiClient = ApiClient(secureStorage: secureStorage);
  final authRepository = AuthRepositoryImpl(apiClient: apiClient);
  final warehouseRepository = WarehouseRepositoryImpl(apiClient: apiClient);
  final catalogRepository = CatalogRepositoryImpl(apiClient: apiClient);
  final exchangeRateRepository = ExchangeRateRepositoryImpl(apiClient: apiClient);
  final orderRepository = OrderRepositoryImpl(apiClient: apiClient);
  final returnRepository = ReturnRepositoryImpl(apiClient: apiClient);
  final reviewRepository = ReviewRepositoryImpl(apiClient: apiClient);

  runApp(
    MyApp(
      initialState: initialState,
      storageService: storageService,
      secureStorage: secureStorage,
      authRepository: authRepository,
      warehouseRepository: warehouseRepository,
      catalogRepository: catalogRepository,
      exchangeRateRepository: exchangeRateRepository,
      orderRepository: orderRepository,
      returnRepository: returnRepository,
      reviewRepository: reviewRepository,
    ),
  );
}

Future<SettingsState> _loadInitialSettings(
  StorageService storageService,
) async {
  const defaultThemeMode = ThemeMode.system;
  final storedTheme = storageService.getString('settings.theme_mode');
  final storedLocale = storageService.getString('settings.locale');

  ThemeMode themeMode = defaultThemeMode;
  if (storedTheme != null) {
    switch (storedTheme) {
      case 'light':
        themeMode = ThemeMode.light;
        break;
      case 'dark':
        themeMode = ThemeMode.dark;
        break;
      case 'system':
      default:
        themeMode = ThemeMode.system;
        break;
    }
  }

  final locale = storedLocale != null && storedLocale.isNotEmpty
      ? Locale(storedLocale)
      : null;

  return SettingsState(themeMode: themeMode, locale: locale);
}

class MyApp extends StatelessWidget {
  const MyApp({
    required this.initialState,
    required this.storageService,
    required this.secureStorage,
    required this.authRepository,
    required this.warehouseRepository,
    required this.catalogRepository,
    required this.exchangeRateRepository,
    required this.orderRepository,
    required this.returnRepository,
    required this.reviewRepository,
    super.key,
  });

  final SettingsState initialState;
  final StorageService storageService;
  final SecureStorageService secureStorage;
  final AuthRepositoryImpl authRepository;
  final WarehouseRepositoryImpl warehouseRepository;
  final CatalogRepositoryImpl catalogRepository;
  final ExchangeRateRepositoryImpl exchangeRateRepository;
  final OrderRepositoryImpl orderRepository;
  final ReturnRepositoryImpl returnRepository;
  final ReviewRepositoryImpl reviewRepository;

  @override
  Widget build(BuildContext context) {
    return MultiRepositoryProvider(
      providers: [
        RepositoryProvider<CatalogRepository>.value(value: catalogRepository),
        RepositoryProvider<OrderRepository>.value(value: orderRepository),
        RepositoryProvider<ReturnRepository>.value(value: returnRepository),
        RepositoryProvider<ReviewRepository>.value(value: reviewRepository),
        RepositoryProvider<WarehouseRepository>.value(value: warehouseRepository),
        RepositoryProvider<ExchangeRateRepository>.value(value: exchangeRateRepository),
      ],
      child: MultiBlocProvider(
        providers: [
          BlocProvider(
            create: (context) => SettingsCubit(
              storageService: storageService,
              initialState: initialState,
            ),
          ),
          BlocProvider(
            create: (context) => AuthCubit(
              authRepository: authRepository,
              secureStorage: secureStorage,
            ),
          ),
          BlocProvider(
            create: (context) => WarehouseSelectionCubit(
              warehouseRepository: warehouseRepository,
            ),
          ),
          BlocProvider(
            create: (context) => CartCubit(orderRepository: orderRepository),
          ),
          BlocProvider(
            create: (context) =>
                ExchangeRateCubit(exchangeRateRepository: exchangeRateRepository),
          ),
        ],
        child: Builder(
          builder: (context) => BlocBuilder<SettingsCubit, SettingsState>(
            builder: (context, state) {
              return MaterialApp.router(
                themeMode: state.themeMode,
                darkTheme: DarkTheme.data,
                routerConfig: AppRouter().router,
                debugShowCheckedModeBanner: false,
                theme: ThemeData(fontFamily: 'Inter'),
                locale: state.locale,
                localizationsDelegates: const [
                  AppLocalizations.delegate,
                  GlobalMaterialLocalizations.delegate,
                  GlobalWidgetsLocalizations.delegate,
                  GlobalCupertinoLocalizations.delegate,
                ],
                supportedLocales: AppLocalizations.supportedLocales,
              );
            },
          ),
        ),
      ),
    );
  }
}
