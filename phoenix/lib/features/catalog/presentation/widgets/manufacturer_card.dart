import 'package:flutter/material.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_radius.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/widgets/custom_card.dart';

// The pharmacist's entry into a warehouse's catalog is now this card, not a
// medicine directly - tapping one filters the catalog down to this
// manufacturer's own medicines (see ManufacturersView). A vertical tile
// (logo area over the name) rather than a wide row - matches the grid-of-
// tiles convention used for warehouses/products elsewhere in the app.
class ManufacturerCard extends StatelessWidget {
  const ManufacturerCard({super.key, required this.manufacturer, required this.onSelect});

  final String manufacturer;
  final VoidCallback onSelect;

  @override
  Widget build(BuildContext context) {
    return CustomCard(
      onTap: onSelect,
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          AspectRatio(
            aspectRatio: 1.6,
            child: Container(
              decoration: BoxDecoration(
                color: AppColors.surfaceOf(context),
                borderRadius: AppRadius.medium,
              ),
              child: Icon(
                Icons.factory_outlined,
                color: AppColors.navyOf(context),
                size: AppSizes.iconSizeLarge,
              ),
            ),
          ),
          const SizedBox(height: AppSizes.spacingSmall),
          Text(
            manufacturer,
            textAlign: TextAlign.center,
            style: context.textTheme.titleSmall,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
        ],
      ),
    );
  }
}
