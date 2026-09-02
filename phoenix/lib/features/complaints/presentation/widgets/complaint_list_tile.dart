import 'package:flutter/material.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/utils/date_formatter.dart';
import 'package:phoenix/core/widgets/custom_card.dart';
import 'package:phoenix/core/widgets/status_badge.dart';
import 'package:phoenix/features/complaints/data/models/complaint_model.dart';
import 'package:phoenix/features/complaints/presentation/utils/complaint_labels.dart';

// One row in "My Complaints" (Section 1). Shows the complaint number, its
// context (general / a warehouse / an order), the subject, the status pill,
// when it was filed, and a subtle "a reply is waiting" hint once the admin
// has answered.
class ComplaintListTile extends StatelessWidget {
  const ComplaintListTile({super.key, required this.complaint, required this.onTap});

  final ComplaintModel complaint;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';
    final warehouseName = complaint.warehouse == null
        ? ''
        : (isArabic ? complaint.warehouse!.nameAr : complaint.warehouse!.nameEn);

    return CustomCard(
      onTap: onTap,
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
                    Text(
                      l10n.complaintNumberLabel(complaint.complaintNumber.toString()),
                      style: context.textTheme.bodySmall?.copyWith(
                        color: AppColors.textSecondaryOf(context),
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: AppSizes.spacingXSmall),
                    Text(
                      complaint.subject,
                      style: context.textTheme.titleMedium,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
              const SizedBox(width: AppSizes.spacingSmall),
              StatusBadge(
                label: complaintStatusLabel(l10n, complaint.status),
                tone: complaintStatusTone(complaint.status),
              ),
            ],
          ),
          const SizedBox(height: AppSizes.spacingSmall),
          _contextLine(context, complaint, warehouseName),
          const SizedBox(height: AppSizes.spacingSmall),
          Row(
            children: [
              Icon(Icons.event, size: 15, color: AppColors.textSecondaryOf(context)),
              const SizedBox(width: 4),
              Text(
                DateFormatter.formatDateTime(complaint.createdAt),
                style: context.textTheme.bodySmall?.copyWith(
                  color: AppColors.textSecondaryOf(context),
                ),
              ),
              const Spacer(),
              if (complaint.hasResponse)
                Row(
                  children: [
                    Icon(Icons.mark_chat_read_outlined, size: 15, color: AppColors.secondaryOf(context)),
                    const SizedBox(width: 4),
                    Text(
                      l10n.complaintHasResponseHint,
                      style: context.textTheme.bodySmall?.copyWith(
                        color: AppColors.secondaryOf(context),
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
            ],
          ),
        ],
      ),
    );
  }

  // One quiet line describing what the complaint is about:
  //   general   -> "General complaint"
  //   warehouse -> the warehouse name
  //   order     -> "Order #N" (+ warehouse name when known)
  Widget _contextLine(BuildContext context, ComplaintModel complaint, String warehouseName) {
    final l10n = context.l10n;
    final (IconData icon, String text) = switch (complaint.context) {
      ComplaintContext.general => (Icons.support_agent_outlined, l10n.complaintContextGeneral),
      ComplaintContext.warehouse => (Icons.storefront_outlined, warehouseName),
      ComplaintContext.order => (
        Icons.receipt_long_outlined,
        [
          l10n.orderNumberLabel((complaint.relatedOrderNumber ?? 0).toString()),
          if (warehouseName.isNotEmpty) warehouseName,
        ].join(' · '),
      ),
    };

    return Row(
      children: [
        Icon(icon, size: 15, color: AppColors.textSecondaryOf(context)),
        const SizedBox(width: 4),
        Expanded(
          child: Text(
            text,
            style: context.textTheme.bodySmall?.copyWith(color: AppColors.textSecondaryOf(context)),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }
}
