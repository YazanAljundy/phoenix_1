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
// instead of being the one flat outlined tile among them. Three changes came
// with that:
//
//  * The logo is taller (a 1.4 banner rather than 1.7) - it is the only thing
//    that distinguishes one warehouse from another at a glance, so it earns
//    the space.
//  * The city moved from a plain icon+text line into a quiet pill, which
//    reads as a property of the warehouse rather than as a second title. It
//    matters more now that the list can be showing other cities.
//  * The phone number line is gone. It sat directly above a WhatsApp button
//    carrying the same number, it is the least scannable thing that can go in
//    a ~170px tile, and the profile screen shows it in full - dropping it is
//    what pays for the taller logo and the extra breathing room.
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
            padding: const EdgeInsets.fromLTRB(
              AppSizes.spacingMedium - 2,
              AppSizes.spacingMedium - 4,
              AppSizes.spacingMedium - 2,
              0,
            ),
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
                const SizedBox(height: AppSizes.spacingSmall),
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
              AppSizes.spacingMedium - 4,
              AppSizes.spacingSmall + 2,
              AppSizes.spacingMedium - 4,
              AppSizes.spacingMedium - 4,
            ),
            child: Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: onViewProfile,
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppColors.navyOf(context),
                      side: BorderSide(color: AppColors.borderOf(context)),
                      shape: const RoundedRectangleBorder(borderRadius: AppRadius.small),
                      padding: const EdgeInsets.symmetric(vertical: 9),
                      minimumSize: const Size(0, 36),
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    ),
                    child: Text(
                      l10n.warehouseProfileButtonLabel,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: context.textTheme.bodySmall?.copyWith(
                        fontWeight: AppTextTheme.semiBold,
                        color: AppColors.navyOf(context),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: AppSizes.spacingSmall),
                WhatsAppButton(phone: warehouse.phone, size: 36),
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
        AspectRatio(
          aspectRatio: 1.4,
          child: AppNetworkImage(
            url: url,
            fit: BoxFit.cover,
            // A warehouse with no logo yet gets a calm tinted panel rather
            // than a grey void - the same navy the app uses for empty states,
            // at low alpha so it reads as a placeholder, not as content.
            fallback: Container(
              color: AppColors.navyOf(context).withValues(alpha: 0.06),
              alignment: Alignment.center,
              child: Icon(
                Icons.local_shipping_outlined,
                color: AppColors.navyOf(context).withValues(alpha: 0.45),
                size: AppSizes.iconSizeLarge,
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
      padding: const EdgeInsets.symmetric(horizontal: AppSizes.spacingSmall, vertical: 3),
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
            size: 13,
            color: AppColors.textSecondaryOf(context),
          ),
          const SizedBox(width: AppSizes.spacingXSmall),
          Flexible(
            child: Text(
              city,
              style: context.textTheme.bodySmall?.copyWith(
                color: AppColors.textSecondaryOf(context),
                fontWeight: AppTextTheme.semiBold,
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
