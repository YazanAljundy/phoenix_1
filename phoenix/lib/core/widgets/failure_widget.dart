import 'package:flutter/material.dart';

import '../constants/app_colors.dart';
import '../constants/app_padding.dart';
import '../constants/app_radius.dart';
import '../constants/app_sizes.dart';
import '../extensions/build_context_extensions.dart';

/// The one way the app shows an error to the user (Section: error-presentation
/// pass). Icon + a human sentence + an optional "Retry".
///
/// Presentation only: it takes an already-localized, already-user-friendly
/// [message] and never inspects exceptions, `Failure`, or `DioException` -
/// that mapping happens in the view via `translateErrorCode`
/// (core/error/error_translator.dart) before the string is passed here.
///
/// [onRetry] is a plain callback - the widget does not know about cubits or
/// repositories; the caller wires it to whatever `load()` it needs.
///
/// Design-system driven end to end: AppColors / theme text styles (Cairo) /
/// AppRadius, so it renders correctly in light & dark and in RTL & LTR.
/// [dense] trims it down for an error inside one section of a page rather
/// than a whole-page failure.
class FailureWidget extends StatelessWidget {
  const FailureWidget({
    super.key,
    required this.message,
    this.onRetry,
    this.icon = Icons.error_outline_rounded,
    this.dense = false,
  });

  final String message;
  final VoidCallback? onRetry;
  final IconData icon;
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final double iconBox = dense ? 56 : 84;
    final double iconSize = dense ? 28 : 40;

    return Center(
      child: SingleChildScrollView(
        // Long messages stay readable on a short viewport instead of
        // overflowing.
        padding: dense ? AppPadding.screen : const EdgeInsets.all(AppSizes.spacingLarge),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: iconBox,
                height: iconBox,
                decoration: BoxDecoration(
                  color: AppColors.errorOf(context).withValues(alpha: 0.12),
                  borderRadius: AppRadius.large,
                ),
                child: Icon(icon, size: iconSize, color: AppColors.errorOf(context)),
              ),
              SizedBox(height: dense ? AppSizes.spacingSmall : AppSizes.spacingMedium),
              Text(
                message,
                textAlign: TextAlign.center,
                style: (dense ? context.textTheme.bodyMedium : context.textTheme.titleMedium)
                    ?.copyWith(color: AppColors.textOf(context)),
              ),
              if (onRetry != null) ...[
                SizedBox(height: dense ? AppSizes.spacingMedium : AppSizes.spacingLarge),
                OutlinedButton.icon(
                  onPressed: onRetry,
                  icon: const Icon(Icons.refresh, size: AppSizes.iconSizeSmall),
                  label: Text(l10n.retryButton),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.primaryOf(context),
                    side: BorderSide(color: AppColors.borderOf(context)),
                    shape: const RoundedRectangleBorder(borderRadius: AppRadius.medium),
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppSizes.spacingLarge,
                      vertical: AppSizes.spacingSmall + 2,
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
