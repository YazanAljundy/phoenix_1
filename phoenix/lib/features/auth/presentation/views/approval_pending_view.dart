import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_padding.dart';
import 'package:phoenix/core/constants/app_radius.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/widgets/app_dialog.dart';
import 'package:phoenix/core/widgets/primary_button.dart';
import 'package:phoenix/core/widgets/secondary_button.dart';
import 'package:phoenix/features/auth/presentation/managers/auth_cubit.dart';
import 'package:phoenix/features/auth/presentation/managers/auth_state.dart';
import 'package:phoenix/routes/route_names.dart';

class ApprovalPendingView extends StatefulWidget {
  const ApprovalPendingView({super.key});

  @override
  State<ApprovalPendingView> createState() => _ApprovalPendingViewState();
}

class _ApprovalPendingViewState extends State<ApprovalPendingView>
    with SingleTickerProviderStateMixin {
  late final AnimationController _pulseController;

  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 900),
    )..repeat(reverse: true);
  }

  @override
  void dispose() {
    _pulseController.dispose();
    super.dispose();
  }

  void _contactSupport(BuildContext context) {
    final l10n = context.l10n;
    AppDialog.show(
      context: context,
      title: l10n.contactSupportDialogTitle,
      content: l10n.contactSupportDialogMessage,
    );
  }

  // Same confirm-then-logout pattern as ProfileView - this screen previously
  // had no way out of a pending/blocked account other than closing the app.
  Future<void> _confirmLogout(BuildContext context) async {
    final l10n = context.l10n;
    final authCubit = context.read<AuthCubit>();

    await AppDialog.show(
      context: context,
      title: l10n.logoutConfirmTitle,
      content: l10n.logoutConfirmMessage,
      actionLabel: l10n.logout,
      onAction: () async {
        await authCubit.logout();
        if (context.mounted) context.goNamed(RouteNames.registration);
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return BlocListener<AuthCubit, AuthState>(
      listenWhen: (previous, current) =>
          current.sessionStatus == SessionStatus.active,
      listener: (context, state) => context.goNamed(RouteNames.warehouseSelection),
      child: BlocBuilder<AuthCubit, AuthState>(
        builder: (context, state) {
          final isBlocked = state.sessionStatus == SessionStatus.blocked;
          final isArabic = Localizations.localeOf(context).languageCode == 'ar';
          final pharmacy = state.pharmacy;
          final pharmacyName = pharmacy == null ? null : (isArabic ? pharmacy.nameAr : pharmacy.nameEn);
          final message = isBlocked
              ? l10n.approvalPendingBlockedMessage
              : (pharmacyName != null
                    ? l10n.approvalPendingMessageWithName(pharmacyName)
                    : l10n.approvalPendingMessage);

          return Scaffold(
            body: SafeArea(
              // Unlike the other auth screens (registration/OTP/login), this
              // one has no text input, so it never had a scroll wrapper -
              // but the icon + messages + checklist + up to three buttons
              // can still exceed the viewport height in landscape, or with a
              // larger accessibility text scale. LayoutBuilder + a min-height
              // ConstrainedBox keeps it centered when it fits and scrollable
              // instead of overflowing when it doesn't; maxWidth keeps it
              // from stretching edge-to-edge on a tablet.
              child: LayoutBuilder(
                builder: (context, constraints) {
                  return SingleChildScrollView(
                    padding: AppPadding.screen,
                    child: Center(
                      child: ConstrainedBox(
                        constraints: BoxConstraints(minHeight: constraints.maxHeight, maxWidth: 480),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Center(
                              child: _StatusBadge(isBlocked: isBlocked, pulseController: _pulseController),
                            ),
                            const SizedBox(height: AppSizes.spacingLarge),
                            Text(
                              isBlocked ? l10n.approvalPendingBlockedTitle : l10n.approvalPendingTitle,
                              style: context.textTheme.displaySmall,
                              textAlign: TextAlign.center,
                            ),
                            const SizedBox(height: AppSizes.spacingSmall),
                            Text(
                              message,
                              style: context.textTheme.bodyMedium?.copyWith(
                                color: AppColors.textSecondaryOf(context),
                              ),
                              textAlign: TextAlign.center,
                            ),
                            if (!isBlocked) ...[
                              const SizedBox(height: AppSizes.spacingXLarge),
                              const _ChecklistCard(),
                            ],
                            const SizedBox(height: AppSizes.spacingXLarge),
                            if (!isBlocked) ...[
                              PrimaryButton(
                                label: l10n.refreshStatusButton,
                                onPressed: () => context.read<AuthCubit>().checkSession(),
                              ),
                              const SizedBox(height: AppSizes.spacingMedium),
                            ],
                            SecondaryButton(
                              label: l10n.contactSupportButton,
                              onPressed: () => _contactSupport(context),
                            ),
                            const SizedBox(height: AppSizes.spacingMedium),
                            Center(
                              child: TextButton(
                                onPressed: () => _confirmLogout(context),
                                child: Text(
                                  l10n.logout,
                                  style: TextStyle(color: AppColors.textSecondaryOf(context)),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  );
                },
              ),
            ),
          );
        },
      ),
    );
  }
}

class _StatusBadge extends StatelessWidget {
  const _StatusBadge({required this.isBlocked, required this.pulseController});

  final bool isBlocked;
  final AnimationController pulseController;

  @override
  Widget build(BuildContext context) {
    final badge = Container(
      width: 96,
      height: 96,
      decoration: BoxDecoration(
        color: isBlocked ? AppColors.errorOf(context) : AppColors.primaryOf(context),
        borderRadius: AppRadius.large,
      ),
      child: Icon(
        isBlocked ? Icons.block_rounded : Icons.hourglass_top_rounded,
        color: Colors.white,
        size: 46,
      ),
    );

    // No pulse for the blocked state - it's a stopped/terminal state, not
    // something actively in progress.
    if (isBlocked) return badge;

    return ScaleTransition(
      scale: Tween(begin: 0.94, end: 1.06).animate(
        CurvedAnimation(parent: pulseController, curve: Curves.easeInOut),
      ),
      child: badge,
    );
  }
}

// A simple, honest 3-step status list - deliberately doesn't commit to a
// review-time estimate (e.g. "usually within 24 hours"), since nothing in
// this app tracks or guarantees one.
class _ChecklistCard extends StatelessWidget {
  const _ChecklistCard();

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSizes.spacingMedium),
      decoration: BoxDecoration(
        color: AppColors.surfaceOf(context),
        borderRadius: AppRadius.large,
        border: Border.all(color: AppColors.borderOf(context)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _ChecklistRow(
            icon: Icons.check_circle,
            color: AppColors.secondaryOf(context),
            label: l10n.approvalChecklistReceived,
          ),
          const SizedBox(height: AppSizes.spacingMedium),
          _ChecklistRow(
            icon: Icons.pending_outlined,
            color: AppColors.primaryOf(context),
            label: l10n.approvalChecklistReview,
          ),
          const SizedBox(height: AppSizes.spacingMedium),
          _ChecklistRow(
            icon: Icons.lock_outline,
            color: AppColors.textSecondaryOf(context),
            label: l10n.approvalChecklistActivate,
          ),
        ],
      ),
    );
  }
}

class _ChecklistRow extends StatelessWidget {
  const _ChecklistRow({required this.icon, required this.color, required this.label});

  final IconData icon;
  final Color color;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, color: color, size: AppSizes.iconSizeMedium),
        const SizedBox(width: AppSizes.spacingSmall),
        Expanded(
          child: Text(
            label,
            style: context.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600),
          ),
        ),
      ],
    );
  }
}
