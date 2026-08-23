import 'package:flutter/material.dart';

import '../constants/app_colors.dart';
import '../constants/app_sizes.dart';
import '../constants/app_strings.dart';
import '../extensions/build_context_extensions.dart';

/// Big icon + a title + an optional secondary line (Section 3-e of the
/// visual-polish pass) - every "nothing here" screen in the app should
/// render this instead of a bare message so empty states read as designed,
/// not blank.
class EmptyView extends StatelessWidget {
  const EmptyView({
    super.key,
    this.message = AppStrings.emptyState,
    this.subtitle,
    this.icon = Icons.inbox_outlined,
  });

  final String message;
  final String? subtitle;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: AppSizes.spacingXLarge),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 80, color: AppColors.navyOf(context).withValues(alpha: 0.3)),
            const SizedBox(height: AppSizes.spacingMedium),
            Text(
              message,
              textAlign: TextAlign.center,
              style: context.textTheme.titleMedium,
            ),
            if (subtitle != null) ...[
              const SizedBox(height: AppSizes.spacingXSmall),
              Text(
                subtitle!,
                textAlign: TextAlign.center,
                style: context.textTheme.bodyMedium?.copyWith(color: AppColors.textSecondaryOf(context)),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
