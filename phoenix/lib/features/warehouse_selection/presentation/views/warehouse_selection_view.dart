import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_padding.dart';
import 'package:phoenix/core/constants/app_radius.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/widgets/app_loading.dart';
import 'package:phoenix/core/widgets/empty_view.dart';
import 'package:phoenix/core/error/error_translator.dart';
import 'package:phoenix/core/widgets/failure_widget.dart';
import 'package:phoenix/features/auth/presentation/managers/auth_cubit.dart';
import 'package:phoenix/features/banners/data/models/banner_model.dart';
import 'package:phoenix/features/banners/presentation/managers/banners_cubit.dart';
import 'package:phoenix/features/banners/presentation/widgets/banner_slider.dart';
import 'package:phoenix/features/cart/presentation/widgets/cart_button.dart';
import 'package:phoenix/features/catalog/data/models/manufacturers_route_args.dart';
import 'package:phoenix/features/exchange_rate/presentation/managers/exchange_rate_cubit.dart';
import 'package:phoenix/features/notifications/presentation/widgets/notification_button.dart';
import 'package:phoenix/features/warehouse_selection/data/models/warehouse_model.dart';
import 'package:phoenix/features/warehouse_selection/presentation/managers/warehouse_selection_cubit.dart';
import 'package:phoenix/features/warehouse_selection/presentation/managers/warehouse_selection_state.dart';
import 'package:phoenix/features/warehouse_selection/presentation/widgets/warehouse_card.dart';
import 'package:phoenix/routes/route_names.dart';

class WarehouseSelectionView extends StatefulWidget {
  const WarehouseSelectionView({super.key});

  @override
  State<WarehouseSelectionView> createState() => _WarehouseSelectionViewState();
}

