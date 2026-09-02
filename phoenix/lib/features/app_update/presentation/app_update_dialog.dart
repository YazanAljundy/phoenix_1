import 'package:flutter/material.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_radius.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/services/app_update_service.dart';
import 'package:phoenix/core/widgets/primary_button.dart';

// Phoenix-styled update dialogs (requirement sections 6, 7, 12). Uses the
// app's colours / Cairo text theme / AppRadius / PrimaryButton so it reads as
// a native Phoenix dialog, not a generic AlertDialog.
//
//   mandatory == true  -> not dismissible, no "Later", back button blocked
//   mandatory == false -> dismissible, "Update Now" + "Later"
Future<void> showAppUpdateDialog(
  BuildContext context, {
  required bool mandatory,
  required AppUpdateService service,
}) {
  return showDialog<void>(
    context: context,
    barrierDismissible: !mandatory,
    builder: (_) => _AppUpdateDialog(mandatory: mandatory, service: service),
  );
}

class _AppUpdateDialog extends StatefulWidget {
  const _AppUpdateDialog({required this.mandatory, required this.service});

  final bool mandatory;
  final AppUpdateService service;

  @override
  State<_AppUpdateDialog> createState() => _AppUpdateDialogState();
}

class _AppUpdateDialogState extends State<_AppUpdateDialog> {
  bool _launching = false;
  bool _launchFailed = false;

  Future<void> _updateNow() async {
    if (_launching) return;
    setState(() {
      _launching = true;
      _launchFailed = false;
    });
    final ok = await widget.service.openUpdateUrl();
    if (!mounted) return;
    setState(() {
      _launching = false;
      _launchFailed = !ok;
    });
    // On success for an optional update the user has chosen to leave for the
    // store - close the dialog. A mandatory dialog stays up until the app is
    // actually replaced with a newer build.
    if (ok && !widget.mandatory && mounted) {
      Navigator.of(context, rootNavigator: true).pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    final dialog = AlertDialog(
      backgroundColor: AppColors.surfaceElevatedOf(context),
      shape: const RoundedRectangleBorder(borderRadius: AppRadius.large),
      titlePadding: const EdgeInsets.fromLTRB(
        AppSizes.spacingLarge,
        AppSizes.spacingLarge,
        AppSizes.spacingLarge,
        AppSizes.spacingSmall,
      ),
      contentPadding: const EdgeInsets.fromLTRB(
        AppSizes.spacingLarge,
        0,
        AppSizes.spacingLarge,
        AppSizes.spacingMedium,
      ),
      actionsPadding: const EdgeInsets.fromLTRB(
        AppSizes.spacingLarge,
        0,
        AppSizes.spacingLarge,
        AppSizes.spacingLarge,
      ),
      title: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: AppColors.primaryOf(context).withValues(alpha: 0.12),
              shape: BoxShape.circle,
            ),
            child: Icon(
              widget.mandatory ? Icons.system_update : Icons.rocket_launch_outlined,
              color: AppColors.primaryOf(context),
              size: 20,
            ),
          ),
          const SizedBox(width: AppSizes.spacingMedium),
          Expanded(
            child: Text(
              widget.mandatory ? l10n.updateRequired : l10n.updateAvailable,
              style: context.textTheme.titleLarge,
            ),
          ),
        ],
      ),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            widget.mandatory ? l10n.updateRequiredMessage : l10n.updateAvailableMessage,
            style: context.textTheme.bodyMedium?.copyWith(
              color: AppColors.textSecondaryOf(context),
              height: 1.5,
            ),
          ),
          if (_launchFailed) ...[
            const SizedBox(height: AppSizes.spacingMedium),
            Container(
              padding: const EdgeInsets.all(AppSizes.spacingSmall),
              decoration: BoxDecoration(
                color: AppColors.errorOf(context).withValues(alpha: 0.08),
                borderRadius: AppRadius.small,
              ),
              child: Text(
                l10n.updateOpenStoreFailed,
                style: context.textTheme.bodySmall?.copyWith(
                  color: AppColors.errorOf(context),
                ),
              ),
            ),
          ],
        ],
      ),
      actions: [
        Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            PrimaryButton(
              label: l10n.updateNow,
              isLoading: _launching,
              onPressed: _updateNow,
            ),
            if (!widget.mandatory) ...[
              const SizedBox(height: AppSizes.spacingSmall),
              TextButton(
                onPressed: _launching
                    ? null
                    : () => Navigator.of(context, rootNavigator: true).pop(),
                style: TextButton.styleFrom(
                  foregroundColor: AppColors.textSecondaryOf(context),
                ),
                child: Text(l10n.later),
              ),
            ],
          ],
        ),
      ],
    );

    // Requirement 7: a mandatory update cannot be bypassed - not by the
    // barrier (barrierDismissible: false above) and not by the Android back
    // button either.
    return PopScope(canPop: !widget.mandatory, child: dialog);
  }
}
