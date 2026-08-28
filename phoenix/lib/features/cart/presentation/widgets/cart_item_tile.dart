import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_radius.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/utils/currency_formatter.dart';
import 'package:phoenix/core/widgets/app_dialog.dart';
import 'package:phoenix/core/widgets/app_network_image.dart';
import 'package:phoenix/core/widgets/custom_card.dart';
import 'package:phoenix/core/widgets/quantity_stepper.dart';
import 'package:phoenix/core/widgets/secondary_price_hint.dart';
import 'package:phoenix/features/cart/data/models/cart_item.dart';
import 'package:phoenix/features/exchange_rate/presentation/managers/exchange_rate_cubit.dart';

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
    final usdToSyp = context.watch<ExchangeRateCubit>().state.usdToSyp;
    // The line total's own SYP hint (quantity x price), not the unit price's -
    // it now sits next to `item.lineTotalUsd` further down, not the per-unit
    // price.
    final sypText = formatSypApprox(item.lineTotalUsd, usdToSyp, l10n.currencySuffix);

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
                    Text(
                      name,
                      style: context.textTheme.titleSmall,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
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
                            '\$${item.unitPriceUsd}',
                            style: TextStyle(
                              decoration: TextDecoration.lineThrough,
                              color: AppColors.textSecondaryOf(context),
                              fontSize: 11.5,
                            ),
                          ),
                          Text(
                            '\$${item.discountPriceUsd}',
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
                        '\$${item.discountPriceUsd}',
                        style: TextStyle(
                          color: AppColors.primaryOf(context),
                          fontWeight: FontWeight.bold,
                          fontSize: 13,
                        ),
                      ),
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
              Expanded(
                child: Align(
                  alignment: AlignmentDirectional.centerEnd,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        '\$${item.lineTotalUsd}',
                        style: context.textTheme.titleSmall,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      if (sypText != null) SecondaryPriceHint(text: sypText),
                    ],
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
