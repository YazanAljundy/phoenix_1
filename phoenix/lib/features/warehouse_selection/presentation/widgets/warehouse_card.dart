import 'package:flutter/material.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_radius.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/widgets/custom_card.dart';
import 'package:phoenix/core/widgets/whatsapp_button.dart';
import 'package:phoenix/features/warehouse_selection/data/models/warehouse_model.dart';

class WarehouseCard extends StatelessWidget {
  const WarehouseCard({
    super.key,
    required this.warehouse,
    required this.onSelect,
    required this.onViewProfile,
  });

  final WarehouseModel warehouse;
  final VoidCallback onSelect;
  // Section 17: a separate entry point from "Select" - opens the read-only
  // warehouse profile instead of continuing to /manufacturers.
  final VoidCallback onViewProfile;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';
    final name = isArabic ? warehouse.nameAr : warehouse.nameEn;

    return Stack(
      children: [
        CustomCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _Logo(url: warehouse.logo),
                  const SizedBox(width: AppSizes.spacingMedium),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                name,
                                style: context.textTheme.titleMedium,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                            _InfoButton(onTap: onViewProfile),
                          ],
                        ),
                        const SizedBox(height: AppSizes.spacingXSmall),
                        _IconLine(
                          icon: Icons.location_on_outlined,
                          text: warehouse.city,
                        ),
                        const SizedBox(height: AppSizes.spacingXSmall),
                        _IconLine(icon: Icons.phone_outlined, text: warehouse.phone),
                      ],
                    ),
                  ),
                  // Reserves the WhatsApp button's width so the name/city/phone
                  // column above never renders under it.
                  const SizedBox(width: AppSizes.iconSizeLarge),
                ],
              ),
              const SizedBox(height: AppSizes.spacingMedium),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: onSelect,
                  style: FilledButton.styleFrom(
                    backgroundColor: AppColors.primaryOf(context),
                    foregroundColor: Colors.white,
                    shape: const RoundedRectangleBorder(
                      borderRadius: AppRadius.medium,
                    ),
                    padding: const EdgeInsets.symmetric(vertical: 12),
                  ),
                  child: Text(l10n.selectWarehouseButton),
                ),
              ),
            ],
          ),
        ),
        PositionedDirectional(
          top: AppSizes.spacingXSmall,
          end: AppSizes.spacingXSmall,
          child: WhatsAppButton(phone: warehouse.phone),
        ),
      ],
    );
  }
}

class _Logo extends StatelessWidget {
  const _Logo({required this.url});

  final String? url;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: AppRadius.small,
      child: Container(
        width: 56,
        height: 56,
        color: AppColors.surfaceOf(context),
        child: url == null || url!.isEmpty
            ? Icon(
                Icons.local_shipping_outlined,
                color: AppColors.navyOf(context),
              )
            : Image.network(
                url!,
                fit: BoxFit.cover,
                errorBuilder: (context, error, stackTrace) => Icon(
                  Icons.local_shipping_outlined,
                  color: AppColors.navyOf(context),
                ),
              ),
      ),
    );
  }
}

class _InfoButton extends StatelessWidget {
  const _InfoButton({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return IconButton(
      onPressed: onTap,
      tooltip: context.l10n.warehouseProfileTooltip,
      icon: Icon(Icons.info_outline, color: AppColors.textSecondaryOf(context)),
      iconSize: AppSizes.iconSizeSmall,
      visualDensity: VisualDensity.compact,
      padding: EdgeInsets.zero,
      constraints: const BoxConstraints(),
    );
  }
}

class _IconLine extends StatelessWidget {
  const _IconLine({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, size: AppSizes.iconSizeSmall, color: AppColors.textSecondaryOf(context)),
        const SizedBox(width: AppSizes.spacingXSmall),
        Expanded(
          child: Text(
            text,
            style: context.textTheme.bodyMedium?.copyWith(
              color: AppColors.textSecondaryOf(context),
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }
}
