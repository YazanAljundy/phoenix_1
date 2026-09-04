import 'package:flutter/material.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_radius.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/utils/date_formatter.dart';
import 'package:phoenix/core/widgets/custom_card.dart';
import 'package:phoenix/core/widgets/status_badge.dart';
import 'package:phoenix/features/returns/data/models/return_model.dart';
import 'package:phoenix/features/returns/presentation/utils/return_labels.dart';

class ReturnListTile extends StatelessWidget {
  const ReturnListTile({
    super.key,
    required this.returnRequest,
    this.onEdit,
    this.onDelete,
    this.onViewReplacementOrder,
  });

  final ReturnModel returnRequest;
  // Non-null (and shown) only while status='pending' - once decided, the
  // record is final (Section 6.9).
  final VoidCallback? onEdit;
  final VoidCallback? onDelete;
  final VoidCallback? onViewReplacementOrder;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';
    final itemNames = returnRequest.items
        .map((item) => (isArabic ? item.productNameAr : (item.productNameEn ?? item.productNameAr)) ?? '')
        .where((name) => name.isNotEmpty)
        .join(isArabic ? '، ' : ', ');
    final reasonTypes = returnRequest.items.map((item) => item.reasonType).toSet();
    final reasonText = reasonTypes.length == 1
        ? returnReasonLabel(l10n, reasonTypes.first)
        : l10n.multipleReasonsLabel;

    return CustomCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (returnRequest.orderNumber != null) ...[
                      Row(
                        children: [
                          Icon(
                            Icons.receipt_long_outlined,
                            size: 14,
                            color: AppColors.textSecondaryOf(context),
                          ),
                          const SizedBox(width: 4),
                          Flexible(
                            child: Text(
                              l10n.orderNumberLabel(returnRequest.orderNumber.toString()),
                              style: context.textTheme.bodySmall?.copyWith(
                                color: AppColors.textSecondaryOf(context),
                                fontWeight: FontWeight.w700,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: AppSizes.spacingXSmall),
                    ],
                    Text(
                      itemNames,
                      style: context.textTheme.titleMedium,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
              const SizedBox(width: AppSizes.spacingSmall),
              StatusBadge(
                label: returnStatusLabel(l10n, returnRequest.status),
                tone: _returnStatusTone(returnRequest.status),
              ),
            ],
          ),
          const SizedBox(height: AppSizes.spacingSmall),
          Row(
            children: [
              Icon(Icons.event_outlined, size: 14, color: AppColors.textSecondaryOf(context)),
              const SizedBox(width: 4),
              Expanded(
                child: Text(
                  DateFormatter.formatDateTime(returnRequest.createdAt),
                  style: context.textTheme.bodySmall?.copyWith(
                    color: AppColors.textSecondaryOf(context),
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const SizedBox(width: AppSizes.spacingSmall),
              Flexible(
                child: Text(
                  reasonText,
                  textAlign: TextAlign.end,
                  style: context.textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w700),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
          if (returnRequest.isRejected && returnRequest.rejectionNote != null) ...[
            const SizedBox(height: AppSizes.spacingSmall),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(AppSizes.spacingSmall),
              decoration: BoxDecoration(
                color: AppColors.errorOf(context).withValues(alpha: 0.08),
                borderRadius: AppRadius.small,
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(Icons.info_outline_rounded, size: 15, color: AppColors.errorOf(context)),
                  const SizedBox(width: AppSizes.spacingXSmall),
                  Expanded(
                    child: Text(
                      '${l10n.returnRejectionNoteLabel}: ${returnRequest.rejectionNote}',
                      style: context.textTheme.bodySmall?.copyWith(color: AppColors.errorOf(context)),
                    ),
                  ),
                ],
              ),
            ),
          ],
          if (returnRequest.isApproved && onViewReplacementOrder != null) ...[
            const SizedBox(height: AppSizes.spacingXSmall),
            Align(
              alignment: AlignmentDirectional.centerStart,
              child: TextButton.icon(
                onPressed: onViewReplacementOrder,
                style: TextButton.styleFrom(
                  padding: EdgeInsets.zero,
                  minimumSize: const Size(0, 36),
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
                icon: const Icon(Icons.open_in_new_rounded, size: 16),
                label: Text(l10n.viewReplacementOrderButton),
              ),
            ),
          ],
          if (returnRequest.isPending && (onEdit != null || onDelete != null)) ...[
            const SizedBox(height: AppSizes.spacingSmall),
            Divider(color: AppColors.borderOf(context), height: 1),
            const SizedBox(height: AppSizes.spacingXSmall),
            SizedBox(
              width: double.infinity,
              child: Wrap(
                alignment: WrapAlignment.end,
                spacing: AppSizes.spacingXSmall,
                children: [
                  if (onEdit != null)
                    TextButton.icon(
                      onPressed: onEdit,
                      icon: const Icon(Icons.edit_outlined, size: 16),
                      label: Text(l10n.editButton),
                    ),
                  if (onDelete != null)
                    TextButton.icon(
                      onPressed: onDelete,
                      style: TextButton.styleFrom(foregroundColor: AppColors.errorOf(context)),
                      icon: const Icon(Icons.delete_outline_rounded, size: 16),
                      label: Text(l10n.deleteReturnButton),
                    ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

StatusBadgeTone _returnStatusTone(String status) => switch (status) {
  'approved' => StatusBadgeTone.success,
  'rejected' => StatusBadgeTone.danger,
  _ => StatusBadgeTone.pending,
};
