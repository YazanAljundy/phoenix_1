import 'package:flutter/material.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_radius.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/utils/date_formatter.dart';
import 'package:phoenix/core/widgets/custom_card.dart';
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
                    if (returnRequest.orderNumber != null)
                      Text(
                        l10n.orderNumberLabel(returnRequest.orderNumber.toString()),
                        style: context.textTheme.bodyMedium?.copyWith(
                          color: AppColors.textSecondaryOf(context),
                        ),
                      ),
                    const SizedBox(height: AppSizes.spacingXSmall),
                    Text(itemNames, style: context.textTheme.titleMedium),
                    const SizedBox(height: AppSizes.spacingXSmall),
                    Text(
                      DateFormatter.formatDateTime(returnRequest.createdAt),
                      style: context.textTheme.bodySmall?.copyWith(
                        color: AppColors.textSecondaryOf(context),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: AppSizes.spacingSmall),
              _ReturnStatusBadge(status: returnRequest.status),
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
              child: Text(
                '${l10n.returnRejectionNoteLabel}: ${returnRequest.rejectionNote}',
                style: context.textTheme.bodySmall?.copyWith(color: AppColors.errorOf(context)),
              ),
            ),
          ],
          if (returnRequest.isApproved && onViewReplacementOrder != null) ...[
            const SizedBox(height: AppSizes.spacingSmall),
            Align(
              alignment: AlignmentDirectional.centerStart,
              child: TextButton(
                onPressed: onViewReplacementOrder,
                child: Text(l10n.viewReplacementOrderButton),
              ),
            ),
          ],
          if (returnRequest.isPending && (onEdit != null || onDelete != null)) ...[
            const SizedBox(height: AppSizes.spacingXSmall),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                if (onEdit != null)
                  TextButton(onPressed: onEdit, child: Text(l10n.editButton)),
                if (onDelete != null)
                  TextButton(
                    onPressed: onDelete,
                    style: TextButton.styleFrom(foregroundColor: AppColors.errorOf(context)),
                    child: Text(l10n.deleteReturnButton),
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _ReturnStatusBadge extends StatelessWidget {
  const _ReturnStatusBadge({required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final color = switch (status) {
      'approved' => AppColors.secondaryOf(context),
      'rejected' => AppColors.errorOf(context),
      _ => AppColors.primaryOf(context),
    };

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
        returnStatusLabel(l10n, status),
        style: context.textTheme.bodySmall?.copyWith(color: color, fontWeight: FontWeight.w600),
      ),
    );
  }
}
