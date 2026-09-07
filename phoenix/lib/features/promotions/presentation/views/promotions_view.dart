import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/error/error_translator.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/widgets/app_loading.dart';
import 'package:phoenix/core/widgets/empty_view.dart';
import 'package:phoenix/core/widgets/failure_widget.dart';
import 'package:phoenix/features/advertisements/presentation/utils/advertisement_cart_launcher.dart';
import 'package:phoenix/features/cart/presentation/widgets/cart_button.dart';
import 'package:phoenix/features/catalog/data/models/manufacturers_route_args.dart';
import 'package:phoenix/features/notifications/presentation/widgets/notification_button.dart';
import 'package:phoenix/features/promotions/data/models/promotion.dart';
import 'package:phoenix/features/promotions/presentation/managers/promotions_cubit.dart';
import 'package:phoenix/features/promotions/presentation/managers/promotions_state.dart';
import 'package:phoenix/features/promotions/presentation/widgets/promotion_filter_bar.dart';
import 'package:phoenix/features/promotions/presentation/widgets/promotion_hero_card.dart';
import 'package:phoenix/features/promotions/presentation/widgets/promotions_hero_carousel.dart';
import 'package:phoenix/routes/route_names.dart';

/// The Offers & Ads tab: the one place a pharmacist browses everything being
/// promoted right now - product offers and warehouse packages together.
///
/// Discovery only. Nothing is ordered from here: an offer hands off to the
/// existing warehouse -> manufacturer -> catalog flow (the very route a tapped
/// banner already uses), and a package hands off to the existing package ->
/// cart flow. Neither builds a screen of its own.
class PromotionsView extends StatefulWidget {
  const PromotionsView({super.key});

  @override
  State<PromotionsView> createState() => _PromotionsViewState();
}

class _PromotionsViewState extends State<PromotionsView> {
  // A package tap is a network round trip; this stops a double tap from
  // starting two of them (the same guard AdvertisementCard uses).
  bool _openingPackage = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) context.read<PromotionsCubit>().load();
    });
  }

  Future<void> _handleTap(Promotion promotion) async {
    switch (promotion) {
      case OfferPromotion(:final offer):
        // Straight into the catalog for that product's manufacturer, exactly
        // as a tapped banner does - ManufacturersView jumps through on its own
        // once it has confirmed the manufacturer is still stocked here.
        context.pushNamed(
          RouteNames.manufacturers,
          pathParameters: {'warehouseId': offer.warehouseId},
          extra: ManufacturersRouteArgs(
            warehouseName: promotion.warehouseName(
              Localizations.localeOf(context).languageCode == 'ar',
            ),
            autoFilterManufacturer: offer.manufacturerAr,
          ),
        );
      case PackagePromotion(:final advertisement):
        if (_openingPackage) return;
        setState(() => _openingPackage = true);
        await launchAdvertisementCart(context, advertisement.id);
        if (mounted) setState(() => _openingPackage = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return Scaffold(
      appBar: AppBar(
        backgroundColor: AppColors.navyOf(context),
        foregroundColor: Colors.white,
        toolbarHeight: 64,
        title: BlocBuilder<PromotionsCubit, PromotionsState>(
          buildWhen: (previous, current) =>
              previous.totalCount != current.totalCount || previous.status != current.status,
          builder: (context, state) {
            return Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(l10n.offersAndAdsTitle, maxLines: 1, overflow: TextOverflow.ellipsis),
                Text(
                  l10n.promotionsCountSubtitle(state.totalCount),
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
      ),
      body: BlocBuilder<PromotionsCubit, PromotionsState>(
        builder: (context, state) {
          switch (state.status) {
            case PromotionsStatus.initial:
            case PromotionsStatus.loading:
              return const AppLoading();
            case PromotionsStatus.error:
              return FailureWidget(
                message: translateErrorCode(
                  l10n,
                  state.errorCode,
                  state.errorMessage ?? l10n.promotionsError,
                ),
                onRetry: () => context.read<PromotionsCubit>().load(),
              );
            case PromotionsStatus.loaded:
              return _LoadedBody(state: state, onPromotionTap: _handleTap);
          }
        },
      ),
    );
  }
}

class _LoadedBody extends StatelessWidget {
  const _LoadedBody({required this.state, required this.onPromotionTap});

  final PromotionsState state;
  final ValueChanged<Promotion> onPromotionTap;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final cubit = context.read<PromotionsCubit>();
    final visible = state.filtered;

    // Nothing is running at all - a calm "come back later", the app's standard
    // empty state, never an error.
    if (state.promotions.isEmpty) {
      return RefreshIndicator(
        onRefresh: cubit.load,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            SizedBox(height: context.screenHeight * 0.18),
            EmptyView(
              message: l10n.promotionsEmptyTitle,
              subtitle: l10n.promotionsEmptyMessage,
              icon: Icons.local_offer_outlined,
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: cubit.load,
      child: CustomScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: [
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.only(top: AppSizes.spacingMedium),
              child: PromotionFilterBar(
                kindFilter: state.kindFilter,
                warehouseFilter: state.warehouseFilter,
                warehouses: state.warehouses,
                onKindChanged: cubit.filterByKind,
                onWarehouseChanged: cubit.filterByWarehouse,
              ),
            ),
          ),
          if (visible.isEmpty)
            SliverFillRemaining(
              hasScrollBody: false,
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  EmptyView(
                    message: l10n.promotionsNoFilterResults,
                    icon: Icons.filter_alt_off_outlined,
                  ),
                  const SizedBox(height: AppSizes.spacingMedium),
                  TextButton(
                    onPressed: cubit.clearFilters,
                    child: Text(l10n.promotionsClearFilters),
                  ),
                ],
              ),
            )
          else ...[
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(
                  AppSizes.spacingMedium,
                  AppSizes.spacingMedium,
                  0,
                  0,
                ),
                // Full width on a phone, capped on a tablet - the same
                // treatment BannerSlider and the packages section give theirs.
                child: Center(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 640),
                    child: PromotionsHeroCarousel(
                      promotions: state.featured,
                      onPromotionTap: onPromotionTap,
                    ),
                  ),
                ),
              ),
            ),
            SliverToBoxAdapter(
              child: Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 560),
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(
                      AppSizes.spacingMedium,
                      AppSizes.spacingLarge,
                      AppSizes.spacingMedium,
                      AppSizes.spacingSmall,
                    ),
                    child: Align(
                      alignment: AlignmentDirectional.centerStart,
                      child: Text(l10n.promotionsAllTitle, style: context.textTheme.titleMedium),
                    ),
                  ),
                ),
              ),
            ),
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(
                AppSizes.spacingMedium,
                0,
                AppSizes.spacingMedium,
                AppSizes.spacingLarge,
              ),
              sliver: SliverList.separated(
                itemCount: visible.length,
                separatorBuilder: (context, index) =>
                    const SizedBox(height: AppSizes.spacingMedium),
                itemBuilder: (context, index) {
                  final promotion = visible[index];
                  return Center(
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 560),
                      child: PromotionListCard(
                        key: ValueKey(promotion.key),
                        promotion: promotion,
                        onTap: () => onPromotionTap(promotion),
                      ),
                    ),
                  );
                },
              ),
            ),
          ],
        ],
      ),
    );
  }
}
