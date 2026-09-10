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

    return CustomCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
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
                            style: context.textTheme.titleSmall,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(
                      isArabic ? item.manufacturerAr : (item.manufacturerEn ?? item.manufacturerAr),
                      style: context.textTheme.bodySmall?.copyWith(
                        color: AppColors.textSecondaryOf(context),
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: AppSizes.spacingXSmall),
                    if (item.hasOffer)
                      Wrap(
                        crossAxisAlignment: WrapCrossAlignment.center,
                        spacing: AppSizes.spacingXSmall,
                        children: [
                          Text(
                            formatMoneyFromUsd(item.unitPriceUsd, usdToSyp, l10n.currencySuffix),
                            style: TextStyle(
                              decoration: TextDecoration.lineThrough,
                              color: AppColors.textSecondaryOf(context),
                              fontSize: 11.5,
                            ),
                          ),
                          Text(
                            formatMoneyFromUsd(item.discountPriceUsd, usdToSyp, l10n.currencySuffix),
                            style: TextStyle(
                              color: AppColors.secondaryOf(context),
                              fontWeight: FontWeight.bold,
                              fontSize: 13,
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
                          fontSize: 13,
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
                            style: context.textTheme.bodySmall?.copyWith(
                              color: AppColors.textSecondaryOf(context),
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                    ],
                  ],
                ),
              ),
              IconButton(
                icon: Icon(Icons.delete_outline, color: AppColors.errorOf(context)),
                onPressed: () => _confirmRemoval(context),
              ),
            ],
          ),
          const Divider(height: AppSizes.spacingLarge),
          Row(
            children: [
              // The real cart quantity - QuantityStepper holds no number of its
              // own, it renders item.quantity and forwards a typed or stepped
              // value straight back to the cart. Taking it below 1 (typing 0,
              // clearing the field, or − at 1) opens the remove confirmation.
              QuantityStepper(
                quantity: item.quantity,
                compact: true,
                decrementTooltip: l10n.decreaseQuantityLabel,
                incrementTooltip: l10n.increaseQuantityLabel,
                onChanged: onQuantityChanged,
                onBelowMin: () => _confirmRemoval(context),
              ),
              if (item.isPackage) ...[
                const SizedBox(width: AppSizes.spacingXSmall),
                Flexible(
                  child: Text(
                    l10n.packageCopiesLabel,
                    style: context.textTheme.bodySmall?.copyWith(
                      color: AppColors.textSecondaryOf(context),
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
              Expanded(
                child: Align(
                  alignment: AlignmentDirectional.centerEnd,
                  child: Text(
                    formatMoneyFromUsd(item.lineTotalUsd, usdToSyp, l10n.currencySuffix),
                    style: context.textTheme.titleSmall,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
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
      width: 56,
      height: 56,
      fit: BoxFit.cover,
      borderRadius: AppRadius.small,
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
