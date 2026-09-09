import 'package:flutter/material.dart';
import 'package:feniq/core/constants/app_colors.dart';
import 'package:feniq/core/constants/app_sizes.dart';
import 'package:feniq/core/extensions/build_context_extensions.dart';

/// The "my city" / "all cities" switch above the warehouse grid.
///
/// The screen opens narrowed to the pharmacy's own city, so this bar's job is
/// to make widening obvious rather than to be discovered: two plain chips in
/// the open, on the row above the list, not a filter icon or a settings entry.
/// It follows the same ChoiceChip language as the Offers & Ads filter bar so
/// the two screens read as one app.
///
/// The caller only renders this when the server has confirmed it can actually
/// filter this pharmacy by city (WarehouseSelectionState.cityScopeAvailable) -
/// a toggle that couldn't change anything is worse than no toggle.
class WarehouseCityScopeBar extends StatelessWidget {
  const WarehouseCityScopeBar({
    super.key,
    required this.onlyMyCity,
    required this.isBusy,
    required this.onChanged,
  });

  final bool onlyMyCity;

  /// A scope change is in flight. The list underneath deliberately keeps
  /// showing the old results while that happens, so the progress has to be
  /// reported here or the tap would look like it did nothing.
  final bool isBusy;

  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppSizes.spacingMedium,
        AppSizes.spacingMedium,
        AppSizes.spacingMedium,
        AppSizes.spacingXSmall,
      ),
      child: Row(
        children: [
          _ScopeChip(
            label: l10n.warehousesScopeMyCity,
            icon: Icons.my_location_outlined,
            selected: onlyMyCity,
            // Ignored while a change is in flight rather than disabled: a
            // greyed-out pair of chips mid-tap reads as breakage.
            onSelected: isBusy ? null : () => onChanged(true),
          ),
          const SizedBox(width: AppSizes.spacingSmall),
          _ScopeChip(
            label: l10n.warehousesScopeAllCities,
            icon: Icons.public_outlined,
            selected: !onlyMyCity,
            onSelected: isBusy ? null : () => onChanged(false),
          ),
          if (isBusy) ...[
            const SizedBox(width: AppSizes.spacingSmall),
            SizedBox(
              width: 14,
              height: 14,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: AppColors.textSecondaryOf(context),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _ScopeChip extends StatelessWidget {
  const _ScopeChip({
    required this.label,
    required this.icon,
    required this.selected,
    required this.onSelected,
  });

  final String label;
  final IconData icon;
  final bool selected;
  final VoidCallback? onSelected;

  @override
  Widget build(BuildContext context) {
    final accent = AppColors.primaryOf(context);

    return ChoiceChip(
      avatar: Icon(
        icon,
        size: AppSizes.iconSizeSmall,
        color: selected ? accent : AppColors.textSecondaryOf(context),
      ),
      label: Text(label),
      selected: selected,
      onSelected: onSelected == null ? null : (_) => onSelected!(),
      showCheckmark: false,
      labelStyle: context.textTheme.bodySmall?.copyWith(
        color: selected ? accent : AppColors.textOf(context),
        fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
      ),
      backgroundColor: AppColors.surfaceOf(context),
      selectedColor: accent.withValues(alpha: 0.12),
      side: BorderSide(
        color: selected ? accent.withValues(alpha: 0.4) : AppColors.borderOf(context),
      ),
      shape: const StadiumBorder(),
    );
  }
}
