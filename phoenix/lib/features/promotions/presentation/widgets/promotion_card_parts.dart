import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_radius.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/utils/currency_formatter.dart';
import 'package:phoenix/core/utils/date_formatter.dart';
import 'package:phoenix/core/widgets/app_network_image.dart';
import 'package:phoenix/core/widgets/status_badge.dart';
import 'package:phoenix/features/exchange_rate/presentation/managers/exchange_rate_cubit.dart';
import 'package:phoenix/features/promotions/data/models/promotion.dart';

// The pieces the hero card and the compact list card both draw, so the two
// stay one visual language rather than two that drift apart.
//
// Everything here is theme-driven (AppColors / the shared text theme /
// StatusBadge), so it reads correctly in light and dark and in RTL and LTR
// without a single hardcoded colour.

/// "Offer" / "Package" - which of the two things this card is.
class PromotionKindBadge extends StatelessWidget {
  const PromotionKindBadge({super.key, required this.kind});

  final PromotionKind kind;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return StatusBadge(
      label: switch (kind) {
        PromotionKind.offer => l10n.offerBadgeLabel,
        PromotionKind.package => l10n.promotionsPackageBadge,
      },
      // Navy: an informational label, not a warning and not a call to action -
      // the saving figure below is the only thing meant to draw the eye.
      tone: StatusBadgeTone.info,
    );
  }
}

/// The headline figure: "20% off" for an offer, "Save 20%" for a package.
/// Renders nothing when there is no saving to report.
class PromotionSavingBadge extends StatelessWidget {
  const PromotionSavingBadge({super.key, required this.promotion});

  final Promotion promotion;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    if (promotion.savingPercentage <= 0) return const SizedBox.shrink();
    return StatusBadge(
      label: switch (promotion) {
        OfferPromotion() => l10n.offerDiscountPercent(promotion.savingPercentage),
        PackagePromotion() => l10n.advertisementSavingPercent(promotion.savingPercentage),
      },
      // Green is this app's "positive" colour (see AppColors) - a saving, not
      // an alarm.
      tone: StatusBadgeTone.success,
    );
  }
}

/// What the pharmacist pays, with the price it replaces struck through beside
/// it when there is a saving. Both figures come straight off the model; this
/// computes nothing.
class PromotionPriceLine extends StatelessWidget {
  const PromotionPriceLine({super.key, required this.promotion, this.compact = false});

  final Promotion promotion;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final usdToSyp = context.watch<ExchangeRateCubit>().state.usdToSyp;
    String money(num usd) => formatMoneyFromUsd(usd, usdToSyp, l10n.currencySuffix);

    final (num payable, num before, bool hasSaving) = switch (promotion) {
      OfferPromotion(:final offer) => (offer.discountPriceUsd, offer.priceUsd, offer.hasSaving),
      PackagePromotion(:final advertisement) => (
        advertisement.totalPriceUsd,
        advertisement.itemsTotalUsd,
        advertisement.hasSaving,
      ),
    };

    return Wrap(
      crossAxisAlignment: WrapCrossAlignment.center,
      // Compact cards put this at the end of a row, where a narrow phone can
      // force the struck-through price onto a second line - it has to wrap
      // toward the same edge it is aligned to.
      alignment: compact ? WrapAlignment.end : WrapAlignment.start,
      spacing: AppSizes.spacingSmall,
      children: [
        Text(
          money(payable),
          style: (compact ? context.textTheme.titleSmall : context.textTheme.titleMedium)?.copyWith(
            color: AppColors.primaryOf(context),
          ),
        ),
        if (hasSaving)
          Text(
            money(before),
            style: context.textTheme.bodySmall?.copyWith(
              decoration: TextDecoration.lineThrough,
              color: AppColors.textSecondaryOf(context),
            ),
          ),
      ],
    );
  }
}

/// The warehouse the promotion belongs to, plus - for an offer - how long it
/// runs. A quiet secondary line; never the loudest thing on the card.
class PromotionMetaLine extends StatelessWidget {
  const PromotionMetaLine({super.key, required this.promotion});

  final Promotion promotion;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';
    final secondary = AppColors.textSecondaryOf(context);
    final style = context.textTheme.bodySmall?.copyWith(color: secondary);

    final validity = switch (promotion) {
      OfferPromotion(:final offer) when offer.isPermanent => l10n.offerPermanent,
      OfferPromotion(:final offer) when offer.endDate != null =>
        l10n.offerEndsOn(DateFormatter.formatDate(offer.endDate!)),
      _ => null,
    };

    // One ellipsizing line rather than two texts competing for the same row:
    // a long warehouse name next to a long date is exactly what overflows a
    // narrow phone, and this degrades by truncating instead.
    final label = validity == null
        ? promotion.warehouseName(isArabic)
        : '${promotion.warehouseName(isArabic)} · $validity';

    return Row(
      children: [
        Icon(Icons.storefront_outlined, size: AppSizes.iconSizeSmall, color: secondary),
        const SizedBox(width: AppSizes.spacingXSmall),
        Expanded(
          child: Text(label, style: style, maxLines: 1, overflow: TextOverflow.ellipsis),
        ),
      ],
    );
  }
}

/// The card's picture. Most catalog products carry no image yet (see
/// ProductModel.image), so this is built to look deliberate when empty: the
/// app's standard themed placeholder with a glyph that says what the card is.
class PromotionThumbnail extends StatelessWidget {
  const PromotionThumbnail({
    super.key,
    required this.promotion,
    required this.width,
    this.height,
    this.borderRadius,
  });

  final Promotion promotion;
  final double width;
  final double? height;
  final BorderRadius? borderRadius;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: width,
      height: height,
      child: AppNetworkImage(
        url: promotion.imageUrl,
        crop: true,
        borderRadius: borderRadius,
        fallbackIcon: switch (promotion.kind) {
          PromotionKind.offer => Icons.local_offer_outlined,
          PromotionKind.package => Icons.inventory_2_outlined,
        },
      ),
    );
  }
}

/// The surface every promotion card sits on: the app's existing card language
/// (elevated surface, hairline border, one soft shadow, large radius) - the
/// same one CustomCard and the catalog use, so this screen reads as part of
/// the app rather than an advert dropped into it.
class PromotionSurface extends StatelessWidget {
  const PromotionSurface({super.key, required this.child, this.onTap});

  final Widget child;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: AppColors.surfaceElevatedOf(context),
        borderRadius: AppRadius.large,
        border: Border.all(color: AppColors.borderOf(context)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: context.isDarkMode ? 0.24 : 0.06),
            blurRadius: 12,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Material(
        type: MaterialType.transparency,
        child: InkWell(
          onTap: onTap,
          splashColor: AppColors.primaryOf(context).withValues(alpha: 0.08),
          highlightColor: AppColors.primaryOf(context).withValues(alpha: 0.04),
          child: child,
        ),
      ),
    );
  }
}
