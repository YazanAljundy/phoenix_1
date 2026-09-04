import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_radius.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/error/error_translator.dart';
import 'package:phoenix/core/error/failure.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/utils/currency_formatter.dart';
import 'package:phoenix/core/widgets/app_dialog.dart';
import 'package:phoenix/features/advertisements/data/models/advertisement_cart_preparation.dart';
import 'package:phoenix/features/advertisements/data/models/advertisement_model.dart';
import 'package:phoenix/features/advertisements/data/repositories/advertisements_repository.dart';
import 'package:phoenix/features/cart/presentation/managers/cart_cubit.dart';
import 'package:phoenix/features/exchange_rate/presentation/managers/exchange_rate_cubit.dart';
import 'package:phoenix/routes/route_names.dart';

// One advertised package: its products, each at its advertised price, and the
// package total the pharmacy actually pays. Tapping it fetches the package
// fresh from the server, drops it into the EXISTING cart and opens the cart
// screen - no separate advertisement cart, no intermediate screen.
//
// Double-tap safe: `_busy` gates the whole flow.
class AdvertisementCard extends StatefulWidget {
  const AdvertisementCard({super.key, required this.advertisement});

  final AdvertisementModel advertisement;

  @override
  State<AdvertisementCard> createState() => _AdvertisementCardState();
}

class _AdvertisementCardState extends State<AdvertisementCard> {
  bool _busy = false;

