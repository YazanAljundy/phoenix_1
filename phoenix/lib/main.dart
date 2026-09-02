import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:phoenix/core/network/api_client.dart';
import 'package:phoenix/core/services/app_update_service.dart';
import 'package:phoenix/core/services/fcm_service.dart';
import 'package:phoenix/core/services/remote_config_service.dart';
import 'package:phoenix/core/services/secure_storage_service.dart';
import 'package:phoenix/core/services/storage_service.dart';
import 'package:phoenix/features/app_update/presentation/app_update_gate.dart';
import 'package:phoenix/firebase_options.dart';
import 'package:phoenix/core/theme/dark_theme.dart';
import 'package:phoenix/core/theme/light_theme.dart';
import 'package:phoenix/features/auth/data/repositories/auth_repository_impl.dart';
import 'package:phoenix/features/auth/presentation/managers/auth_cubit.dart';
import 'package:phoenix/features/banners/data/repositories/banners_repository.dart';
import 'package:phoenix/features/banners/data/repositories/banners_repository_impl.dart';
import 'package:phoenix/features/banners/presentation/managers/banners_cubit.dart';
import 'package:phoenix/features/cart/data/repositories/order_repository.dart';
import 'package:phoenix/features/cart/data/repositories/order_repository_impl.dart';
import 'package:phoenix/features/cart/presentation/managers/cart_cubit.dart';
import 'package:phoenix/features/catalog/data/repositories/catalog_repository.dart';
import 'package:phoenix/features/catalog/data/repositories/catalog_repository_impl.dart';
import 'package:phoenix/features/complaints/data/repositories/complaint_repository.dart';
import 'package:phoenix/features/complaints/data/repositories/complaint_repository_impl.dart';
import 'package:phoenix/features/debts/data/repositories/debt_repository.dart';
import 'package:phoenix/features/debts/data/repositories/debt_repository_impl.dart';
import 'package:phoenix/features/exchange_rate/data/repositories/exchange_rate_repository.dart';
import 'package:phoenix/features/exchange_rate/data/repositories/exchange_rate_repository_impl.dart';
import 'package:phoenix/features/exchange_rate/presentation/managers/exchange_rate_cubit.dart';
import 'package:phoenix/features/notifications/data/repositories/notification_repository.dart';
import 'package:phoenix/features/notifications/presentation/managers/notification_cubit.dart';
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
import 'package:phoenix/routes/route_paths.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
  // TEMP DIAGNOSTIC LOG (see FCM_DEBUG task).
  debugPrint('FCM_DEBUG: Firebase.initializeApp() succeeded');
  // Must be registered before any background/terminated message can be
  // received at all - see the handler's own doc comment in fcm_service.dart.
  FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);

  final prefs = await SharedPreferences.getInstance();
  final storageService = StorageService(prefs);

  final initialState = await _loadInitialSettings(storageService);

  // Update checker (Firebase Remote Config). initialize() only sets config +
  // defaults and activates already-fetched values - it never blocks startup
  // and never hits the network; the once-a-day fetch happens later, inside
  // AppUpdateGate, behind AppUpdateService's own 24h gate.
  final remoteConfigService = RemoteConfigService();
  await remoteConfigService.initialize();
  final appUpdateService = AppUpdateService(
    remoteConfigService: remoteConfigService,
    storageService: storageService,
    currentVersion: await _currentAppVersion(),
  );

  final secureStorage = SecureStorageService();
  final apiClient = ApiClient(secureStorage: secureStorage);
  final authRepository = AuthRepositoryImpl(apiClient: apiClient);
  final notificationRepository = NotificationRepository(storageService);
  final fcmService = FcmService(
    authRepository: authRepository,
    notificationRepository: notificationRepository,
  );
  final warehouseRepository = WarehouseRepositoryImpl(apiClient: apiClient);
  final catalogRepository = CatalogRepositoryImpl(apiClient: apiClient);
  final exchangeRateRepository = ExchangeRateRepositoryImpl(
    apiClient: apiClient,
  );
  final orderRepository = OrderRepositoryImpl(apiClient: apiClient);
  final returnRepository = ReturnRepositoryImpl(apiClient: apiClient);
  final complaintRepository = ComplaintRepositoryImpl(apiClient: apiClient);
  final reviewRepository = ReviewRepositoryImpl(apiClient: apiClient);
  final debtRepository = DebtRepositoryImpl(apiClient: apiClient);
  final bannersRepository = BannersRepositoryImpl(apiClient: apiClient);
  final appRouter = AppRouter();
  runApp(
    MyApp(
      initialState: initialState,
      storageService: storageService,
      appUpdateService: appUpdateService,
      secureStorage: secureStorage,
      authRepository: authRepository,
      warehouseRepository: warehouseRepository,
      catalogRepository: catalogRepository,
      exchangeRateRepository: exchangeRateRepository,
      orderRepository: orderRepository,
      returnRepository: returnRepository,
      complaintRepository: complaintRepository,
      reviewRepository: reviewRepository,
      debtRepository: debtRepository,
      bannersRepository: bannersRepository,
      notificationRepository: notificationRepository,
      fcmService: fcmService,
      appRouter: appRouter,
    ),
  );
}

