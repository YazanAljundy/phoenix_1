import 'package:flutter/material.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_radius.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/widgets/custom_card.dart';
import 'package:phoenix/features/cart/data/models/cart_item.dart';

class CartItemTile extends StatelessWidget {
  const CartItemTile({
    super.key,
    required this.item,
    required this.onIncrement,
    required this.onDecrement,
    required this.onRemove,
  });

  final CartItem item;
  final VoidCallback onIncrement;
  final VoidCallback onDecrement;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';
    final name = isArabic ? item.nameAr : item.nameEn;

    return CustomCard(
      child: Row(
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
                  style: context.textTheme.titleMedium,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: AppSizes.spacingXSmall),
                if (item.hasOffer)
                  Wrap(
                    crossAxisAlignment: WrapCrossAlignment.center,
                    spacing: AppSizes.spacingSmall,
                    children: [
                      Text(
                        '${item.unitPrice} ${l10n.currencySuffix}',
                        style: TextStyle(
                          decoration: TextDecoration.lineThrough,
                          color: AppColors.textSecondaryOf(context),
                          fontSize: 12,
                        ),
                      ),
                      Text(
                        '${item.discountPrice} ${l10n.currencySuffix}',
                        style: TextStyle(
                          color: AppColors.secondaryOf(context),
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ],
                  )
                else
                  Text(
                    '${item.discountPrice} ${l10n.currencySuffix}',
                    style: TextStyle(
                      color: AppColors.primaryOf(context),
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                const SizedBox(height: AppSizes.spacingSmall),
                Row(
                  children: [
                    _QuantityButton(
                      icon: Icons.remove,
                      onTap: item.quantity > 1 ? onDecrement : null,
                    ),
                    SizedBox(
                      width: 36,
                      child: Center(
                        child: Text('${item.quantity}', style: context.textTheme.titleMedium),
                      ),
                    ),
                    _QuantityButton(
                      icon: Icons.add,
                      onTap: item.quantity < item.stockQuantity ? onIncrement : null,
                    ),
                    const Spacer(),
                    IconButton(
                      icon: Icon(Icons.delete_outline, color: AppColors.errorOf(context)),
                      onPressed: onRemove,
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _QuantityButton extends StatelessWidget {
  const _QuantityButton({required this.icon, required this.onTap});

  final IconData icon;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 32,
      height: 32,
      child: IconButton(
        padding: EdgeInsets.zero,
        style: IconButton.styleFrom(
          backgroundColor: AppColors.surfaceOf(context),
          shape: const RoundedRectangleBorder(borderRadius: AppRadius.small),
        ),
        icon: Icon(icon, size: 16),
        onPressed: onTap,
      ),
    );
  }
}

class _ItemImage extends StatelessWidget {
  const _ItemImage({required this.url});

  final String? url;

  @override
  Widget build(BuildContext context) {
    // TODO(seed-images): same placeholder note as ProductCard - see
    // features/catalog/presentation/widgets/product_card.dart.
    return ClipRRect(
      borderRadius: AppRadius.small,
      child: Container(
        width: 56,
        height: 56,
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
