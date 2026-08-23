import 'package:flutter/material.dart';

import '../constants/app_colors.dart';
import '../constants/app_radius.dart';
import 'press_scale.dart';

// Renders its own BoxShadow rather than going through Material's Card
// elevation - Card's elevation shadow doesn't accept an exact color/blur/
// offset, and Section 1 of the visual-polish pass specifies one precisely
// (black @ 8%, 12px blur, 4px down) for every card in the app.
class CustomCard extends StatelessWidget {
  const CustomCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(16),
    this.onTap,
  });

  final Widget child;
  final EdgeInsets padding;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final card = Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: AppColors.surfaceElevatedOf(context),
        borderRadius: AppRadius.large,
        border: Border.all(color: AppColors.borderOf(context)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.08),
            blurRadius: 12,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: onTap == null
          ? Padding(padding: padding, child: child)
          : InkWell(
              onTap: onTap,
              splashColor: AppColors.primaryOf(context).withValues(alpha: 0.1),
              highlightColor: AppColors.primaryOf(context).withValues(alpha: 0.05),
              child: Padding(padding: padding, child: child),
            ),
    );

    if (onTap == null) return card;
    return PressScale(scale: 0.98, child: card);
  }
}
