import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_padding.dart';
import 'package:phoenix/core/constants/app_radius.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/error/error_translator.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/utils/date_formatter.dart';
import 'package:phoenix/core/widgets/app_loading.dart';
import 'package:phoenix/core/widgets/custom_card.dart';
import 'package:phoenix/core/widgets/failure_widget.dart';
import 'package:phoenix/core/widgets/status_badge.dart';
import 'package:phoenix/features/complaints/data/models/complaint_model.dart';
import 'package:phoenix/features/complaints/presentation/managers/complaint_detail_cubit.dart';
import 'package:phoenix/features/complaints/presentation/managers/complaint_detail_state.dart';
import 'package:phoenix/features/complaints/presentation/utils/complaint_labels.dart';

// Section 1: the full complaint - reached from "My Complaints" or from tapping
// the "your complaint got a reply" notification. Read-only: the pharmacy never
// edits or changes a complaint's status.
class ComplaintDetailView extends StatelessWidget {
  const ComplaintDetailView({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return Scaffold(
      appBar: AppBar(
        backgroundColor: AppColors.navyOf(context),
        foregroundColor: Colors.white,
        title: Text(l10n.complaintDetailTitle),
      ),
      body: BlocBuilder<ComplaintDetailCubit, ComplaintDetailState>(
        builder: (context, state) {
          if (state.status == ComplaintDetailStatus.initial ||
              (state.status == ComplaintDetailStatus.loading && state.complaint == null)) {
            return const AppLoading();
          }
          if (state.status == ComplaintDetailStatus.error && state.complaint == null) {
            return FailureWidget(
              message: translateErrorCode(
                l10n,
                state.errorCode,
                state.errorMessage ?? l10n.errorState,
              ),
              onRetry: () => context.read<ComplaintDetailCubit>().load(),
            );
          }

          final complaint = state.complaint!;
          return RefreshIndicator(
            onRefresh: () => context.read<ComplaintDetailCubit>().load(),
            child: ListView(
              padding: AppPadding.screen,
              children: [
                _HeaderCard(complaint: complaint),
                // Section 8: general complaints carry no warehouse - no empty
                // warehouse block for them.
                if (complaint.warehouse != null) ...[
                  const SizedBox(height: AppSizes.spacingMedium),
                  _WarehouseCard(complaint: complaint),
                ],
                const SizedBox(height: AppSizes.spacingMedium),
                _SectionHeader(l10n.complaintYourComplaintTitle),
                const SizedBox(height: AppSizes.spacingSmall),
                _ComplaintBodyCard(complaint: complaint),
                const SizedBox(height: AppSizes.spacingMedium),
                _SectionHeader(l10n.complaintResponseTitle),
                const SizedBox(height: AppSizes.spacingSmall),
                _ResponseCard(complaint: complaint),
                const SizedBox(height: AppSizes.spacingLarge),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          width: 3,
          height: 15,
          decoration: BoxDecoration(
            color: AppColors.navyOf(context),
            borderRadius: BorderRadius.circular(2),
          ),
        ),
        const SizedBox(width: AppSizes.spacingSmall),
        Expanded(
          child: Text(text, style: context.textTheme.titleMedium, maxLines: 1, overflow: TextOverflow.ellipsis),
        ),
      ],
    );
  }
}

class _HeaderCard extends StatelessWidget {
  const _HeaderCard({required this.complaint});

  final ComplaintModel complaint;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return CustomCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(
                  l10n.complaintNumberLabel(complaint.complaintNumber.toString()),
                  style: context.textTheme.bodySmall?.copyWith(
                    color: AppColors.textSecondaryOf(context),
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              StatusBadge(
                label: complaintStatusLabel(l10n, complaint.status),
                tone: complaintStatusTone(complaint.status),
              ),
            ],
          ),
          const SizedBox(height: AppSizes.spacingSmall),
          Text(complaint.subject, style: context.textTheme.titleLarge),
          const SizedBox(height: AppSizes.spacingSmall),
          _MetaRow(
            icon: Icons.event,
            label: l10n.complaintFiledOnLabel(DateFormatter.formatDateTime(complaint.createdAt)),
          ),
          if (complaint.relatedOrderNumber != null) ...[
            const SizedBox(height: AppSizes.spacingXSmall),
            _MetaRow(
              icon: Icons.receipt_long_outlined,
              label: l10n.complaintRelatedOrderLabel(complaint.relatedOrderNumber.toString()),
            ),
          ],
        ],
      ),
    );
  }
}

class _MetaRow extends StatelessWidget {
  const _MetaRow({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, size: 15, color: AppColors.textSecondaryOf(context)),
        const SizedBox(width: 6),
        Expanded(
          child: Text(
            label,
            style: context.textTheme.bodySmall?.copyWith(color: AppColors.textSecondaryOf(context)),
          ),
        ),
      ],
    );
  }
}

