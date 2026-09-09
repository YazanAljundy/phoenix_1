import 'package:flutter/material.dart';
import 'package:feniq/core/constants/app_colors.dart';
import 'package:feniq/core/constants/app_radius.dart';
import 'package:feniq/core/constants/app_sizes.dart';
import 'package:feniq/core/extensions/build_context_extensions.dart';
import 'package:feniq/core/utils/currency_formatter.dart';
import 'package:feniq/core/utils/date_formatter.dart';
import 'package:feniq/core/widgets/custom_card.dart';
import 'package:feniq/core/widgets/status_badge.dart';
import 'package:feniq/features/returns/data/models/return_model.dart';
import 'package:feniq/features/returns/presentation/utils/return_labels.dart';

class ReturnListTile extends StatelessWidget {
  const ReturnListTile({
    super.key,
    required this.returnRequest,
    this.onEdit,
    this.onDelete,
  });

  final ReturnModel returnRequest;
  // Non-null (and shown) only while status='pending' - once decided, the
  // record is final (Section 6.9).
  final VoidCallback? onEdit;
  final VoidCallback? onDelete;

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
          // Money-Flow V2: an approved return credits the pharmacy's account
          // rather than creating a replacement order, so what it shows is what
          // it was worth. SYP is the settled figure - it is already the amount
          // that moved the balance, so it is rendered directly rather than
          // converted from USD at whatever the rate is today.
          if (returnRequest.isApproved && returnRequest.creditSyp != null) ...[
            const SizedBox(height: AppSizes.spacingXSmall),
            Align(
              alignment: AlignmentDirectional.centerStart,
              child: Text(
                l10n.returnCreditedLabel(
                  formatSyp(returnRequest.creditSyp!, l10n.currencySuffix),
                ),
                style: context.textTheme.bodyMedium?.copyWith(
                  color: AppColors.secondaryOf(context),
                  fontWeight: FontWeight.w700,
                ),
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
