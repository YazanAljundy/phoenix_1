import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_padding.dart';
import 'package:phoenix/core/constants/app_radius.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/error/error_translator.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/widgets/app_snackbar.dart';
import 'package:phoenix/core/widgets/app_text_field.dart';
import 'package:phoenix/core/widgets/primary_button.dart';
import 'package:phoenix/features/complaints/data/models/complaint_model.dart';
import 'package:phoenix/features/complaints/presentation/managers/submit_complaint_cubit.dart';
import 'package:phoenix/features/complaints/presentation/managers/submit_complaint_state.dart';

// Section 17: context-aware, not form-driven. There is no "complaint type"
// picker and no warehouse dropdown - the screen is opened from Profile
// (general), a warehouse page (warehouse), or order tracking (order), and it
// just shows the fixed context plus the subject/description fields.
class SubmitComplaintView extends StatefulWidget {
  const SubmitComplaintView({super.key});

  @override
  State<SubmitComplaintView> createState() => _SubmitComplaintViewState();
}

class _SubmitComplaintViewState extends State<SubmitComplaintView> {
  final _subjectController = TextEditingController();
  final _descriptionController = TextEditingController();
  final _extraController = TextEditingController();

  @override
  void dispose() {
    _subjectController.dispose();
    _descriptionController.dispose();
    _extraController.dispose();
    super.dispose();
  }

  Future<void> _submit(BuildContext context) async {
    context.unfocus();
    final l10n = context.l10n;
    final cubit = context.read<SubmitComplaintCubit>();
    final created = await cubit.submit();
    if (!context.mounted) return;
    if (created != null) {
      AppSnackbar.show(context, l10n.complaintSubmittedMessage);
      GoRouter.of(context).pop(true);
    }
  }

  String _titleFor(BuildContext context, ComplaintContext ctx) {
    final l10n = context.l10n;
    return switch (ctx) {
      ComplaintContext.warehouse => l10n.submitComplaintOnWarehouseTitle,
      ComplaintContext.order => l10n.submitComplaintAboutOrderTitle,
      ComplaintContext.general => l10n.submitComplaintTitle,
    };
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return Scaffold(
      appBar: AppBar(
        backgroundColor: AppColors.navyOf(context),
        foregroundColor: Colors.white,
        title: BlocSelector<SubmitComplaintCubit, SubmitComplaintState, ComplaintContext>(
          selector: (state) => state.context,
          builder: (context, ctx) => Text(_titleFor(context, ctx)),
        ),
      ),
      body: BlocConsumer<SubmitComplaintCubit, SubmitComplaintState>(
        listenWhen: (previous, current) =>
            current.status == SubmitComplaintStatus.submitError &&
            previous.errorMessage != current.errorMessage,
        listener: (context, state) {
          AppSnackbar.show(
            context,
            translateErrorCode(l10n, state.errorCode, state.errorMessage ?? l10n.errorState),
          );
        },
        builder: (context, state) {
          final cubit = context.read<SubmitComplaintCubit>();

          return SafeArea(
            child: Column(
              children: [
                Expanded(
                  child: ListView(
                    padding: AppPadding.screen,
                    children: [
                      _ContextCard(state: state),
                      const SizedBox(height: AppSizes.spacingMedium),
                      AppTextField(
                        label: l10n.complaintSubjectLabel,
                        controller: _subjectController,
                        hint: l10n.complaintSubjectHint,
                        onChanged: cubit.setSubject,
                      ),
                      const SizedBox(height: AppSizes.spacingMedium),
                      AppTextField(
                        label: l10n.complaintDescriptionLabel,
                        controller: _descriptionController,
                        hint: l10n.complaintDescriptionHint,
                        maxLines: 6,
                        onChanged: cubit.setDescription,
                      ),
                      const SizedBox(height: AppSizes.spacingMedium),
                      AppTextField(
                        label: l10n.complaintExtraDetailsLabel,
                        controller: _extraController,
                        hint: l10n.complaintExtraDetailsHint,
                        maxLines: 4,
                        onChanged: cubit.setExtraDetails,
                      ),
                    ],
                  ),
                ),
                Container(
                  padding: const EdgeInsets.fromLTRB(
                    AppSizes.spacingMedium,
                    AppSizes.spacingSmall,
                    AppSizes.spacingMedium,
                    AppSizes.spacingMedium,
                  ),
                  decoration: BoxDecoration(
                    color: AppColors.surfaceElevatedOf(context),
                    border: Border(top: BorderSide(color: AppColors.borderOf(context))),
                  ),
                  child: PrimaryButton(
                    label: l10n.submitComplaintButton,
                    isLoading: state.isSubmitting,
                    onPressed: state.isValid ? () => _submit(context) : null,
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}

// The fixed, non-editable context shown above the form (Sections 2/3):
//   general   -> a short "this isn't about a specific warehouse or order" note
//   warehouse -> "Complaint about" + warehouse name
//   order     -> "Complaint about order" + order # + warehouse name
class _ContextCard extends StatelessWidget {
  const _ContextCard({required this.state});

  final SubmitComplaintState state;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final navy = AppColors.navyOf(context);

    final (IconData icon, String label, List<String> lines) = switch (state.context) {
      ComplaintContext.general => (
        Icons.support_agent_outlined,
        l10n.complaintContextGeneral,
        [l10n.complaintGeneralContextNote],
      ),
      ComplaintContext.warehouse => (
        Icons.storefront_rounded,
        l10n.complaintOnWarehouseLabel,
        [state.warehouseName ?? ''],
      ),
      ComplaintContext.order => (
        Icons.receipt_long_outlined,
        l10n.complaintAboutOrderLabel,
        [
          l10n.orderNumberLabel((state.orderNumber ?? 0).toString()),
          if ((state.warehouseName ?? '').isNotEmpty)
            l10n.complaintOrderWarehouseLine(state.warehouseName!),
        ],
      ),
    };

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSizes.spacingMedium),
      decoration: BoxDecoration(
        color: navy.withValues(alpha: 0.08),
        borderRadius: AppRadius.medium,
        border: Border.all(color: navy.withValues(alpha: 0.25)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 20, color: navy),
          const SizedBox(width: AppSizes.spacingMedium),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: context.textTheme.bodySmall?.copyWith(
                    color: AppColors.textSecondaryOf(context),
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 2),
                for (final line in lines.where((l) => l.isNotEmpty))
                  Text(
                    line,
                    style: context.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
