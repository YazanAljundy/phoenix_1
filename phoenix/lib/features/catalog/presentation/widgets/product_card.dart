import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_radius.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/utils/currency_formatter.dart';
import 'package:phoenix/core/widgets/custom_card.dart';
import 'package:phoenix/core/widgets/secondary_price_hint.dart';
import 'package:phoenix/features/catalog/data/models/product_model.dart';
import 'package:phoenix/features/catalog/presentation/widgets/quantity_picker_sheet.dart';
import 'package:phoenix/features/exchange_rate/presentation/managers/exchange_rate_cubit.dart';

class ProductCard extends StatelessWidget {
  const ProductCard({super.key, required this.product, required this.onAdd});

  final ProductModel product;
  final ValueChanged<int> onAdd;

  Future<void> _handleAddTap(BuildContext context) async {
    final quantity = await showQuantityPickerSheet(context);
    if (quantity != null) {
      onAdd(quantity);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';
    final name = isArabic ? product.nameAr : (product.nameEn ?? product.nameAr);
    final manufacturer = isArabic ? product.manufacturerAr : (product.manufacturerEn ?? product.manufacturerAr);

    return Opacity(
      opacity: product.isAvailable ? 1.0 : 0.55,
      child: CustomCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _ProductImage(url: product.image),
                const SizedBox(width: AppSizes.spacingMedium),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        name,
                        style: context.textTheme.titleMedium,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: AppSizes.spacingXSmall),
                      Text(
                        manufacturer,
                        style: context.textTheme.bodyMedium?.copyWith(
                          color: AppColors.textSecondaryOf(context),
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: AppSizes.spacingSmall),
                      if (!product.isAvailable)
                        _UnavailableBadge()
                      else
                        _PriceDisplay(product: product),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: AppSizes.spacingMedium),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: product.isAvailable ? () => _handleAddTap(context) : null,
                icon: const Icon(Icons.add, size: 18),
                label: Text(l10n.addToCartButton),
                style: FilledButton.styleFrom(
                  backgroundColor: AppColors.primaryOf(context),
                  foregroundColor: Colors.white,
                  disabledBackgroundColor: AppColors.borderOf(context),
                  shape: const RoundedRectangleBorder(borderRadius: AppRadius.medium),
                  padding: const EdgeInsets.symmetric(vertical: 10),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PriceDisplay extends StatelessWidget {
  const _PriceDisplay({required this.product});

  final ProductModel product;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    // Section 15: discountPriceUsd already has any active product Offer AND
    // the warehouse's manufacturer discount stacked in server-side (see
    // product.viewmodel.js). The two-price (struck-through original +
    // discounted) treatment is reserved for an active Offer specifically -
    // a manufacturer-discount-only price (no Offer) shows as a single plain
    // number with no indication it was discounted at all.
    final usdToSyp = context.watch<ExchangeRateCubit>().state.usdToSyp;
    final sypText = formatSypApprox(product.discountPriceUsd, usdToSyp, l10n.currencySuffix);

    if (!product.hasActiveOffer) {
      return Wrap(
        crossAxisAlignment: WrapCrossAlignment.center,
        spacing: AppSizes.spacingXSmall,
        children: [
          Text(
            '\$${product.discountPriceUsd}',
            style: context.textTheme.titleMedium?.copyWith(
              color: AppColors.primaryOf(context),
            ),
          ),
          if (sypText != null) SecondaryPriceHint(text: sypText),
        ],
      );
    }

    return Wrap(
      crossAxisAlignment: WrapCrossAlignment.center,
      spacing: AppSizes.spacingSmall,
      children: [
        Text(
          '\$${product.priceUsd}',
          style: TextStyle(
            decoration: TextDecoration.lineThrough,
            color: AppColors.textSecondaryOf(context),
            fontSize: 13,
          ),
        ),
        Text(
          '\$${product.discountPriceUsd}',
          style: TextStyle(
            color: AppColors.secondaryOf(context),
            fontWeight: FontWeight.bold,
            fontSize: 16,
          ),
        ),
        if (sypText != null) SecondaryPriceHint(text: sypText),
      ],
    );
  }
}

class _UnavailableBadge extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: AppColors.errorOf(context).withValues(alpha: 0.12),
        borderRadius: AppRadius.small,
      ),
      child: Text(
        context.l10n.unavailableLabel,
        style: TextStyle(
          color: AppColors.errorOf(context),
          fontSize: 12,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

class _ProductImage extends StatelessWidget {
  const _ProductImage({required this.url});

  final String? url;

  @override
  Widget build(BuildContext context) {
    // TODO(seed-images): swap this placeholder for a real network image once
    // an image API (Unsplash/Pexels/Pixabay) is chosen (Section 14). Until
    // then `product.image` is always null, so this always renders the icon.
    return ClipRRect(
      borderRadius: AppRadius.small,
      child: Container(
        width: 64,
        height: 64,
        color: AppColors.surfaceOf(context),
        child: url == null || url!.isEmpty
            ? Icon(Icons.medication_outlined, color: AppColors.textSecondaryOf(context))
            : Image.network(
                url!,
                fit: BoxFit.cover,
                errorBuilder: (context, error, stackTrace) => Icon(
                  Icons.medication_outlined,
                  color: AppColors.textSecondaryOf(context),
                ),
              ),
      ),
    );
  }
}
