import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_radius.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/utils/currency_formatter.dart';
import 'package:phoenix/core/widgets/custom_card.dart';
import 'package:phoenix/core/widgets/secondary_price_hint.dart';
import 'package:phoenix/core/widgets/status_badge.dart';
import 'package:phoenix/features/catalog/data/models/product_model.dart';
import 'package:phoenix/features/catalog/presentation/widgets/quantity_picker_sheet.dart';
import 'package:phoenix/features/exchange_rate/presentation/managers/exchange_rate_cubit.dart';

// Two layouts sharing the same data/logic: a grid tile (image on top,
// details below - the default) and a compact list row, toggled from
// CatalogView. Both keep the exact same rules: unavailable products stay
// visible but faded (never hidden), and tapping "add" always goes through
// the quantity picker sheet.
class ProductCard extends StatelessWidget {
  const ProductCard({super.key, required this.product, required this.onAdd, this.isGrid = true});

  final ProductModel product;
  final ValueChanged<int> onAdd;
  final bool isGrid;

  Future<void> _handleAddTap(BuildContext context) async {
    final quantity = await showQuantityPickerSheet(context);
    if (quantity != null) {
      onAdd(quantity);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Opacity(
      opacity: product.isAvailable ? 1.0 : 0.55,
      child: isGrid ? _GridCard(product: product, onAddTap: () => _handleAddTap(context)) : _ListRow(
        product: product,
        onAddTap: () => _handleAddTap(context),
      ),
    );
  }
}

class _GridCard extends StatelessWidget {
  const _GridCard({required this.product, required this.onAddTap});

  final ProductModel product;
  final VoidCallback onAddTap;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';
    final name = isArabic ? product.nameAr : (product.nameEn ?? product.nameAr);
    final manufacturer = isArabic ? product.manufacturerAr : (product.manufacturerEn ?? product.manufacturerAr);

    return CustomCard(
      padding: EdgeInsets.zero,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Stack(
            children: [
              ClipRRect(
                borderRadius: BorderRadius.vertical(top: AppRadius.large.topLeft),
                child: _ProductImage(url: product.image, aspectRatio: 1.25),
              ),
              if (!product.isAvailable)
                PositionedDirectional(
                  top: AppSizes.spacingSmall,
                  end: AppSizes.spacingSmall,
                  child: StatusBadge(label: l10n.unavailableLabel, tone: StatusBadgeTone.danger),
                )
              else if (product.hasActiveOffer)
                PositionedDirectional(
                  top: AppSizes.spacingSmall,
                  end: AppSizes.spacingSmall,
                  child: StatusBadge(label: l10n.offerBadgeLabel, tone: StatusBadgeTone.pending),
                ),
            ],
          ),
          Padding(
            padding: const EdgeInsets.all(AppSizes.spacingSmall),
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
                  manufacturer,
                  style: context.textTheme.bodySmall?.copyWith(color: AppColors.textSecondaryOf(context)),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: AppSizes.spacingXSmall),
                _PriceDisplay(product: product),
                const SizedBox(height: AppSizes.spacingSmall),
                _AddButton(available: product.isAvailable, onTap: onAddTap),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ListRow extends StatelessWidget {
  const _ListRow({required this.product, required this.onAddTap});

  final ProductModel product;
  final VoidCallback onAddTap;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';
    final name = isArabic ? product.nameAr : (product.nameEn ?? product.nameAr);
    final manufacturer = isArabic ? product.manufacturerAr : (product.manufacturerEn ?? product.manufacturerAr);

    return CustomCard(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          ClipRRect(
            borderRadius: AppRadius.small,
            child: _ProductImage(url: product.image, size: 56),
          ),
          const SizedBox(width: AppSizes.spacingMedium),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name,
                  style: context.textTheme.titleSmall,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 2),
                Text(
                  manufacturer,
                  style: context.textTheme.bodySmall?.copyWith(color: AppColors.textSecondaryOf(context)),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: AppSizes.spacingXSmall),
                _PriceDisplay(product: product),
              ],
            ),
          ),
          const SizedBox(width: AppSizes.spacingSmall),
          if (!product.isAvailable)
            StatusBadge(label: l10n.unavailableLabel, tone: StatusBadgeTone.danger)
          else
            _AddButton(available: true, onTap: onAddTap, compact: true),
        ],
      ),
    );
  }
}

class _AddButton extends StatelessWidget {
  const _AddButton({required this.available, required this.onTap, this.compact = false});

  final bool available;
  final VoidCallback onTap;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final style = FilledButton.styleFrom(
      backgroundColor: AppColors.primaryOf(context).withValues(alpha: 0.12),
      foregroundColor: AppColors.primaryOf(context),
      disabledBackgroundColor: AppColors.borderOf(context),
      shape: compact
          ? const CircleBorder()
          : const RoundedRectangleBorder(borderRadius: AppRadius.small),
      padding: compact ? EdgeInsets.zero : const EdgeInsets.symmetric(vertical: 8),
      elevation: 0,
    );

    if (compact) {
      return SizedBox(
        width: 40,
        height: 40,
        child: FilledButton(
          onPressed: available ? onTap : null,
          style: style,
          child: const Icon(Icons.add, size: 20),
        ),
      );
    }

    return SizedBox(
      width: double.infinity,
      child: FilledButton.icon(
        onPressed: available ? onTap : null,
        icon: const Icon(Icons.add_shopping_cart_outlined, size: 16),
        label: Text(l10n.addToCartButton, style: const TextStyle(fontSize: 12)),
        style: style,
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
            style: context.textTheme.titleSmall?.copyWith(
              color: AppColors.primaryOf(context),
              fontSize: 15,
            ),
          ),
          if (sypText != null) SecondaryPriceHint(text: sypText),
        ],
      );
    }

    return Wrap(
      crossAxisAlignment: WrapCrossAlignment.center,
      spacing: AppSizes.spacingXSmall,
      children: [
        Text(
          '\$${product.priceUsd}',
          style: TextStyle(
            decoration: TextDecoration.lineThrough,
            color: AppColors.textSecondaryOf(context),
            fontSize: 11.5,
          ),
        ),
        Text(
          '\$${product.discountPriceUsd}',
          style: TextStyle(
            color: AppColors.secondaryOf(context),
            fontWeight: FontWeight.bold,
            fontSize: 15,
          ),
        ),
        if (sypText != null) SecondaryPriceHint(text: sypText),
      ],
    );
  }
}

class _ProductImage extends StatelessWidget {
  const _ProductImage({required this.url, this.aspectRatio, this.size});

  final String? url;
  final double? aspectRatio;
  final double? size;

  @override
  Widget build(BuildContext context) {
    // TODO(seed-images): swap this placeholder for a real network image once
    // an image API (Unsplash/Pexels/Pixabay) is chosen (Section 14). Until
    // then `product.image` is always null, so this always renders the icon.
    final placeholder = Container(
      color: AppColors.surfaceOf(context),
      child: Icon(Icons.medication_outlined, color: AppColors.textSecondaryOf(context)),
    );
    final image = url == null || url!.isEmpty
        ? placeholder
        : Image.network(
            url!,
            fit: BoxFit.cover,
            errorBuilder: (context, error, stackTrace) => placeholder,
          );

    if (size != null) {
      return SizedBox(width: size, height: size, child: image);
    }
    return AspectRatio(aspectRatio: aspectRatio!, child: image);
  }
}
