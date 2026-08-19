import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_padding.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/widgets/app_dialog.dart';
import 'package:phoenix/core/widgets/primary_button.dart';
import 'package:phoenix/core/widgets/secondary_button.dart';
import 'package:phoenix/features/auth/presentation/managers/auth_cubit.dart';
import 'package:phoenix/features/auth/presentation/managers/auth_state.dart';
import 'package:phoenix/routes/route_names.dart';

class ApprovalPendingView extends StatelessWidget {
  const ApprovalPendingView({super.key});

  void _contactSupport(BuildContext context) {
    final l10n = context.l10n;
    AppDialog.show(
      context: context,
      title: l10n.contactSupportDialogTitle,
      content: l10n.contactSupportDialogMessage,
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return BlocListener<AuthCubit, AuthState>(
      listenWhen: (previous, current) =>
          current.sessionStatus == SessionStatus.active,
      listener: (context, state) =>
          context.goNamed(RouteNames.warehouseSelection),
      child: BlocBuilder<AuthCubit, AuthState>(
        builder: (context, state) {
          final isBlocked = state.sessionStatus == SessionStatus.blocked;

          return Scaffold(
            body: SafeArea(
              // Unlike the other auth screens (registration/OTP/login), this
              // one has no text input, so it never had a scroll wrapper -
              // but the icon + two messages + up to two buttons can still
              // exceed the viewport height in landscape, or with a larger
              // accessibility text scale. LayoutBuilder + a min-height
              // ConstrainedBox keeps it centered when it fits and scrollable
              // instead of overflowing when it doesn't.
              child: LayoutBuilder(
                builder: (context, constraints) {
                  return SingleChildScrollView(
                    padding: AppPadding.screen,
                    child: ConstrainedBox(
                      constraints: BoxConstraints(
                        minHeight: constraints.maxHeight,
                      ),
                      child: Center(
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(
                              isBlocked
                                  ? Icons.block_rounded
                                  : Icons.hourglass_top_rounded,
                              color: isBlocked
                                  ? AppColors.errorOf(context)
                                  : AppColors.primaryOf(context),
                              size: 72,
                            ),
                            const SizedBox(height: AppSizes.spacingLarge),
                            Text(
                              isBlocked
                                  ? l10n.approvalPendingBlockedTitle
                                  : l10n.approvalPendingTitle,
                              style: context.textTheme.titleLarge,
                              textAlign: TextAlign.center,
                            ),
                            const SizedBox(height: AppSizes.spacingSmall),
                            Text(
                              isBlocked
                                  ? l10n.approvalPendingBlockedMessage
                                  : l10n.approvalPendingMessage,
                              style: context.textTheme.bodyMedium?.copyWith(
                                color: AppColors.textSecondaryOf(context),
                              ),
                              textAlign: TextAlign.center,
                            ),
                            const SizedBox(height: AppSizes.spacingXLarge),
                            if (!isBlocked)
                              PrimaryButton(
                                label: l10n.refreshStatusButton,
                                onPressed: () =>
                                    context.read<AuthCubit>().checkSession(),
                              ),
                            const SizedBox(height: AppSizes.spacingMedium),
                            SecondaryButton(
                              label: l10n.contactSupportButton,
                              onPressed: () => _contactSupport(context),
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
