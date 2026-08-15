import 'package:flutter/material.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/utils/date_formatter.dart';
import 'package:phoenix/features/cart/data/models/order_status_history_entry.dart';
import 'package:phoenix/features/cart/presentation/utils/order_status_label.dart';

// Section 6.7: "built on the order_status_history table (every status
// change has a recorded time - necessary for accurate tracking display)" -
// the progress bar shows *where things are now*, this shows *when it got
// there*.
class StatusHistoryList extends StatelessWidget {
  const StatusHistoryList({super.key, required this.entries});

  final List<OrderStatusHistoryEntry> entries;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: entries.map((entry) {
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: AppSizes.spacingXSmall),
          child: Row(
            children: [
              Icon(
                Icons.circle,
                size: 8,
                color: AppColors.secondaryOf(context),
              ),
              const SizedBox(width: AppSizes.spacingSmall),
              Expanded(
                child: Text(
                  orderStatusLabel(context.l10n, entry.status),
                  style: context.textTheme.bodyMedium,
                ),
              ),
              Text(
                DateFormatter.formatDateTime(entry.changedAt),
                style: context.textTheme.bodyMedium?.copyWith(
                  color: AppColors.textSecondaryOf(context),
                  fontSize: 12,
                ),
              ),
            ],
          ),
        );
      }).toList(),
    );
  }
}
