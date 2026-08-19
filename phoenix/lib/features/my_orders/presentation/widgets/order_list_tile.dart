import 'package:flutter/material.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_radius.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/utils/date_formatter.dart';
import 'package:phoenix/core/widgets/custom_card.dart';
import 'package:phoenix/features/cart/data/models/order_model.dart';
import 'package:phoenix/features/cart/presentation/utils/order_status_label.dart';

class OrderListTile extends StatelessWidget {
  const OrderListTile({super.key, required this.order, required this.onTap});

  final OrderModel order;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';
    final warehouseName = isArabic ? order.warehouseNameAr : order.warehouseNameEn;

    return CustomCard(
      onTap: onTap,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  l10n.orderNumberLabel(order.orderNumber.toString()),
                  style: context.textTheme.titleMedium,
                ),
                if (warehouseName != null) ...[
                  const SizedBox(height: AppSizes.spacingXSmall),
                  Text(
                    warehouseName,
                    style: context.textTheme.bodyMedium?.copyWith(
                      color: AppColors.textSecondaryOf(context),
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
                if (order.createdAt != null) ...[
                  const SizedBox(height: AppSizes.spacingXSmall),
                  Text(
                    DateFormatter.formatDateTime(order.createdAt!),
                    style: context.textTheme.bodySmall?.copyWith(
                      color: AppColors.textSecondaryOf(context),
                    ),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(width: AppSizes.spacingSmall),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              _StatusBadge(status: order.status),
              const SizedBox(height: AppSizes.spacingSmall),
              Text(
                '${order.finalPrice} ${l10n.currencySuffix}',
                style: context.textTheme.titleMedium?.copyWith(
                  color: AppColors.primaryOf(context),
                  fontWeight: FontWeight.bold,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _StatusBadge extends StatelessWidget {
  const _StatusBadge({required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final Color color;
    switch (status) {
      case 'delivered':
        color = AppColors.secondaryOf(context);
        break;
      case 'cancelled':
        color = AppColors.errorOf(context);
        break;
      default:
        color = AppColors.primaryOf(context);
    }

    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSizes.spacingSmall,
        vertical: AppSizes.spacingXSmall,
      ),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: AppRadius.full,
      ),
      child: Text(
        orderStatusLabel(context.l10n, status),
        style: context.textTheme.bodySmall?.copyWith(color: color, fontWeight: FontWeight.w600),
      ),
    );
  }
}
