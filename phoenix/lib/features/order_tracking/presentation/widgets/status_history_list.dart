import 'package:flutter/material.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/utils/date_formatter.dart';
import 'package:phoenix/core/widgets/custom_card.dart';
import 'package:phoenix/features/cart/data/models/order_status_history_entry.dart';
import 'package:phoenix/features/cart/presentation/utils/order_status_label.dart';

// Section 6.7: "built on the order_status_history table (every status
// change has a recorded time - necessary for accurate tracking display)" -
// the progress bar shows *where things are now*, this shows *when it got
// there*. Rendered as a connected vertical timeline (dot + line between
// entries) rather than a flat list, to read as one continuous history.
class StatusHistoryList extends StatelessWidget {
  const StatusHistoryList({super.key, required this.entries});

  final List<OrderStatusHistoryEntry> entries;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(l10n.statusHistoryTitle, style: context.textTheme.titleMedium),
        const SizedBox(height: AppSizes.spacingSmall),
        CustomCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (var i = 0; i < entries.length; i++)
                _HistoryRow(
                  entry: entries[i],
                  isLast: i == entries.length - 1,
                ),
            ],
          ),
        ),
      ],
    );
  }
}

class _HistoryRow extends StatelessWidget {
  const _HistoryRow({required this.entry, required this.isLast});

  final OrderStatusHistoryEntry entry;
  final bool isLast;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: isLast ? 0 : AppSizes.spacingMedium),
      // IntrinsicHeight gives the Row a bounded height (matching its tallest
      // child) - without it, the dot+line Column's Expanded has nothing
      // finite to divide, since this Row sits inside a Column inside a
      // scroll view (unbounded height), which crashes the layout entirely.
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Column(
              children: [
                Icon(Icons.circle, size: 10, color: AppColors.secondaryOf(context)),
                if (!isLast)
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 2),
                      child: Container(width: 2, color: AppColors.borderOf(context)),
                    ),
                  ),
              ],
            ),
            const SizedBox(width: AppSizes.spacingMedium),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.only(top: 1),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      orderStatusLabel(context.l10n, entry.status),
                      style: context.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.bold),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      DateFormatter.formatDateTime(entry.changedAt),
                      style: context.textTheme.bodySmall?.copyWith(
                        color: AppColors.textSecondaryOf(context),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
