import 'package:flutter/material.dart';
import 'package:feniq/core/constants/app_colors.dart';
import 'package:feniq/core/constants/app_radius.dart';
import 'package:feniq/core/constants/app_sizes.dart';
import 'package:feniq/core/extensions/build_context_extensions.dart';
import 'package:feniq/features/promotions/data/models/promotion.dart';

import 'promotion_card_parts.dart';

/// One card in the Offers & Ads hero carousel: a picture, what it is, what it
/// saves, and where it is from.
///
/// Deliberately quiet for a "featured" slot - the app's own card surface, its
/// own text theme, its own badge language, no gradient and no oversized
/// promotional type. The only accent is the price, in the app's primary
/// colour, exactly as the catalog renders a price.
class PromotionHeroCard extends StatelessWidget {
  const PromotionHeroCard({super.key, required this.promotion, required this.onTap});

  final Promotion promotion;
  final VoidCallback onTap;

  static const double height = 176;

  @override
  Widget build(BuildContext context) {
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';

    // An offer is about one product, a package about several - the subtitle
    // says which, in the terms the pharmacist thinks in.
    final subtitle = switch (promotion) {
      final OfferPromotion offer => offer.productName(isArabic),
      PackagePromotion(:final advertisement) =>
        context.l10n.advertisementProductCount(advertisement.items.length),
    };

    return SizedBox(
      height: height,
      child: PromotionSurface(
        onTap: onTap,
        child: Row(
          children: [
            PromotionThumbnail(promotion: promotion, width: 100, height: height),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.all(AppSizes.spacingMedium),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Both badges are Flexible: on a narrow phone a long
                    // saving label would otherwise push the row past the card
                    // edge instead of ellipsizing inside its own pill.
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Flexible(child: PromotionKindBadge(kind: promotion.kind)),
                        const SizedBox(width: AppSizes.spacingSmall),
                        Flexible(child: PromotionSavingBadge(promotion: promotion)),
                      ],
                    ),
                    const SizedBox(height: AppSizes.spacingSmall),
                    Text(
                      promotion.title(isArabic),
                      style: context.textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w700,
                        color: AppColors.textOf(context),
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      subtitle,
                      style: context.textTheme.bodySmall?.copyWith(
                        color: AppColors.textSecondaryOf(context),
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const Spacer(),
                    PromotionMetaLine(promotion: promotion),
                    const SizedBox(height: AppSizes.spacingXSmall),
                    PromotionPriceLine(promotion: promotion),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The compact version of the same card for the browsable list below the
/// carousel: identical language, less of it.
class PromotionListCard extends StatelessWidget {
  const PromotionListCard({
    super.key,
    required this.promotion,
    required this.onTap,
    this.action,
  });

  final Promotion promotion;

  /// Null leaves the card inert - the state the warehouse offers list uses for
  /// a promotion there is nothing left to do with (already in the cart, or
  /// unavailable), where its [action] is the control instead.
  final VoidCallback? onTap;

  /// An optional control the card owns, drawn on its own full-width row under
  /// everything else - today the warehouse offers list's add-to-cart button or
  /// its in-cart quantity stepper. Null (the Offers & Ads tab) draws the card
  /// exactly as it always was.
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';

    return PromotionSurface(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.all(AppSizes.spacingSmall + 2),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            PromotionThumbnail(
              promotion: promotion,
              width: 64,
              height: 64,
              borderRadius: AppRadius.small,
            ),
            const SizedBox(width: AppSizes.spacingMedium),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // 3:2 - the title gets the lion's share of a narrow row but
                  // the badge is never squeezed out of it entirely.
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Flexible(
                        flex: 3,
                        child: Text(
                          promotion.title(isArabic),
                          style: context.textTheme.titleSmall?.copyWith(
                            color: AppColors.textOf(context),
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      const SizedBox(width: AppSizes.spacingSmall),
                      Flexible(flex: 2, child: PromotionSavingBadge(promotion: promotion)),
                    ],
                  ),
                  const SizedBox(height: AppSizes.spacingXSmall),
                  PromotionMetaLine(promotion: promotion),
                  const SizedBox(height: AppSizes.spacingSmall),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      PromotionKindBadge(kind: promotion.kind),
                      const SizedBox(width: AppSizes.spacingSmall),
                      // Bounded, so two long SYP figures wrap onto a second
                      // line instead of running off the card.
                      Flexible(child: PromotionPriceLine(promotion: promotion, compact: true)),
                    ],
                  ),
                  // A row of its own rather than a trailing slot beside the
                  // price: the in-cart stepper is 122pt wide and would squeeze
                  // the price line (a Wrap of unbounded Texts) off the edge of
                  // a narrow phone.
                  if (action != null) ...[
                    const SizedBox(height: AppSizes.spacingSmall),
                    action!,
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
