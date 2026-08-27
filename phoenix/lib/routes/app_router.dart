import 'package:flutter/foundation.dart'; // TEMP DIAGNOSTIC (router-lifecycle) - for debugPrint
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:phoenix/core/services/navigation_service.dart';
import 'package:phoenix/features/auth/data/models/registration_draft.dart';
import 'package:phoenix/features/auth/presentation/views/approval_pending_view.dart';
import 'package:phoenix/features/auth/presentation/views/otp_verification_view.dart';
import 'package:phoenix/features/auth/presentation/views/password_login_view.dart';
import 'package:phoenix/features/auth/presentation/views/registration_view.dart';
import 'package:phoenix/features/auth/presentation/views/splash_view.dart';
import 'package:phoenix/features/cart/data/repositories/order_repository.dart';
import 'package:phoenix/features/cart/presentation/views/cart_view.dart';
import 'package:phoenix/features/catalog/data/models/catalog_route_args.dart';
import 'package:phoenix/features/catalog/data/models/manufacturers_route_args.dart';
import 'package:phoenix/features/catalog/data/repositories/catalog_repository.dart';
import 'package:phoenix/features/catalog/presentation/managers/catalog_cubit.dart';
import 'package:phoenix/features/catalog/presentation/managers/manufacturers_cubit.dart';
import 'package:phoenix/features/catalog/presentation/views/catalog_view.dart';
import 'package:phoenix/features/catalog/presentation/views/manufacturers_view.dart';
import 'package:phoenix/features/debts/data/repositories/debt_repository.dart';
import 'package:phoenix/features/debts/presentation/managers/debt_detail_cubit.dart';
import 'package:phoenix/features/debts/presentation/managers/debts_cubit.dart';
import 'package:phoenix/features/debts/presentation/views/debt_detail_view.dart';
import 'package:phoenix/features/my_orders/presentation/managers/my_orders_cubit.dart';
import 'package:phoenix/features/my_orders/presentation/views/my_orders_view.dart';
import 'package:phoenix/features/order_tracking/presentation/managers/order_tracking_cubit.dart';
import 'package:phoenix/features/order_tracking/presentation/views/order_tracking_view.dart';
import 'package:phoenix/features/profile/presentation/views/profile_view.dart';
import 'package:phoenix/features/returns/data/repositories/return_repository.dart';
import 'package:phoenix/features/returns/presentation/managers/my_returns_cubit.dart';
import 'package:phoenix/features/returns/presentation/views/my_returns_view.dart';
import 'package:phoenix/features/reviews/data/repositories/review_repository.dart';
import 'package:phoenix/features/reviews/presentation/managers/pharmacy_reviews_cubit.dart';
import 'package:phoenix/features/warehouse_selection/data/repositories/warehouse_repository.dart';
import 'package:phoenix/features/warehouse_selection/presentation/managers/warehouse_profile_cubit.dart';
import 'package:phoenix/features/warehouse_selection/presentation/views/warehouse_profile_view.dart';
import 'package:phoenix/features/warehouse_selection/presentation/views/warehouse_selection_view.dart';

import 'app_page_transition.dart';
import 'route_names.dart';
import 'route_paths.dart';
import 'scaffold_with_bottom_nav.dart';

class AppRouter {
  AppRouter() {
    // TEMP DIAGNOSTIC (router-lifecycle) - remove after verifying. `router`
    // below is `late final`, so exactly one GoRouter is built per AppRouter
    // instance: this line must appear ONCE for the whole app session and
    // never again on a theme/locale change.
    debugPrint(
      'ROUTER_DEBUG: AppRouter() constructed (#${identityHashCode(this)}) '
      '- GoRouter initialLocation=${RoutePaths.splash}',
    );
  }