class _WarehouseSelectionViewState extends State<WarehouseSelectionView> {
  final _searchController = TextEditingController();
  String _query = '';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      // The one guaranteed post-auth landing screen (splash / login / register
      // / approval-pending all navigate here). Tells the auth layer the shell
      // is up so a cold-start FCM notification deep link can be processed now
      // rather than racing the splash navigation (audit P7).
      context.read<AuthCubit>().notifyAppShellReady();
      context.read<WarehouseSelectionCubit>().loadWarehouses();
      // This screen is the one guaranteed landing point after every
      // successful auth path (splash/login/register/approval-pending all
      // navigate here) - fetching the session-wide exchange rate here once,
      // rather than in each of those views, satisfies "once per app
      // session, not per screen" (see exchange_rate_cubit.dart) without
      // duplicating the call site.
      context.read<ExchangeRateCubit>().load();
      // Fetched once here, same "screen open" trigger as everything else
      // above - no pull-to-refresh/polling for banners (see BannersCubit).
      context.read<BannersCubit>().load();
    });
    _searchController.addListener(() {
      setState(() => _query = _searchController.text.trim());
    });
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  // Client-side only - the already-fetched list is small (a handful of
  // warehouses), so filtering it here avoids a round trip and any change to
  // WarehouseRepository/the API for what's fundamentally a local, instant
  // filter.
  List<WarehouseModel> _filtered(List<WarehouseModel> warehouses) {
    if (_query.isEmpty) return warehouses;
    final query = _query.toLowerCase();
    return warehouses.where((w) {
      return w.nameAr.toLowerCase().contains(query) ||
          w.nameEn.toLowerCase().contains(query) ||
          w.city.toLowerCase().contains(query);
    }).toList();
  }

  void _handleSelect(WarehouseModel warehouse) {
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';
    final name = isArabic ? warehouse.nameAr : warehouse.nameEn;
    context.pushNamed(
      RouteNames.manufacturers,
      pathParameters: {'warehouseId': warehouse.id},
      extra: ManufacturersRouteArgs(warehouseName: name),
    );
  }

  // Section: banners - a tapped banner with a linked product jumps straight
  // to that manufacturer's catalog, skipping the manual tap-through.
  void _handleBannerTap(BannerModel banner) {
    if (!banner.isTappable) return;
    context.pushNamed(
      RouteNames.manufacturers,
      pathParameters: {'warehouseId': banner.warehouseId!},
      extra: ManufacturersRouteArgs(
        warehouseName: '',
        autoFilterManufacturer: banner.manufacturerAr,
      ),
    );
  }

  // Section 17: a separate entry point from tapping the card - opens the
  // read-only profile instead of continuing straight to /manufacturers.
  void _handleViewProfile(WarehouseModel warehouse) {
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';
    final name = isArabic ? warehouse.nameAr : warehouse.nameEn;
    context.pushNamed(
      RouteNames.warehouseProfile,
      pathParameters: {'warehouseId': warehouse.id},
      extra: name,
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return Scaffold(
      body: RefreshIndicator(
        onRefresh: () =>
            context.read<WarehouseSelectionCubit>().loadWarehouses(),
        child: CustomScrollView(
          slivers: [
            SliverAppBar(
              floating: true,
              snap: true,
              elevation: 0,
              backgroundColor: AppColors.navyOf(context),
              foregroundColor: Colors.white,
              toolbarHeight: 68,
              leading: const Padding(
                padding: EdgeInsets.all(AppSizes.spacingSmall),
                child: Image(
                  image: AssetImage('assets/images/feniq_logo.png'),
                  height: 32,
                  fit: BoxFit.contain,
                ),
              ),
              title:
                  BlocBuilder<WarehouseSelectionCubit, WarehouseSelectionState>(
                    buildWhen: (previous, current) =>
                        previous.warehouses.length != current.warehouses.length,
                    builder: (context, state) {
                      return Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            l10n.warehouseSelectionTitle,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          Text(
                            l10n.warehousesAvailableSubtitle(
                              state.warehouses.length,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 11.5,
                              fontWeight: FontWeight.normal,
                              color: Colors.white70,
                            ),
                          ),
                        ],
                      );
                    },
                  ),
              actions: const [NotificationButton(), CartButton()],
              bottom: PreferredSize(
                preferredSize: const Size.fromHeight(60),
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(
                    AppSizes.spacingMedium,
                    0,
                    AppSizes.spacingMedium,
                    AppSizes.spacingMedium,
                  ),
                  child: Container(
                    height: 46,
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppSizes.spacingMedium,
                    ),
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.14),
                      borderRadius: AppRadius.medium,
                    ),
                    child: Row(
                      children: [
                        const Icon(
                          Icons.search,
                          color: Colors.white70,
                          size: 20,
                        ),
                        const SizedBox(width: AppSizes.spacingSmall),
                        Expanded(
                          child: TextField(
                            controller: _searchController,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 14,
                            ),
                            decoration: InputDecoration(
                              filled: false,
                              isDense: true,
                              border: InputBorder.none,
                              enabledBorder: InputBorder.none,
                              focusedBorder: InputBorder.none,
                              errorBorder: InputBorder.none,
                              focusedErrorBorder: InputBorder.none,
                              hintText: l10n.searchWarehouseHint,
                              hintStyle: const TextStyle(
                                color: Colors.white70,
                                fontSize: 14,
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
            SliverToBoxAdapter(
              child: BannerSlider(onBannerTap: _handleBannerTap),
            ),
            BlocBuilder<WarehouseSelectionCubit, WarehouseSelectionState>(
              builder: (context, state) {
                switch (state.status) {
                  case WarehouseListStatus.initial:
                  case WarehouseListStatus.loading:
                    return const SliverFillRemaining(
                      hasScrollBody: false,
                      child: AppLoading(),
                    );
                  case WarehouseListStatus.error:
                    return SliverFillRemaining(
                      hasScrollBody: false,
                      child: FailureWidget(
                        message: translateErrorCode(
                          l10n,
                          state.errorCode,
                          state.errorMessage ?? l10n.errorState,
                        ),
                        onRetry: () => context
                            .read<WarehouseSelectionCubit>()
                            .loadWarehouses(),
                      ),
                    );
                  case WarehouseListStatus.loaded:
                    if (state.warehouses.isEmpty) {
                      return SliverFillRemaining(
                        hasScrollBody: false,
                        child: EmptyView(
                          message: l10n.noWarehousesAvailable,
                          icon: Icons.storefront_outlined,
                        ),
                      );
                    }
                    final filtered = _filtered(state.warehouses);
                    if (filtered.isEmpty) {
                      return SliverFillRemaining(
                        hasScrollBody: false,
                        child: EmptyView(
                          message: l10n.noSearchResultsFound,
                          icon: Icons.search_off_outlined,
                        ),
                      );
                    }
                    return SliverPadding(
                      padding: AppPadding.screen,
                      // Fluid column count (as many as fit at up to ~210px
                      // each) rather than a fixed 1-vs-2 breakpoint - scales
                      // smoothly from a phone up through a wide tablet
                      // instead of jumping straight from 1 to 2 columns at
                      // 700px.
                      sliver: SliverGrid(
                        gridDelegate:
                            const SliverGridDelegateWithMaxCrossAxisExtent(
                              maxCrossAxisExtent: 210,
                              mainAxisSpacing: AppSizes.spacingMedium,
                              crossAxisSpacing: AppSizes.spacingMedium,
                              mainAxisExtent: 260,
                            ),
                        delegate: SliverChildBuilderDelegate((context, index) {
                          final warehouse = filtered[index];
                          return WarehouseCard(
                            warehouse: warehouse,
                            onSelect: () => _handleSelect(warehouse),
                            onViewProfile: () => _handleViewProfile(warehouse),
                          );
                        }, childCount: filtered.length),
                      ),
                    );
                }
              },
            ),
          ],
        ),
      ),
    );
  }
}
