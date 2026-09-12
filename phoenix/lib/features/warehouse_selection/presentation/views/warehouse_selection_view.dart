import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:feniq/core/constants/app_colors.dart';
import 'package:feniq/core/constants/app_padding.dart';
import 'package:feniq/core/constants/app_radius.dart';
import 'package:feniq/core/constants/app_sizes.dart';
import 'package:feniq/core/error/error_translator.dart';
import 'package:feniq/core/extensions/build_context_extensions.dart';
import 'package:feniq/core/widgets/app_skeleton.dart';
import 'package:feniq/core/widgets/brand_logo.dart';
import 'package:feniq/core/widgets/empty_view.dart';
import 'package:feniq/core/widgets/failure_widget.dart';
import 'package:feniq/core/widgets/primary_button.dart';
import 'package:feniq/features/auth/presentation/managers/auth_cubit.dart';
import 'package:feniq/features/banners/data/models/banner_model.dart';
import 'package:feniq/features/banners/presentation/managers/banners_cubit.dart';
import 'package:feniq/features/banners/presentation/widgets/banner_slider.dart';
import 'package:feniq/features/cart/presentation/widgets/cart_button.dart';
import 'package:feniq/features/catalog/data/models/manufacturers_route_args.dart';
import 'package:feniq/features/exchange_rate/presentation/managers/exchange_rate_cubit.dart';
import 'package:feniq/features/notifications/presentation/widgets/notification_button.dart';
import 'package:feniq/features/warehouse_selection/data/models/warehouse_model.dart';
import 'package:feniq/features/warehouse_selection/presentation/managers/warehouse_selection_cubit.dart';
import 'package:feniq/features/warehouse_selection/presentation/managers/warehouse_selection_state.dart';
import 'package:feniq/features/warehouse_selection/presentation/widgets/warehouse_card.dart';
import 'package:feniq/features/warehouse_selection/presentation/widgets/warehouse_city_scope_bar.dart';
import 'package:feniq/routes/route_names.dart';

