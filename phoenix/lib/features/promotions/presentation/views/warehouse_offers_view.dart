import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:feniq/core/constants/app_colors.dart';
import 'package:feniq/core/constants/app_sizes.dart';
import 'package:feniq/core/error/error_translator.dart';
import 'package:feniq/core/extensions/build_context_extensions.dart';
import 'package:feniq/core/widgets/add_to_cart_button.dart';
import 'package:feniq/core/widgets/app_dialog.dart';
import 'package:feniq/core/widgets/app_skeleton.dart';
import 'package:feniq/core/widgets/app_snackbar.dart';
import 'package:feniq/core/widgets/empty_view.dart';
import 'package:feniq/core/widgets/failure_widget.dart';
import 'package:feniq/core/widgets/quantity_stepper.dart';
import 'package:feniq/core/widgets/status_badge.dart';
import 'package:feniq/features/cart/presentation/managers/cart_cubit.dart';
import 'package:feniq/features/cart/presentation/managers/cart_state.dart';
import 'package:feniq/features/cart/presentation/widgets/cart_button.dart';
import 'package:feniq/features/catalog/presentation/widgets/quantity_picker_sheet.dart';
import 'package:feniq/features/offers/data/models/offer_model.dart';
import 'package:feniq/features/promotions/data/models/promotion.dart';
import 'package:feniq/features/promotions/presentation/managers/promotions_state.dart';
import 'package:feniq/features/promotions/presentation/managers/warehouse_offers_cubit.dart';
import 'package:feniq/features/promotions/presentation/widgets/promotion_hero_card.dart';

/// What a tapped Offer card on the Offers & Ads tab opens: the offers running
/// at that offer's own warehouse, and no other warehouse's.
///
/// This is where an offer is bought, not just read about: a tapped offer goes
/// straight into the cart through the catalog's own add path - the pre-add
/// quantity sheet, then CartCubit.addProduct with the catalog's
/// conflicting-warehouse confirmation - instead of handing off to the
/// warehouse -> manufacturer -> catalog flow to find the same product again.
/// Nothing about pricing is decided here either way: the line is built from
/// the server-computed offer price the card already shows
/// (OfferModel.toCartProduct).
///
/// The warehouse is fixed for the life of the screen (see WarehouseOffersCubit),
/// which is why there is no warehouse filter to switch away with - and why the
/// cart conflict below can only ever be "your cart belongs to a DIFFERENT
/// warehouse".
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

  // How much of this offer's product is in the cart right now - the same rule
  // CatalogView.cartQuantityFor applies: a cart bound to another warehouse
  // counts as zero here, so every card stays on its "add" button and a tap
  // runs the usual conflicting-warehouse confirmation.
  int _cartQuantityFor(CartState cartState, OfferModel offer) {
    if (cartState.warehouseId != offer.warehouseId) return 0;
    for (final item in cartState.items) {
      if (item.productId == offer.productId) return item.quantity;
    }
    return 0;
  }

  // ProductCard._handleAddTap: the quantity is chosen up front, in the app's
  // existing pre-add sheet, and nothing is added if the sheet is dismissed.
  Future<void> _handleAddTap(BuildContext context, OfferPromotion promotion) async {
    final quantity = await showQuantityPickerSheet(context);
    if (quantity == null || !context.mounted) return;
    _handleAdd(context, promotion, quantity);
  }

  // CatalogView._handleAdd, applied to the offer's product. Kept identical on
  // purpose - one warehouse per order (Section 6.6) is resolved by the very
  // same dialog, in the same order, with the same copy.
  void _handleAdd(BuildContext context, OfferPromotion promotion, int quantity) {
    final l10n = context.l10n;
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';
    final offer = promotion.offer;
    final product = offer.toCartProduct();
    final name = isArabic ? product.nameAr : (product.nameEn ?? product.nameAr);
    final cartCubit = context.read<CartCubit>();
    final warehouseId = offer.warehouseId;
    // The offer's own warehouse name, localized - `warehouseName` above is the
    // app bar's copy and can be empty on a deep link.
    final warehouseName = promotion.warehouseName(isArabic);

    if (cartCubit.hasConflictingWarehouse(warehouseId)) {
      AppDialog.show(
        context: context,
        title: l10n.cartConflictTitle,
        content: l10n.cartConflictMessage(cartCubit.state.warehouseName ?? ''),
        actionLabel: l10n.cartConflictConfirmButton,
        // AppDialog's own action button already pops this confirmation dialog
        // - see CatalogView, where an extra pop here silently aborted the add.
        onAction: () {
          cartCubit.replaceWithProduct(
            product,
            warehouseId: warehouseId,
            warehouseName: warehouseName,
            quantity: quantity,
          );
          AppSnackbar.show(context, l10n.addedToCartMessage(name));
        },
      );
      return;
    }

    cartCubit.addProduct(
      product,
      warehouseId: warehouseId,
      warehouseName: warehouseName,
      quantity: quantity,
    );
    AppSnackbar.show(context, l10n.addedToCartMessage(name));
  }

  // The card's own control, with the catalog list row's three states intact:
  // an unavailable product keeps its place but offers no way to buy it, a
  // product already in the cart shows a stepper wired straight to CartCubit
  // (so the number on the card is always CartItem.quantity, never a copy), and
  // anything else gets the add button.
  Widget _offerAction(BuildContext context, OfferPromotion promotion, int cartQuantity) {
    final l10n = context.l10n;
    final offer = promotion.offer;

    if (!offer.isAvailable) {
      return Align(
        alignment: AlignmentDirectional.centerStart,
        child: StatusBadge(label: l10n.unavailableLabel, tone: StatusBadgeTone.danger),
      );
    }

    if (cartQuantity > 0) {
      final cartCubit = context.read<CartCubit>();
      return Align(
        alignment: AlignmentDirectional.centerStart,
        child: QuantityStepper(
          quantity: cartQuantity,
          compact: true,
          decrementTooltip: l10n.decreaseQuantityLabel,
          incrementTooltip: l10n.increaseQuantityLabel,
          onChanged: (quantity) => cartCubit.updateQuantity(offer.productId, quantity),
          onBelowMin: () => cartCubit.removeItem(offer.productId),
        ),
      );
    }

    return AddToCartButton(
      available: true,
      compact: true,
      onTap: () => _handleAddTap(context, promotion),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    // Watched, like CatalogView does it: every card's action slot is derived
    // from the live cart, so adding, stepping or removing redraws the list.
    final cartState = context.watch<CartCubit>().state;

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
                    // Only ever offers - see WarehouseOffersCubit.
                    final promotion = state.promotions[index] as OfferPromotion;
                    final cartQuantity = _cartQuantityFor(cartState, promotion.offer);
                    final canAdd = promotion.offer.isAvailable && cartQuantity == 0;
                    // Same width cap as the tab's list, for tablets.
                    return Center(
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 560),
                        child: Opacity(
                          // ProductCard's treatment of an unavailable product:
                          // still listed, visibly faded, never hidden.
                          opacity: promotion.offer.isAvailable ? 1.0 : 0.55,
                          child: PromotionListCard(
                            key: ValueKey(promotion.key),
                            promotion: promotion,
                            // The whole card is the add button while there is
                            // something to add. Once the product is in the
                            // cart the stepper below owns the quantity - the
                            // catalog has no "add" action left at that point
                            // either - and an unavailable one has none at all.
                            onTap: canAdd ? () => _handleAddTap(context, promotion) : null,
                            action: _offerAction(context, promotion, cartQuantity),
                          ),
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
