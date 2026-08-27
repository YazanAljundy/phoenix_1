import 'package:flutter/material.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_padding.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/widgets/custom_card.dart';
import 'package:phoenix/features/legal/data/privacy_policy_content.dart';

// Renders the privacy-policy text from PrivacyPolicyContent. Pure
// presentation - it holds none of the wording itself, so the policy can be
// revised entirely in the data file. Follows the same locale/RTL handling as
// the rest of the app: it reads the active locale and picks the matching
// language, and the app-wide Directionality (set by MaterialApp.locale) makes
// the Arabic copy lay out right-to-left on its own.
class PrivacyPolicyBody extends StatelessWidget {
  const PrivacyPolicyBody({super.key});

  @override
  Widget build(BuildContext context) {
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';
    final l10n = context.l10n;
    final sections = PrivacyPolicyContent.sections(isArabic: isArabic);
    final lastUpdated =
        PrivacyPolicyContent.formattedLastUpdated(isArabic: isArabic);

    return ListView(
      padding: AppPadding.screen,
      children: [
        Text(
          PrivacyPolicyContent.title(isArabic: isArabic),
          style: context.textTheme.displaySmall,
        ),
        const SizedBox(height: AppSizes.spacingXSmall),
        Text(
          l10n.privacyPolicyLastUpdated(lastUpdated),
          style: context.textTheme.bodySmall?.copyWith(
            color: AppColors.textSecondaryOf(context),
          ),
        ),
        const SizedBox(height: AppSizes.spacingLarge),
        for (final section in sections) ...[
          _Section(section: section),
          const SizedBox(height: AppSizes.spacingMedium),
        ],
      ],
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({required this.section});

  final PrivacyPolicySection section;

  @override
  Widget build(BuildContext context) {
    return CustomCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            section.title,
            style: context.textTheme.titleMedium?.copyWith(
              color: AppColors.navyOf(context),
            ),
          ),
          const SizedBox(height: AppSizes.spacingSmall),
          for (final block in section.blocks) _Block(block: block),
        ],
      ),
    );
  }
}

class _Block extends StatelessWidget {
  const _Block({required this.block});

  final PolicyBlock block;

  @override
  Widget build(BuildContext context) {
    // Comfortable reading measure on a phone - slightly looser than the
    // app's default body line height.
    final bodyStyle = context.textTheme.bodyMedium?.copyWith(
      color: AppColors.textSecondaryOf(context),
      height: 1.6,
    );

    switch (block) {
      case PolicyParagraph(:final text):
        return Padding(
          padding: const EdgeInsets.only(bottom: AppSizes.spacingSmall),
          child: Text(text, style: bodyStyle),
        );
      case PolicySubheading(:final text):
        return Padding(
          padding: const EdgeInsets.only(
            top: AppSizes.spacingXSmall,
            bottom: AppSizes.spacingSmall,
          ),
          child: Text(
            text,
            style: context.textTheme.titleSmall?.copyWith(
              color: AppColors.textOf(context),
            ),
          ),
        );
      case PolicyBullets(:final items):
        return Padding(
          padding: const EdgeInsets.only(bottom: AppSizes.spacingSmall),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              for (final item in items)
                Padding(
                  padding: const EdgeInsets.only(bottom: AppSizes.spacingXSmall),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Padding(
                        padding: const EdgeInsets.only(top: 7),
                        child: Container(
                          width: 5,
                          height: 5,
                          decoration: BoxDecoration(
                            color: AppColors.primaryOf(context),
                            shape: BoxShape.circle,
                          ),
                        ),
                      ),
                      const SizedBox(width: AppSizes.spacingSmall),
                      Expanded(child: Text(item, style: bodyStyle)),
                    ],
                  ),
                ),
            ],
          ),
        );
    }
  }
}