// One set of grid metrics for the loaded grid and its loading skeleton, so
// the placeholder cells land exactly where the cards are about to. The tile
// height is WarehouseCard's fixed budget - see warehouse_card.dart and the
// layout test that pins it.
const double _tileMaxWidth = 210;
const double _tileHeight = 220;
const double _gridSpacing = AppSizes.spacingMedium - 4;

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
                child: BrandLogo.mark(height: 32, onDark: true),
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
            // The city scope switch, in the open directly above the grid it
            // controls. Only rendered once the server has confirmed it can
            // actually narrow this pharmacy's list (cityScopeAvailable) - see
            // WarehouseSelectionState.
            BlocBuilder<WarehouseSelectionCubit, WarehouseSelectionState>(
              buildWhen: (previous, current) =>
                  previous.cityScopeAvailable != current.cityScopeAvailable ||
                  previous.onlyMyCity != current.onlyMyCity ||
                  previous.isChangingScope != current.isChangingScope,
              builder: (context, state) {
                if (!state.cityScopeAvailable) {
                  return const SliverToBoxAdapter(child: SizedBox.shrink());
                }
                return SliverToBoxAdapter(
                  child: WarehouseCityScopeBar(
                    onlyMyCity: state.onlyMyCity,
                    isBusy: state.isChangingScope,
                    onChanged: (onlyMyCity) => context
                        .read<WarehouseSelectionCubit>()
                        .setOnlyMyCity(onlyMyCity),
                  ),
                );
              },
            ),
            BlocBuilder<WarehouseSelectionCubit, WarehouseSelectionState>(
              builder: (context, state) {
                switch (state.status) {
                  case WarehouseListStatus.initial:
                  case WarehouseListStatus.loading:
                    // Same grid metrics as the loaded state below - the
                    // placeholder cells sit exactly where the warehouse
                    // cards are about to. SkeletonGrid shrink-wraps, so it
                    // drops into this CustomScrollView as a box adapter
                    // without needing a sliver of its own.
                    return SliverToBoxAdapter(
                      child: SkeletonGrid(
                        maxCrossAxisExtent: _tileMaxWidth,
                        mainAxisExtent: _tileHeight,
                        spacing: _gridSpacing,
                        itemBuilder: (context, index) =>
                            const _WarehouseSkeletonCell(),
                      ),
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
                      // A dead end the pharmacist can walk straight out of:
                      // when the emptiness is the city filter's doing, the way
                      // to widen the search is offered right here rather than
                      // left to be found back up the screen.
                      if (state.isEmptyInOwnCity) {
                        return SliverFillRemaining(
                          hasScrollBody: false,
                          child: _NoWarehousesInCityView(
                            onViewAllCities: () => context
                                .read<WarehouseSelectionCubit>()
                                .setOnlyMyCity(false),
                          ),
                        );
                      }
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
                      //
                      // Tile metrics are shared with the skeleton above - see
                      // _tileHeight.
                      sliver: SliverGrid(
                        gridDelegate:
                            const SliverGridDelegateWithMaxCrossAxisExtent(
                              maxCrossAxisExtent: _tileMaxWidth,
                              mainAxisSpacing: _gridSpacing,
                              crossAxisSpacing: _gridSpacing,
                              mainAxisExtent: _tileHeight,
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

/// The "nothing in your city" dead end, with the way out attached.
///
/// Calm on purpose: this is a normal state of a platform that has not reached
/// every city yet, not a failure - so it reuses EmptyView rather than
/// FailureWidget, and offers widening as the obvious next step instead of a
/// retry that would return the same empty list.
class _NoWarehousesInCityView extends StatelessWidget {
  const _NoWarehousesInCityView({required this.onViewAllCities});

  final VoidCallback onViewAllCities;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        EmptyView(
          message: l10n.noWarehousesInYourCity,
          subtitle: l10n.noWarehousesInYourCitySubtitle,
          icon: Icons.location_off_outlined,
        ),
        const SizedBox(height: AppSizes.spacingLarge),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppSizes.spacingXLarge),
          child: ConstrainedBox(
            // PrimaryButton is full-width by design; here it is one choice
            // offered, not a form's submit, so it stays a button rather than
            // stretching into a bar across the page.
            constraints: const BoxConstraints(maxWidth: 280),
            child: PrimaryButton(
              label: l10n.viewAllCitiesButton,
              onPressed: onViewAllCities,
            ),
          ),
        ),
      ],
    );
  }
}

// One warehouse placeholder: the logo banner, a two-line name, the city
// pill, and the profile / WhatsApp action row pinned to the bottom edge -
// the WarehouseCard layout with the content taken out.
class _WarehouseSkeletonCell extends StatelessWidget {
  const _WarehouseSkeletonCell();

  @override
  Widget build(BuildContext context) {
    return const SkeletonCard(
      padding: EdgeInsets.zero,
      mainAxisSize: MainAxisSize.max,
      children: [
        SkeletonBar(height: WarehouseCard.logoHeight, radius: AppRadius.large),
        Padding(
          padding: EdgeInsets.fromLTRB(
            AppSizes.spacingSmall + 2,
            AppSizes.spacingSmall + 2,
            AppSizes.spacingSmall + 2,
            0,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              SkeletonBar(height: 12),
              SizedBox(height: AppSizes.spacingXSmall),
              SkeletonBar(width: 96, height: 12),
              SizedBox(height: AppSizes.spacingXSmall + 2),
              SkeletonBar(width: 64, height: 18, radius: AppRadius.full),
            ],
          ),
        ),
        Spacer(),
        Padding(
          padding: EdgeInsets.fromLTRB(
            AppSizes.spacingSmall + 2,
            AppSizes.spacingSmall,
            AppSizes.spacingSmall + 2,
            AppSizes.spacingSmall + 2,
          ),
          child: Row(
            children: [
              Expanded(child: SkeletonBar(height: 36)),
              SizedBox(width: AppSizes.spacingSmall),
              // Rounded square, not a circle - WhatsAppButton's own shape.
              SkeletonBar(width: 36, height: 36),
            ],
          ),
        ),
      ],
    );
  }
}
