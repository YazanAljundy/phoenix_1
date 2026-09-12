import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:feniq/core/constants/app_colors.dart';
import 'package:feniq/core/constants/app_sizes.dart';
import 'package:feniq/core/error/error_translator.dart';
import 'package:feniq/core/extensions/build_context_extensions.dart';
import 'package:feniq/core/widgets/app_skeleton.dart';
import 'package:feniq/core/widgets/empty_view.dart';
import 'package:feniq/core/widgets/failure_widget.dart';
import 'package:feniq/features/cart/presentation/widgets/cart_button.dart';
import 'package:feniq/features/catalog/data/models/manufacturers_route_args.dart';
import 'package:feniq/features/promotions/data/models/promotion.dart';
import 'package:feniq/features/promotions/presentation/managers/promotions_state.dart';
import 'package:feniq/features/promotions/presentation/managers/warehouse_offers_cubit.dart';
import 'package:feniq/features/promotions/presentation/widgets/promotion_hero_card.dart';
import 'package:feniq/routes/route_names.dart';

/// What a tapped Offer card on the Offers & Ads tab opens: the offers running
/// at that offer's own warehouse, and no other warehouse's.
///
/// Discovery only, exactly like the tab itself. A tapped offer here takes the
/// same hand-off the tab gives it - into the existing warehouse -> manufacturer
/// -> catalog flow, where the price, quantity and add-to-cart rules already
/// live - so nothing about how an offer is priced or bought is decided here.
/// The warehouse is fixed for the life of the screen (see WarehouseOffersCubit),
/// which is why there is no warehouse filter to switch away with.
class WarehouseOffersView extends StatelessWidget {
  const WarehouseOffersView({super.key, required this.warehouseName});

  /// The cart's own name for the warehouse, for the app bar. Empty when the
  /// route is opened without one (e.g. a deep link).
  final String warehouseName;

  static const EdgeInsets _listPadding = EdgeInsets.fromLTRB(
    AppSizes.spacingMedium,
    AppSizes.spacingMedium,
    AppSizes.spacingMedium,
    AppSizes.spacingLarge,
  );

  // The Offers & Ads tab's own offer hand-off (PromotionsView._handleTap).
  void _openOffer(BuildContext context, OfferPromotion promotion) {
    context.pushNamed(
      RouteNames.manufacturers,
      pathParameters: {'warehouseId': promotion.offer.warehouseId},
      extra: ManufacturersRouteArgs(
        warehouseName: promotion.warehouseName(
          Localizations.localeOf(context).languageCode == 'ar',
        ),
        autoFilterManufacturer: promotion.offer.manufacturerAr,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return Scaffold(
      appBar: AppBar(
        backgroundColor: AppColors.navyOf(context),
        foregroundColor: Colors.white,
        toolbarHeight: 64,
        title: BlocBuilder<WarehouseOffersCubit, PromotionsState>(
          buildWhen: (previous, current) =>
              previous.totalCount != current.totalCount || previous.status != current.status,
          builder: (context, state) {
            final count = l10n.promotionsCountSubtitle(state.totalCount);
            return Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(l10n.warehouseOffersTitle, maxLines: 1, overflow: TextOverflow.ellipsis),
                Text(
                  warehouseName.isEmpty ? count : '$warehouseName · $count',
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
        actions: const [CartButton()],
      ),
      body: BlocBuilder<WarehouseOffersCubit, PromotionsState>(
        builder: (context, state) {
          final cubit = context.read<WarehouseOffersCubit>();
          switch (state.status) {
            case PromotionsStatus.initial:
            case PromotionsStatus.loading:
              return const SkeletonPage(
                padding: _listPadding,
                children: [
                  SkeletonListCard(lines: 2),
                  SizedBox(height: AppSizes.spacingMedium),
                  SkeletonListCard(lines: 2),
                  SizedBox(height: AppSizes.spacingMedium),
                  SkeletonListCard(lines: 2),
                ],
              );
            case PromotionsStatus.error:
              return FailureWidget(
                message: translateErrorCode(
                  l10n,
                  state.errorCode,
                  state.errorMessage ?? l10n.promotionsError,
                ),
                onRetry: () => cubit.load(),
              );
            case PromotionsStatus.loaded:
              // Nothing running at this warehouse - the same calm empty state
              // the tab shows, never an error and never another warehouse's
              // offers in their place.
              if (state.promotions.isEmpty) {
                return RefreshIndicator(
                  onRefresh: cubit.load,
                  child: ListView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    children: [
                      SizedBox(height: context.screenHeight * 0.18),
                      EmptyView(
                        message: l10n.promotionsEmptyTitle,
                        icon: Icons.local_offer_outlined,
                      ),
                    ],
                  ),
                );
              }
              return RefreshIndicator(
                onRefresh: cubit.load,
                child: ListView.separated(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: _listPadding,
                  itemCount: state.promotions.length,
                  separatorBuilder: (context, index) =>
                      const SizedBox(height: AppSizes.spacingMedium),
                  itemBuilder: (context, index) {
                    final promotion = state.promotions[index];
                    // Same width cap as the tab's list, for tablets.
                    return Center(
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 560),
                        child: PromotionListCard(
                          key: ValueKey(promotion.key),
                          promotion: promotion,
                          onTap: () {
                            // Only ever offers - see WarehouseOffersCubit.
                            if (promotion is OfferPromotion) _openOffer(context, promotion);
                          },
                        ),
                      ),
                    );
                  },
                ),
              );
          }
        },
      ),
    );
  }
}