  // Same confirm shape ReorderButton uses - the project's existing conflict
  // copy for a cross-warehouse cart, a plainer "replace" prompt otherwise.
  Future<bool> _confirm({
    required String title,
    required String content,
    required String actionLabel,
  }) async {
    final result = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(title),
        content: Text(content),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext, rootNavigator: true).pop(false),
            child: Text(dialogContext.l10n.cancel),
          ),
          TextButton(
            onPressed: () => Navigator.of(dialogContext, rootNavigator: true).pop(true),
            child: Text(actionLabel),
          ),
        ],
      ),
    );
    return result ?? false;
  }

  Future<void> _onTap() async {
    if (_busy) return;
    setState(() => _busy = true);

    final l10n = context.l10n;
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';
    final repository = context.read<AdvertisementsRepository>();
    final cartCubit = context.read<CartCubit>();

    // Re-fetched on tap rather than trusting the listed copy: the package may
    // have expired, been withdrawn, or lost a product since the list loaded.
    AdvertisementCartPreparation preparation;
    try {
      preparation = await repository.prepareAdvertisementCart(widget.advertisement.id);
    } on Failure catch (f) {
      if (mounted) {
        await AppDialog.show(
          context: context,
          title: l10n.advertisementUnavailableTitle,
          content: f.code == 'ADVERTISEMENT_UNAVAILABLE'
              ? l10n.advertisementUnavailableMessage
              : translateErrorCode(l10n, f.code, f.errMessage),
        );
      }
      if (mounted) setState(() => _busy = false);
      return;
    } catch (_) {
      if (mounted) {
        await AppDialog.show(context: context, title: l10n.errorState, content: l10n.errorState);
      }
      if (mounted) setState(() => _busy = false);
      return;
    }

    if (!mounted) return;

    // A package is all-or-nothing: the server rejects an incomplete one at
    // checkout (ADVERTISEMENT_ITEM_MISSING), so it is never half-added here.
    if (!preparation.isComplete) {
      final names = preparation.unavailableItems
          .map((item) => isArabic ? item.productNameAr : (item.productNameEn ?? item.productNameAr))
          .where((name) => name.isNotEmpty)
          .join(isArabic ? '، ' : ', ');
      await AppDialog.show(
        context: context,
        title: l10n.advertisementUnavailableTitle,
        content: names.isEmpty
            ? l10n.advertisementUnavailableMessage
            : l10n.advertisementIncompleteMessage(names),
      );
      if (mounted) setState(() => _busy = false);
      return;
    }

    // One-warehouse-per-cart: a cart that already holds items is replaced,
    // never merged. Cross-warehouse reuses the project's existing conflict
    // copy - the same rule and the same wording as every other entry point.
    if (cartCubit.state.items.isNotEmpty) {
      final crossWarehouse = cartCubit.state.warehouseId != preparation.warehouseId;
      final confirmed = await _confirm(
        title: crossWarehouse ? l10n.cartConflictTitle : l10n.advertisementReplaceCartTitle,
        content: crossWarehouse
            ? l10n.cartConflictMessage(cartCubit.state.warehouseName ?? '')
            : l10n.advertisementReplaceCartMessage,
        actionLabel: crossWarehouse
            ? l10n.cartConflictConfirmButton
            : l10n.advertisementReplaceCartConfirm,
      );
      if (!confirmed) {
        if (mounted) setState(() => _busy = false);
        return;
      }
    }

    if (!mounted) return;

    cartCubit.loadAdvertisement(
      advertisementId: preparation.advertisementId,
      warehouseId: preparation.warehouseId,
      warehouseName: isArabic
          ? preparation.warehouseNameAr
          : (preparation.warehouseNameEn ?? preparation.warehouseNameAr),
      items: preparation.items,
      itemsSubtotalUsd: preparation.itemsTotalUsd,
      totalUsd: preparation.totalPriceUsd,
    );
    context.pushNamed(RouteNames.cart);

    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';
    final advertisement = widget.advertisement;
    final usdToSyp = context.watch<ExchangeRateCubit>().state.usdToSyp;

    String money(num usd) => formatMoneyFromUsd(usd, usdToSyp, l10n.currencySuffix);
    final title = isArabic
        ? advertisement.titleAr
        : (advertisement.titleEn ?? advertisement.titleAr);
    final warehouseName = isArabic
        ? advertisement.warehouseNameAr
        : (advertisement.warehouseNameEn ?? advertisement.warehouseNameAr);

    return Card(
      margin: const EdgeInsets.only(bottom: AppSizes.spacingMedium),
      shape: const RoundedRectangleBorder(borderRadius: AppRadius.large),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: _busy ? null : _onTap,
        child: Padding(
          padding: const EdgeInsets.all(AppSizes.spacingMedium),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          title,
                          style: context.textTheme.titleMedium,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                        Text(
                          warehouseName,
                          style: context.textTheme.bodySmall?.copyWith(
                            color: AppColors.textSecondaryOf(context),
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  ),
                  if (advertisement.hasSaving)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(
                        color: AppColors.primaryOf(context),
                        borderRadius: AppRadius.full,
                      ),
                      child: Text(
                        l10n.advertisementSavingPercent(advertisement.savingPercentage),
                        style: context.textTheme.labelSmall?.copyWith(color: Colors.white),
                      ),
                    ),
                ],
              ),
              const SizedBox(height: AppSizes.spacingSmall),

              // Each product line: name, its package quantity, and the line's
              // catalog cost (price x quantity). A product that has since been
              // removed (priceUsd null) shows no price - the tap handler blocks
              // ordering an incomplete package anyway.
              for (final item in advertisement.items)
                Padding(
                  padding: const EdgeInsets.only(bottom: 4),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          isArabic ? item.nameAr : (item.nameEn ?? item.nameAr),
                          style: context.textTheme.bodyMedium,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      Padding(
                        padding: const EdgeInsetsDirectional.only(end: AppSizes.spacingSmall),
                        child: Text(
                          l10n.advertisementItemQuantity(item.quantity),
                          style: context.textTheme.bodySmall?.copyWith(
                            color: AppColors.textSecondaryOf(context),
                          ),
                        ),
                      ),
                      if (item.lineTotalUsd != null)
                        Text(
                          money(item.lineTotalUsd!),
                          style: context.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600),
                        ),
                    ],
                  ),
                ),

              const Divider(height: AppSizes.spacingMedium),

              // The two pricing levels, kept visually apart: the sum of the
              // lines struck through, the package price as the headline.
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(l10n.advertisementPackageTotal, style: context.textTheme.titleSmall),
                  Wrap(
                    crossAxisAlignment: WrapCrossAlignment.center,
                    spacing: AppSizes.spacingXSmall,
                    children: [
                      if (advertisement.hasSaving)
                        Text(
                          money(advertisement.itemsTotalUsd),
                          style: context.textTheme.bodySmall?.copyWith(
                            decoration: TextDecoration.lineThrough,
                            color: AppColors.textSecondaryOf(context),
                          ),
                        ),
                      Text(
                        money(advertisement.totalPriceUsd),
                        style: context.textTheme.titleMedium?.copyWith(
                          color: AppColors.primaryOf(context),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
              const SizedBox(height: AppSizes.spacingSmall),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: _busy ? null : _onTap,
                  style: FilledButton.styleFrom(
                    backgroundColor: AppColors.primaryOf(context),
                    foregroundColor: Colors.white,
                    shape: const RoundedRectangleBorder(borderRadius: AppRadius.medium),
                  ),
                  child: _busy
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                        )
                      : Text(l10n.advertisementAddToCartButton),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
