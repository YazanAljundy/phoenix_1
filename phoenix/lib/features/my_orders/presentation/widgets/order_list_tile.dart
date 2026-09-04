import 'package:flutter/material.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/utils/currency_formatter.dart';
import 'package:phoenix/core/utils/date_formatter.dart';
import 'package:phoenix/core/widgets/custom_card.dart';
import 'package:phoenix/core/widgets/status_badge.dart';
import 'package:phoenix/features/cart/data/models/order_model.dart';
import 'package:phoenix/features/cart/presentation/utils/order_status_label.dart';
import 'package:phoenix/features/cart/presentation/widgets/reorder_button.dart';

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
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
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
                      Row(
                        children: [
                          Icon(
                            Icons.storefront_outlined,
                            size: 14,
                            color: AppColors.textSecondaryOf(context),
                          ),
                          const SizedBox(width: 4),
                          Flexible(
                            child: Text(
                              warehouseName,
                              style: context.textTheme.bodyMedium?.copyWith(
                                color: AppColors.textSecondaryOf(context),
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ],
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
                  StatusBadge(label: orderStatusLabel(l10n, order.status), tone: _orderStatusTone(order.status)),
                  const SizedBox(height: AppSizes.spacingSmall),
                  Row(
                    children: [
                      Text(
                        formatSyp(order.finalPrice, l10n.currencySuffix),
                        style: context.textTheme.titleMedium?.copyWith(
                          color: AppColors.primaryOf(context),
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      Icon(Icons.chevron_right, size: AppSizes.iconSizeSmall, color: AppColors.textSecondaryOf(context)),
                    ],
                  ),
                ],
              ),
            ],
          ),
          // Section: "Reorder" - only a completed (delivered) order can be
          // copied into a fresh cart. Row above stays tappable (-> tracking);
          // this is a separate explicit action.
          if (order.isReorderable) ...[
            const SizedBox(height: AppSizes.spacingSmall),
            Align(
              alignment: AlignmentDirectional.centerEnd,
              child: ReorderButton(orderId: order.id, dense: true),
            ),
          ],
        ],
      ),
    );
  }
}

// Same status-to-color grouping the order-tracking progress bar and the
// warehouse panel already use: pending -> orange, delivered -> green,
// cancelled -> red, everything in between (confirmed/preparing/out for
// delivery - already in progress, not yet at a terminal state) -> navy.
StatusBadgeTone _orderStatusTone(String status) {
  switch (status) {
    case 'delivered':
      return StatusBadgeTone.success;
    case 'cancelled':
      return StatusBadgeTone.danger;
    case 'pending':
      return StatusBadgeTone.pending;
    default:
      return StatusBadgeTone.info;
  }
}
