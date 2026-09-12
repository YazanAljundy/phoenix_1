import 'package:flutter/material.dart';
import 'package:feniq/core/constants/app_colors.dart';
import 'package:feniq/core/constants/app_radius.dart';
import 'package:feniq/core/constants/app_sizes.dart';
import 'package:feniq/core/extensions/build_context_extensions.dart';
import 'package:feniq/core/theme/app_text_theme.dart';
import 'package:feniq/core/widgets/app_network_image.dart';
import 'package:feniq/core/widgets/custom_card.dart';
import 'package:feniq/core/widgets/whatsapp_button.dart';
import 'package:feniq/features/warehouse_selection/data/models/warehouse_model.dart';

// Section 17 (redesign): tapping the card itself selects the warehouse
// (continues to /manufacturers) - there is no full-width "Select" button;
// a plainly-labeled "Profile" button sits alongside a WhatsApp button in
// their own row.
//
// Visual pass (warehouses screen): the card now goes through the shared
// CustomCard rather than rolling its own Container, so it carries the same
// border, radius, shadow and press-scale as every other card in the app
// instead of being the one flat outlined tile among them. Two changes came
// with that:
//
//  * The city moved from a plain icon+text line into a quiet pill, which
//    reads as a property of the warehouse rather than as a second title. It
//    matters more now that the list can be showing other cities.
//  * The phone number line is gone. It sat directly above a WhatsApp button
//    carrying the same number, it is the least scannable thing that can go in
//    a ~170px tile, and the profile screen shows it in full.
//
// Compact pass: the tile is shorter so more warehouses fit on a screen, with
// nothing taken off the card.
//
//  * The logo is a fixed-height strip rather than a 1.4 aspect-ratio block.
//    On a phone tile that frames it at about the 2.2 the profile header uses,
//    so the pharmacist sees the same crop in both places - and a fixed height
//    keeps the card's height independent of the column width, which the
//    grid's fixed tile height depends on.
//  * The text block and the action row share one inset, so the name lines up
//    with the button beneath it. The buttons keep their 36px height: the card
//    got smaller, its tap targets did not.
//  * Colours drawn on the card use textOf, not navyOf. In night mode navy is a
//    surface colour identical to the card's own fill, which left the
//    "Profile" label and the no-logo glyph invisible; in day mode the two
//    tokens are the same navy, so nothing changes there.
//
// Deliberately absent: a rating. Warehouse.averageRating/reviewsCount are not
// kept current on the document (see the backend's warehouse.service.js, which
// recomputes them live for the profile screen for exactly that reason) and
// they aren't in this endpoint's payload, so a rating here would be a stale
// number presented as a fact.
class WarehouseCard extends StatelessWidget {
  const WarehouseCard({
    super.key,
    required this.warehouse,
    required this.onSelect,
    required this.onViewProfile,
  });

  final WarehouseModel warehouse;
  final VoidCallback onSelect;
  final VoidCallback onViewProfile;

  /// Height of the logo strip - public so the loading skeleton can match it.
  static const double logoHeight = 80;

  static const double _inset = AppSizes.spacingSmall + 2;
  static const double _actionHeight = 36;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';
    final name = isArabic ? warehouse.nameAr : warehouse.nameEn;

    return CustomCard(
      // The logo runs edge to edge, so the card owns no padding of its own -
      // the text block below applies its own.
      padding: EdgeInsets.zero,
      onTap: onSelect,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _LogoBanner(url: warehouse.logo),
          Padding(
            padding: const EdgeInsets.fromLTRB(_inset, _inset, _inset, 0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name,
                  style: context.textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.w700,
                    height: 1.25,
                  ),
                  // Two lines: warehouse names in Arabic routinely outrun a
                  // ~170px tile, and truncating one to "مستودع الشام لل..."
                  // costs the pharmacist the one word that identifies it.
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: AppSizes.spacingXSmall + 2),
                _CityPill(city: warehouse.city),
              ],
            ),
          ),
          // Absorbs whatever height a one-line name leaves over, so the action
          // row stays pinned to the bottom edge and every card in the grid
          // lines up regardless of how long its name is.
          const Spacer(),
          Padding(
            padding: const EdgeInsets.fromLTRB(
              _inset,
              AppSizes.spacingSmall,
              _inset,
              _inset,
            ),
            child: Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: onViewProfile,
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppColors.textOf(context),
                      side: BorderSide(color: AppColors.borderOf(context)),
                      shape: const RoundedRectangleBorder(borderRadius: AppRadius.small),
                      // No vertical padding: the minimum size alone sets the
                      // height, so a larger text scale doesn't grow the row.
                      padding: const EdgeInsets.symmetric(horizontal: AppSizes.spacingSmall),
                      minimumSize: const Size(0, _actionHeight),
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    ),
                    child: Text(
                      l10n.warehouseProfileButtonLabel,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: context.textTheme.bodySmall?.copyWith(
                        fontWeight: AppTextTheme.semiBold,
                        color: AppColors.textOf(context),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: AppSizes.spacingSmall),
                WhatsAppButton(phone: warehouse.phone, size: _actionHeight),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _LogoBanner extends StatelessWidget {
  const _LogoBanner({required this.url});

  final String? url;

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        SizedBox(
          height: WarehouseCard.logoHeight,
          width: double.infinity,
          child: AppNetworkImage(
            url: url,
            fit: BoxFit.cover,
            // A warehouse with no logo yet gets a calm tinted panel rather
            // than a grey void - the app's text colour at low alpha, so it
            // reads as a placeholder, not as content, in both themes.
            fallback: Container(
              color: AppColors.textOf(context).withValues(alpha: 0.06),
              alignment: Alignment.center,
              child: Icon(
                Icons.local_shipping_outlined,
                color: AppColors.textOf(context).withValues(alpha: 0.45),
                size: AppSizes.iconSizeMedium + 4,
              ),
            ),
          ),
        ),
        // A hairline that separates the image from the text block without a
        // full Divider's vertical cost - matters most for a light logo on the
        // light surface, where the two would otherwise bleed together.
        PositionedDirectional(
          start: 0,
          end: 0,
          bottom: 0,
          child: Container(height: 1, color: AppColors.borderOf(context)),
        ),
      ],
    );
  }
}

/// The city, as a quiet pill rather than a second line of title-weight text.
class _CityPill extends StatelessWidget {
  const _CityPill({required this.city});

  final String city;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: AppSizes.spacingXSmall + 2, vertical: 2),
      decoration: BoxDecoration(
        color: AppColors.surfaceOf(context),
        borderRadius: AppRadius.full,
        border: Border.all(color: AppColors.borderOf(context)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.location_on_outlined,
            size: 12,
            color: AppColors.textSecondaryOf(context),
          ),
          const SizedBox(width: 3),
          Flexible(
            child: Text(
              city,
              style: context.textTheme.bodySmall?.copyWith(
                color: AppColors.textSecondaryOf(context),
                fontWeight: AppTextTheme.semiBold,
                fontSize: 11,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}