// The installed app version ("1.0.0"), build metadata dropped. Guarded so a
// platform-channel failure here can never stop Phoenix from starting - an
// empty string just means the update checker does nothing.
Future<String> _currentAppVersion() async {
  try {
    return (await PackageInfo.fromPlatform()).version;
  } catch (_) {
    return '';
  }
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
    required this.appUpdateService,
    required this.secureStorage,
    required this.authRepository,
    required this.warehouseRepository,
    required this.catalogRepository,
    required this.exchangeRateRepository,
    required this.orderRepository,
    required this.returnRepository,
    required this.complaintRepository,
    required this.reviewRepository,
    required this.debtRepository,
    required this.bannersRepository,
    required this.notificationRepository,
    required this.fcmService,
    required this.appRouter,
    super.key,
  });

  final SettingsState initialState;
  final StorageService storageService;
  final AppUpdateService appUpdateService;
  final SecureStorageService secureStorage;
  final AuthRepositoryImpl authRepository;
  final WarehouseRepositoryImpl warehouseRepository;
  final CatalogRepositoryImpl catalogRepository;
  final ExchangeRateRepositoryImpl exchangeRateRepository;
  final OrderRepositoryImpl orderRepository;
  final ReturnRepositoryImpl returnRepository;
  final ComplaintRepositoryImpl complaintRepository;
  final ReviewRepositoryImpl reviewRepository;
  final DebtRepositoryImpl debtRepository;
  final BannersRepositoryImpl bannersRepository;
  final NotificationRepository notificationRepository;
  final FcmService fcmService;
  final AppRouter appRouter;
  @override
  Widget build(BuildContext context) {
    return MultiRepositoryProvider(
      providers: [
        RepositoryProvider<CatalogRepository>.value(value: catalogRepository),
        RepositoryProvider<OrderRepository>.value(value: orderRepository),
        RepositoryProvider<ReturnRepository>.value(value: returnRepository),
        RepositoryProvider<ComplaintRepository>.value(
          value: complaintRepository,
        ),
        RepositoryProvider<ReviewRepository>.value(value: reviewRepository),
        RepositoryProvider<WarehouseRepository>.value(
          value: warehouseRepository,
        ),
        RepositoryProvider<ExchangeRateRepository>.value(
          value: exchangeRateRepository,
        ),
        RepositoryProvider<DebtRepository>.value(value: debtRepository),
        RepositoryProvider<BannersRepository>.value(value: bannersRepository),
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
              fcmService: fcmService,
            ),
          ),
          BlocProvider(
            create: (context) => WarehouseSelectionCubit(
              warehouseRepository: warehouseRepository,
            ),
          ),
          BlocProvider(
            create: (context) => CartCubit(
              orderRepository: orderRepository,
              warehouseRepository: warehouseRepository,
            ),
          ),
          BlocProvider(
            create: (context) => ExchangeRateCubit(
              exchangeRateRepository: exchangeRateRepository,
            ),
          ),
          BlocProvider(
            create: (context) =>
                BannersCubit(bannersRepository: bannersRepository),
          ),
          BlocProvider(
            create: (context) =>
                NotificationCubit(repository: notificationRepository),
          ),
        ],
        // Audit P5: revalidate the session when the app is brought back to
        // the foreground after being backgrounded. Placed inside the provider
        // scope so it can reach AuthCubit; throttling + "only when it matters"
        // logic lives in AuthCubit.revalidateOnResume.
        child: _SessionLifecycleObserver(
          child: AppUpdateGate(
            service: appUpdateService,
            isAppShellReady: () {
              try {
                return appRouter
                        .router.routerDelegate.currentConfiguration.uri.path !=
                    RoutePaths.splash;
              } catch (_) {
                return true;
              }
            },
            child: Builder(
              builder: (context) => BlocBuilder<SettingsCubit, SettingsState>(
                builder: (context, state) {
                  // TEMP DIAGNOSTIC (router-lifecycle) - remove after verifying.
                  debugPrint(
                    'ROUTER_DEBUG: MyApp build/rebuild - '
                    'locale=${state.locale?.languageCode ?? 'null'} '
                    'themeMode=${state.themeMode.name} '
                    'router=#${identityHashCode(appRouter.router)}',
                  );
                  return MaterialApp.router(
                    themeMode: state.themeMode,
                    darkTheme: DarkTheme.data,
                    // Stable instance created once in main() - NOT `AppRouter().router`,
                    // which builds a brand-new GoRouter (resetting navigation to the
                    // splash route) on every SettingsCubit rebuild.
                    routerConfig: appRouter.router,
                    debugShowCheckedModeBanner: false,
                    theme: LightTheme.data,
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
        ),
      ),
    );
  }
}

// Watches the OS app-lifecycle and asks AuthCubit to re-check the session
// when the app returns from the background (audit P5). Only a full
// paused -> resumed transition counts, so a brief permission dialog / camera
// / app-switcher glance does not trigger a network call; AuthCubit adds a
// time-based throttle and never signs the user out on a resume network
// failure.
class _SessionLifecycleObserver extends StatefulWidget {
  const _SessionLifecycleObserver({required this.child});

  final Widget child;

  @override
  State<_SessionLifecycleObserver> createState() =>
      _SessionLifecycleObserverState();
}

class _SessionLifecycleObserverState extends State<_SessionLifecycleObserver>
    with WidgetsBindingObserver {
  AppLifecycleState? _previous;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed &&
        _previous == AppLifecycleState.paused) {
      context.read<AuthCubit>().revalidateOnResume();
      // Pick up any notification the FCM background isolate saved while the
      // app was away, so the badge is right the moment the user is back.
      context.read<NotificationCubit>().refresh();
    }
    _previous = state;
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
