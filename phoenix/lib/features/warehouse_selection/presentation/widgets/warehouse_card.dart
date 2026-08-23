import 'package:flutter/material.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_radius.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/widgets/whatsapp_button.dart';
import 'package:phoenix/features/warehouse_selection/data/models/warehouse_model.dart';

// Section 17 (redesign): tapping the card itself now selects the warehouse
// (continues to /manufacturers) - the old full-width "Select" button is
// gone, replaced by a plainly-labeled "Profile" button alongside a WhatsApp
// button in their own row. This intentionally supersedes the small (i) icon
// this card used right after WarehouseProfileView shipped - a labeled
// button is a clearer, more discoverable affordance than a tiny icon next
// to the name.
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

    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: AppColors.surfaceElevatedOf(context),
        borderRadius: AppRadius.large,
        border: Border.all(color: AppColors.borderOf(context)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          InkWell(
            onTap: onSelect,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _LogoBanner(url: warehouse.logo),
                Padding(
                  padding: const EdgeInsets.fromLTRB(12, 10, 12, 2),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        name,
                        style: context.textTheme.titleMedium,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: AppSizes.spacingXSmall),
                      _IconLine(icon: Icons.location_on_outlined, text: warehouse.city),
                      const SizedBox(height: 2),
                      _IconLine(icon: Icons.call_outlined, text: warehouse.phone, ltr: true),
                    ],
                  ),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(10, 8, 10, 10),
            child: Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: onViewProfile,
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppColors.navyOf(context),
                      side: BorderSide(color: AppColors.borderOf(context)),
                      shape: const RoundedRectangleBorder(borderRadius: AppRadius.small),
                      padding: const EdgeInsets.symmetric(vertical: 8),
                    ),
                    child: Text(
                      l10n.warehouseProfileButtonLabel,
                      style: const TextStyle(fontSize: 12),
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
    return AspectRatio(
      aspectRatio: 1.7,
      child: Container(
        color: AppColors.surfaceOf(context),
        child: url == null || url!.isEmpty
            ? Icon(Icons.local_shipping_outlined, color: AppColors.navyOf(context), size: AppSizes.iconSizeLarge)
            : Image.network(
                url!,
                fit: BoxFit.cover,
                errorBuilder: (context, error, stackTrace) => Icon(
                  Icons.local_shipping_outlined,
                  color: AppColors.navyOf(context),
                  size: AppSizes.iconSizeLarge,
                ),
              ),
      ),
    );
  }
}

class _IconLine extends StatelessWidget {
  const _IconLine({required this.icon, required this.text, this.ltr = false});

  final IconData icon;
  final String text;
  final bool ltr;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, size: AppSizes.iconSizeSmall, color: AppColors.textSecondaryOf(context)),
        const SizedBox(width: AppSizes.spacingXSmall),
        Expanded(
          child: Text(
            text,
            textDirection: ltr ? TextDirection.ltr : null,
            style: context.textTheme.bodySmall?.copyWith(
              color: AppColors.textSecondaryOf(context),
              fontWeight: FontWeight.w600,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }
}
