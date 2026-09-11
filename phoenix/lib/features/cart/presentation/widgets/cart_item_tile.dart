import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:feniq/core/constants/app_colors.dart';
import 'package:feniq/core/constants/app_radius.dart';
import 'package:feniq/core/constants/app_sizes.dart';
import 'package:feniq/core/extensions/build_context_extensions.dart';
import 'package:feniq/core/utils/currency_formatter.dart';
import 'package:feniq/core/widgets/app_dialog.dart';
import 'package:feniq/core/widgets/app_network_image.dart';
import 'package:feniq/core/widgets/custom_card.dart';
import 'package:feniq/core/widgets/quantity_stepper.dart';
import 'package:feniq/features/cart/data/models/cart_item.dart';
import 'package:feniq/features/exchange_rate/presentation/managers/exchange_rate_cubit.dart';

class CartItemTile extends StatelessWidget {
  const CartItemTile({
    super.key,
    required this.item,
    required this.onQuantityChanged,
    required this.onRemove,
  });

  final CartItem item;
  final ValueChanged<int> onQuantityChanged;
  final VoidCallback onRemove;

  // Reducing the quantity below 1 is the existing "remove this line" gesture
  // (the numeric field this stepper replaced already worked this way): the
  // stepper's `−` at quantity 1 opens the same confirmation the trash icon does.
  Future<void> _confirmRemoval(BuildContext context) async {
    final l10n = context.l10n;
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';
    final name = isArabic ? item.nameAr : (item.nameEn ?? item.nameAr);

    await AppDialog.show(
      context: context,
      title: l10n.removeItemTitle,
      content: l10n.removeItemConfirmation(name),
      actionLabel: l10n.removeButton,
      onAction: onRemove,
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';
    final name = isArabic ? item.nameAr : (item.nameEn ?? item.nameAr);
    // Every figure on this tile is SYP, converted from the stored USD price
    // at the current rate.
    final usdToSyp = context.watch<ExchangeRateCubit>().state.usdToSyp;
    final secondary = AppColors.textSecondaryOf(context);

    // A little roomier than the app's default card: the cart is where each
    // line gets checked before the order goes out, so every line gets a larger
    // picture, larger type and the full-size quantity controls.
    return CustomCard(
      padding: const EdgeInsets.all(AppSizes.spacingMedium + AppSizes.spacingXSmall),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (item.isPackage && !item.isAvailable) ...[
            const _UnavailablePackageBanner(),
            const SizedBox(height: AppSizes.spacingMedium),
          ],
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _ItemImage(url: item.image),
              const SizedBox(width: AppSizes.spacingMedium),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        // A package is a single line whose quantity is a copy
                        // count, so it is labelled - otherwise "2" on a
                        // package would read as two products.
                        if (item.isPackage) ...[
                          const _PackageBadge(),
                          const SizedBox(width: AppSizes.spacingXSmall),
                        ],
                        Expanded(
                          child: Text(
                            name,
                            style: context.textTheme.titleMedium,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: AppSizes.spacingXSmall),
                    Text(
                      isArabic ? item.manufacturerAr : (item.manufacturerEn ?? item.manufacturerAr),
                      style: context.textTheme.bodyMedium?.copyWith(color: secondary),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: AppSizes.spacingSmall),
                    if (item.hasOffer)
                      Wrap(
                        crossAxisAlignment: WrapCrossAlignment.center,
                        spacing: AppSizes.spacingSmall,
                        children: [
                          Text(
                            formatMoneyFromUsd(item.unitPriceUsd, usdToSyp, l10n.currencySuffix),
                            style: TextStyle(
                              decoration: TextDecoration.lineThrough,
                              color: secondary,
                              fontSize: 12,
                            ),
                          ),
                          Text(
                            formatMoneyFromUsd(item.discountPriceUsd, usdToSyp, l10n.currencySuffix),
                            style: TextStyle(
                              color: AppColors.secondaryOf(context),
                              fontWeight: FontWeight.bold,
                              fontSize: 15,
                            ),
                          ),
                        ],
                      )
                    else
                      Text(
                        formatMoneyFromUsd(item.discountPriceUsd, usdToSyp, l10n.currencySuffix),
                        style: TextStyle(
                          color: AppColors.primaryOf(context),
                          fontWeight: FontWeight.bold,
                          fontSize: 15,
                        ),
                      ),
                    // What the package actually delivers, at the current copy
                    // count - so "x2 copies" is never an abstraction the
                    // pharmacist has to do the arithmetic on.
                    if (item.isPackage && item.packageContents.isNotEmpty) ...[
                      const SizedBox(height: AppSizes.spacingXSmall),
                      for (final content in item.packageContents)
                        Padding(
                          padding: const EdgeInsetsDirectional.only(top: 2),
                          child: Text(
                            '${content.name(isArabic)} x${content.quantityPerCopy * item.quantity}',
                            style: context.textTheme.bodySmall?.copyWith(color: secondary),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                    ],
                  ],
                ),
              ),
              const SizedBox(width: AppSizes.spacingSmall),
              // The same remove action, on a soft tinted square so it reads as
              // a button at a glance without shouting over the line itself.
              IconButton(
                icon: Icon(Icons.delete_outline, color: AppColors.errorOf(context)),
                onPressed: () => _confirmRemoval(context),
                style: IconButton.styleFrom(
                  backgroundColor: AppColors.errorOf(context).withValues(alpha: 0.08),
                  shape: const RoundedRectangleBorder(borderRadius: AppRadius.small),
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSizes.spacingMedium),
          Divider(height: 1, color: AppColors.borderOf(context)),
          const SizedBox(height: AppSizes.spacingMedium),
          // A package's number is its copy count, so it is captioned - above
          // the stepper rather than beside it, so that at full size the
          // caption never squeezes the line total.
          if (item.isPackage) ...[
            Text(
              l10n.packageCopiesLabel,
              style: context.textTheme.bodySmall?.copyWith(color: secondary),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            const SizedBox(height: AppSizes.spacingXSmall),
          ],
          Row(
            children: [
              // The real cart quantity - QuantityStepper holds no number of its
              // own, it renders item.quantity and forwards a typed or stepped
              // value straight back to the cart. Taking it below 1 (typing 0,
              // clearing the field, or − at 1) opens the remove confirmation.
              QuantityStepper(
                quantity: item.quantity,
                decrementTooltip: l10n.decreaseQuantityLabel,
                incrementTooltip: l10n.increaseQuantityLabel,
                onChanged: onQuantityChanged,
                onBelowMin: () => _confirmRemoval(context),
              ),
              const SizedBox(width: AppSizes.spacingMedium),
              Expanded(
                child: Align(
                  alignment: AlignmentDirectional.centerEnd,
                  // Scales down instead of ellipsizing on a very narrow
                  // screen: a cut-off amount would misstate what the line costs.
                  child: FittedBox(
                    fit: BoxFit.scaleDown,
                    child: Text(
                      formatMoneyFromUsd(item.lineTotalUsd, usdToSyp, l10n.currencySuffix),
                      style: context.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
                      maxLines: 1,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _ItemImage extends StatelessWidget {
  const _ItemImage({required this.url});

  final String? url;

  @override
  Widget build(BuildContext context) {
    // TODO(seed-images): same note as ProductCard - `item.image` is still
    // always null. AppNetworkImage covers Cloudinary right-sizing + caching
    // for when real URLs land.
    return AppNetworkImage(
      url: url,
      width: 72,
      height: 72,
      fit: BoxFit.cover,
      borderRadius: AppRadius.medium,
      fallbackIcon: Icons.medication_outlined,
    );
  }
}

// Marks a cart line as a whole package rather than a single product. Uses the
// app's secondary colour, the same one the catalog uses for an offer badge.
class _PackageBadge extends StatelessWidget {
  const _PackageBadge();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: AppColors.secondaryOf(context).withValues(alpha: 0.12),
        borderRadius: AppRadius.small,
      ),
      child: Text(
        context.l10n.packageBadge,
        style: context.textTheme.labelSmall?.copyWith(
          color: AppColors.secondaryOf(context),
          fontWeight: FontWeight.bold,
        ),
      ),
    );
  }
}

// On a package line the server has reported as no longer available (paused by
// its warehouse or an admin). A standing warning, not a blocker: the line keeps
// its quantity and remove controls, and checkout is left to the server, which
// refuses the package with the same message this states.
class _UnavailablePackageBanner extends StatelessWidget {
  const _UnavailablePackageBanner();

  @override
  Widget build(BuildContext context) {
    final color = AppColors.errorOf(context);
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSizes.spacingSmall,
        vertical: AppSizes.spacingXSmall,
      ),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: AppRadius.small,
        border: Border.all(color: color.withValues(alpha: 0.4)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.error_outline, size: 18, color: color),
          const SizedBox(width: AppSizes.spacingXSmall),
          Expanded(
            child: Text(
              context.l10n.packageUnavailableBanner,
              style: context.textTheme.bodySmall?.copyWith(
                color: color,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
