import 'package:flutter/material.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_radius.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/widgets/custom_card.dart';

// The pharmacist's entry into a warehouse's catalog is now this card, not a
// medicine directly - tapping one filters the catalog down to this
// manufacturer's own medicines (see ManufacturersView).
class ManufacturerCard extends StatelessWidget {
  const ManufacturerCard({super.key, required this.manufacturer, required this.onSelect});

  final String manufacturer;
  final VoidCallback onSelect;

  @override
  Widget build(BuildContext context) {
    return CustomCard(
      onTap: onSelect,
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: AppColors.surfaceOf(context),
              borderRadius: AppRadius.small,
            ),
            child: Icon(Icons.factory_outlined, color: AppColors.navyOf(context)),
          ),
          const SizedBox(width: AppSizes.spacingMedium),
          Expanded(
            child: Text(
              manufacturer,
              style: context.textTheme.titleMedium,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          Icon(
            Icons.chevron_right,
            color: AppColors.textSecondaryOf(context),
          ),
        ],
      ),
    );
  }
}
