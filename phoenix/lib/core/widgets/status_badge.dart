import 'package:flutter/material.dart';

import '../constants/app_colors.dart';
import '../constants/app_radius.dart';
import '../extensions/build_context_extensions.dart';

/// The four semantic tones a status pill can take (Section 3-d of the
/// visual-polish pass) - `pending` (orange), `success` (green, e.g.
/// delivered/approved), `danger` (red, e.g. cancelled/rejected/unavailable),
/// `info` (navy, e.g. confirmed/preparing/out for delivery).
enum StatusBadgeTone { pending, success, danger, info }

/// One shared visual for every status/availability pill in the app - light
/// background + matching dark text, replacing each screen's own ad-hoc
/// Container+BoxDecoration copy. Callers keep deciding which status string
/// maps to which tone (that mapping is domain knowledge that belongs with
/// the data, not here); this widget only renders the chosen tone
/// consistently, light or dark mode.
class StatusBadge extends StatelessWidget {
  const StatusBadge({super.key, required this.label, required this.tone});

  final String label;
  final StatusBadgeTone tone;

  @override
  Widget build(BuildContext context) {
    final isDark = context.isDarkMode;
    final Color bg;
    final Color fg;
    switch (tone) {
      case StatusBadgeTone.pending:
        fg = AppColors.primaryOf(context);
        bg = isDark ? fg.withValues(alpha: 0.18) : const Color(0xFFFFF3E0);
      case StatusBadgeTone.success:
        fg = AppColors.secondaryOf(context);
        bg = isDark ? fg.withValues(alpha: 0.18) : const Color(0xFFE8F5E9);
      case StatusBadgeTone.danger:
        fg = AppColors.errorOf(context);
        bg = isDark ? fg.withValues(alpha: 0.18) : const Color(0xFFFFEBEE);
      case StatusBadgeTone.info:
        fg = AppColors.navyOf(context);
        bg = isDark ? fg.withValues(alpha: 0.18) : const Color(0xFFE8EAF6);
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      decoration: BoxDecoration(color: bg, borderRadius: AppRadius.badge),
      child: Text(
        label,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: context.textTheme.bodySmall?.copyWith(color: fg, fontWeight: FontWeight.w700),
      ),
    );
  }
}