class _WarehouseCard extends StatelessWidget {
  const _WarehouseCard({required this.complaint});

  final ComplaintModel complaint;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final warehouse = complaint.warehouse;
    if (warehouse == null) return const SizedBox.shrink();
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';
    final name = isArabic ? warehouse.nameAr : warehouse.nameEn;

    return CustomCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            l10n.complaintAboutWarehouseLabel,
            style: context.textTheme.bodySmall?.copyWith(
              color: AppColors.textSecondaryOf(context),
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: AppSizes.spacingXSmall),
          Row(
            children: [
              Icon(Icons.storefront_rounded, size: 18, color: AppColors.navyOf(context)),
              const SizedBox(width: AppSizes.spacingSmall),
              Expanded(
                child: Text(
                  name,
                  style: context.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
                ),
              ),
            ],
          ),
          if ((warehouse.city ?? '').isNotEmpty) ...[
            const SizedBox(height: AppSizes.spacingSmall),
            _MetaRow(icon: Icons.location_on_outlined, label: warehouse.city!),
          ],
          if ((warehouse.phone ?? '').isNotEmpty) ...[
            const SizedBox(height: AppSizes.spacingXSmall),
            _MetaRow(icon: Icons.phone_outlined, label: warehouse.phone!),
          ],
        ],
      ),
    );
  }
}

class _ComplaintBodyCard extends StatelessWidget {
  const _ComplaintBodyCard({required this.complaint});

  final ComplaintModel complaint;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return CustomCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SelectableText(
            complaint.description,
            style: context.textTheme.bodyLarge?.copyWith(height: 1.6),
          ),
          if ((complaint.extraDetails ?? '').isNotEmpty) ...[
            const SizedBox(height: AppSizes.spacingMedium),
            Divider(height: 1, color: AppColors.borderOf(context)),
            const SizedBox(height: AppSizes.spacingMedium),
            Text(
              l10n.complaintExtraDetailsLabel,
              style: context.textTheme.bodySmall?.copyWith(
                color: AppColors.textSecondaryOf(context),
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: AppSizes.spacingXSmall),
            SelectableText(
              complaint.extraDetails!,
              style: context.textTheme.bodyMedium?.copyWith(height: 1.5),
            ),
          ],
        ],
      ),
    );
  }
}

class _ResponseCard extends StatelessWidget {
  const _ResponseCard({required this.complaint});

  final ComplaintModel complaint;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    if (!complaint.hasResponse) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.all(AppSizes.spacingMedium),
        decoration: BoxDecoration(
          color: AppColors.surfaceOf(context),
          borderRadius: AppRadius.medium,
          border: Border.all(color: AppColors.borderOf(context)),
        ),
        child: Row(
          children: [
            Icon(Icons.hourglass_empty_rounded, size: 18, color: AppColors.textSecondaryOf(context)),
            const SizedBox(width: AppSizes.spacingSmall),
            Expanded(
              child: Text(
                l10n.complaintNoResponseYet,
                style: context.textTheme.bodyMedium?.copyWith(
                  color: AppColors.textSecondaryOf(context),
                ),
              ),
            ),
          ],
        ),
      );
    }

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSizes.spacingMedium),
      decoration: BoxDecoration(
        color: AppColors.secondaryOf(context).withValues(alpha: 0.08),
        borderRadius: AppRadius.medium,
        border: Border.all(color: AppColors.secondaryOf(context).withValues(alpha: 0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.support_agent_rounded, size: 18, color: AppColors.secondaryOf(context)),
              const SizedBox(width: AppSizes.spacingSmall),
              Text(
                l10n.complaintAdminResponseLabel,
                style: context.textTheme.titleSmall?.copyWith(
                  color: AppColors.secondaryOf(context),
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSizes.spacingSmall),
          SelectableText(
            complaint.adminResponse!,
            style: context.textTheme.bodyLarge?.copyWith(height: 1.6),
          ),
          const SizedBox(height: AppSizes.spacingSmall),
          if (complaint.respondedAt != null)
            _MetaRow(
              icon: Icons.schedule,
              label: l10n.complaintRespondedOnLabel(
                DateFormatter.formatDateTime(complaint.respondedAt!),
              ),
            ),
          if ((complaint.respondedByName ?? '').isNotEmpty) ...[
            const SizedBox(height: AppSizes.spacingXSmall),
            _MetaRow(
              icon: Icons.badge_outlined,
              label: l10n.complaintRespondedByLabel(complaint.respondedByName!),
            ),
          ],
        ],
      ),
    );
  }
}