  late final GoRouter router = GoRouter(
    navigatorKey: NavigationService.instance.navigatorKey,
    initialLocation: RoutePaths.splash,
    routes: <RouteBase>[
      GoRoute(
        name: RouteNames.splash,
        path: RoutePaths.splash,
        builder: (context, state) => const SplashView(),
      ),
      GoRoute(
        name: RouteNames.registration,
        path: RoutePaths.registration,
        pageBuilder: (context, state) =>
            buildPageTransition(state: state, child: const RegistrationView()),
      ),
      GoRoute(
        name: RouteNames.login,
        path: RoutePaths.login,
        pageBuilder: (context, state) =>
            buildPageTransition(state: state, child: const PasswordLoginView()),
      ),
      GoRoute(
        name: RouteNames.otp,
        path: RoutePaths.otp,
        pageBuilder: (context, state) {
          final draft = state.extra;
          // No draft (e.g. a direct deep link) - send back to the form instead
          // of crashing on a bad cast.
          final child = draft is! RegistrationDraft
              ? const RegistrationView()
              : OtpVerificationView(draft: draft);
          return buildPageTransition(state: state, child: child);
        },
      ),
      GoRoute(
        name: RouteNames.approvalPending,
        path: RoutePaths.approvalPending,
        pageBuilder: (context, state) =>
            buildPageTransition(state: state, child: const ApprovalPendingView()),
      ),
      GoRoute(
        name: RouteNames.warehouseProfile,
        path: RoutePaths.warehouseProfile,
        pageBuilder: (context, state) {
          final warehouseId = state.pathParameters['warehouseId']!;
          final warehouseName = state.extra is String ? state.extra as String : '';
          return buildPageTransition(
            state: state,
            child: BlocProvider(
              create: (context) => WarehouseProfileCubit(
                warehouseRepository: context.read<WarehouseRepository>(),
                warehouseId: warehouseId,
              )..load(),
              child: WarehouseProfileView(warehouseId: warehouseId, warehouseName: warehouseName),
            ),
          );
        },
      ),
      GoRoute(
        name: RouteNames.manufacturers,
        path: RoutePaths.manufacturers,
        pageBuilder: (context, state) {
          final warehouseId = state.pathParameters['warehouseId']!;
          final args = state.extra is ManufacturersRouteArgs
              ? state.extra as ManufacturersRouteArgs
              : const ManufacturersRouteArgs(warehouseName: '');
          return buildPageTransition(
            state: state,
            child: BlocProvider(
              create: (context) => ManufacturersCubit(
                catalogRepository: context.read<CatalogRepository>(),
                warehouseId: warehouseId,
              )..loadManufacturers(),
              child: ManufacturersView(
                warehouseId: warehouseId,
                warehouseName: args.warehouseName,
                autoFilterManufacturer: args.autoFilterManufacturer,
              ),
            ),
          );
        },
      ),
      GoRoute(
        name: RouteNames.catalog,
        path: RoutePaths.catalog,
        pageBuilder: (context, state) {
          final warehouseId = state.pathParameters['warehouseId']!;
          final args = state.extra is CatalogRouteArgs ? state.extra as CatalogRouteArgs : null;
          return buildPageTransition(
            state: state,
            child: BlocProvider(
              create: (context) => CatalogCubit(
                catalogRepository: context.read<CatalogRepository>(),
                warehouseId: warehouseId,
                manufacturer: args?.manufacturer ?? '',
              )..initialize(),
              child: CatalogView(
                warehouseId: warehouseId,
                warehouseName: args?.warehouseName ?? '',
                manufacturer: args?.manufacturer ?? '',
              ),
            ),
          );
        },
      ),
      GoRoute(
        name: RouteNames.cart,
        path: RoutePaths.cart,
        pageBuilder: (context, state) => buildPageTransition(state: state, child: const CartView()),
      ),
      GoRoute(
        name: RouteNames.debtDetail,
        path: RoutePaths.debtDetail,
        pageBuilder: (context, state) {
          final warehouseId = state.pathParameters['warehouseId']!;
          final warehouseName = state.extra is String ? state.extra as String : '';
          return buildPageTransition(
            state: state,
            child: BlocProvider(
              create: (context) => DebtDetailCubit(
                debtRepository: context.read<DebtRepository>(),
                warehouseId: warehouseId,
              )..load(),
              child: DebtDetailView(warehouseName: warehouseName),
            ),
          );
        },
      ),
      GoRoute(
        name: RouteNames.orderTracking,
        path: RoutePaths.orderTracking,
        pageBuilder: (context, state) {
          final orderId = state.pathParameters['orderId']!;
          return buildPageTransition(
            state: state,
            child: BlocProvider(
              create: (context) => OrderTrackingCubit(
                orderRepository: context.read<OrderRepository>(),
                reviewRepository: context.read<ReviewRepository>(),
                warehouseRepository: context.read<WarehouseRepository>(),
                orderId: orderId,
              ),
              child: const OrderTrackingView(),
            ),
          );
        },
      ),
      // Section 6: the four persistent tabs. Each branch keeps its own
      // navigation stack alive (IndexedStack) - switching tabs doesn't rebuild
      // or reload the others. Everything above (catalog/cart/order tracking)
      // stays outside the shell so it pushes full-screen over the nav bar.
      StatefulShellRoute.indexedStack(
        builder: (context, state, navigationShell) =>
            ScaffoldWithBottomNav(navigationShell: navigationShell),
        branches: [
          StatefulShellBranch(
            routes: [
              GoRoute(
                name: RouteNames.warehouseSelection,
                path: RoutePaths.warehouseSelection,
                builder: (context, state) => const WarehouseSelectionView(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                name: RouteNames.myOrders,
                path: RoutePaths.myOrders,
                builder: (context, state) {
                  return BlocProvider(
                    create: (context) =>
                        MyOrdersCubit(orderRepository: context.read<OrderRepository>())..load(),
                    child: const MyOrdersView(),
                  );
                },
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                name: RouteNames.myReturns,
                path: RoutePaths.myReturns,
                builder: (context, state) {
                  return BlocProvider(
                    create: (context) =>
                        MyReturnsCubit(returnRepository: context.read<ReturnRepository>())
                          ..load(),
                    child: const MyReturnsView(),
                  );
                },
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                name: RouteNames.profile,
                path: RoutePaths.profile,
                builder: (context, state) {
                  return MultiBlocProvider(
                    providers: [
                      BlocProvider(
                        create: (context) =>
                            PharmacyReviewsCubit(reviewRepository: context.read<ReviewRepository>())
                              ..load(),
                      ),
                      BlocProvider(
                        create: (context) =>
                            DebtsCubit(debtRepository: context.read<DebtRepository>())..load(),
                      ),
                    ],
                    child: const ProfileView(),
                  );
                },
              ),
            ],
          ),
        ],
      ),
    ],
  );
}
