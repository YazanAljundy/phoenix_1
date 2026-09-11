import 'package:flutter/material.dart';

import '../constants/app_colors.dart';
import '../constants/app_radius.dart';
import '../theme/app_text_theme.dart';
import '../extensions/build_context_extensions.dart';

/// The four semantic tones a status pill can take (Section 3-d of the
/// visual-polish pass) - `pending` (orange), `success` (green, e.g.
/// delivered/approved), `danger` (red, e.g. cancelled/rejected/unavailable),
/// `info` (navy by day, silver at night - AppColors.textOf, since navyOf
/// vanishes on a dark card; e.g. confirmed/preparing/out for delivery).
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
    final Color fg = switch (tone) {
      StatusBadgeTone.pending => AppColors.primaryOf(context),
      StatusBadgeTone.success => AppColors.secondaryOf(context),
      StatusBadgeTone.danger => AppColors.errorOf(context),
      StatusBadgeTone.info => AppColors.textOf(context),
    };
    // Tint the pill from its own foreground rather than from a hand-picked
    // pastel per tone: those pastels were Material-palette tints of the old
    // brand colours (the info tint, for one, was an indigo mixed for the old
    // #1A237E navy) and went subtly wrong the moment the palette moved to
    // FENIQ. Derived this way the pill can never drift from the theme again.
    final Color bg = isDark
        ? fg.withValues(alpha: 0.18)
        : Color.alphaBlend(fg.withValues(alpha: 0.14), AppColors.surfaceElevatedOf(context));

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      decoration: BoxDecoration(color: bg, borderRadius: AppRadius.badge),
      child: Text(
        label,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: context.textTheme.bodySmall?.copyWith(color: fg, fontWeight: AppTextTheme.semiBold),
      ),
    );
  }
}
