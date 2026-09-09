import 'package:flutter/material.dart';
import 'package:feniq/core/constants/app_colors.dart';
import 'package:feniq/core/constants/app_sizes.dart';
import 'package:feniq/core/extensions/build_context_extensions.dart';
import 'package:feniq/features/promotions/data/models/promotion.dart';

/// The Offers & Ads filters: what kind, and from which warehouse.
///
/// One quiet scrollable row rather than a screen of its own - three choice
/// chips for the type and a single chip for the warehouse, which opens a small
/// sheet. Nothing is filtered on the server; the whole live list is already in
/// memory (see PromotionsState.filtered), so every tap is instant.
///
/// There is deliberately no search box: the list holds the promotions actually
/// running right now, which is a handful, and the two filters below already cut
/// it down faster than typing would.
class PromotionFilterBar extends StatelessWidget {
  const PromotionFilterBar({
    super.key,
    required this.kindFilter,
    required this.warehouseFilter,
    required this.warehouses,
    required this.onKindChanged,
    required this.onWarehouseChanged,
  });

  final PromotionKind? kindFilter;
  final String? warehouseFilter;
  final List<PromotionWarehouse> warehouses;
  final ValueChanged<PromotionKind?> onKindChanged;
  final ValueChanged<String?> onWarehouseChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';

    final matches = warehouseFilter == null
        ? const <PromotionWarehouse>[]
        : warehouses.where((w) => w.id == warehouseFilter).toList();
    final selectedWarehouse = matches.isEmpty ? null : matches.first;

    return SizedBox(
      height: 44,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: AppSizes.spacingMedium),
        children: [
          _KindChip(
            label: l10n.promotionsFilterAllTypes,
            selected: kindFilter == null,
            onSelected: () => onKindChanged(null),
          ),
          _KindChip(
            label: l10n.promotionsFilterOffers,
            selected: kindFilter == PromotionKind.offer,
            onSelected: () => onKindChanged(PromotionKind.offer),
          ),
          _KindChip(
            label: l10n.promotionsFilterPackages,
            selected: kindFilter == PromotionKind.package,
            onSelected: () => onKindChanged(PromotionKind.package),
          ),
          // Only worth offering when there is more than one warehouse to
          // choose between.
          if (warehouses.length > 1) ...[
            Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: AppSizes.spacingSmall,
                vertical: AppSizes.spacingSmall,
              ),
              child: VerticalDivider(width: 1, color: AppColors.borderOf(context)),
            ),
            Padding(
              padding: const EdgeInsetsDirectional.only(end: AppSizes.spacingSmall),
              child: ActionChip(
                avatar: Icon(
                  Icons.storefront_outlined,
                  size: AppSizes.iconSizeSmall,
                  color: selectedWarehouse == null
                      ? AppColors.textSecondaryOf(context)
                      : AppColors.primaryOf(context),
                ),
                label: Text(
                  selectedWarehouse?.name(isArabic) ?? l10n.promotionsAllWarehouses,
                  style: context.textTheme.bodySmall?.copyWith(
                    color: selectedWarehouse == null
                        ? AppColors.textOf(context)
                        : AppColors.primaryOf(context),
                    fontWeight: selectedWarehouse == null ? FontWeight.w500 : FontWeight.w700,
                  ),
                ),
                onPressed: () => _pickWarehouse(context),
                backgroundColor: selectedWarehouse == null
                    ? AppColors.surfaceOf(context)
                    : AppColors.primaryOf(context).withValues(alpha: 0.12),
                side: BorderSide(
                  color: selectedWarehouse == null
                      ? AppColors.borderOf(context)
                      : AppColors.primaryOf(context).withValues(alpha: 0.4),
                ),
                shape: const StadiumBorder(),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Future<void> _pickWarehouse(BuildContext context) async {
    final l10n = context.l10n;
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';

    final chosen = await showModalBottomSheet<String?>(
      context: context,
      backgroundColor: AppColors.surfaceElevatedOf(context),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (sheetContext) {
        Widget row({required String label, required String? value}) {
          final selected = value == warehouseFilter;
          return ListTile(
            title: Text(
              label,
              style: sheetContext.textTheme.bodyMedium?.copyWith(
                color: selected
                    ? AppColors.primaryOf(sheetContext)
                    : AppColors.textOf(sheetContext),
                fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
              ),
            ),
            trailing: selected
                ? Icon(Icons.check, color: AppColors.primaryOf(sheetContext))
                : null,
            // "All warehouses" is itself a null id, so it pops the sentinel
            // instead - that keeps it distinguishable from a dismissed sheet,
            // which pops null.
            onTap: () => Navigator.of(sheetContext).pop<String?>(value ?? _allWarehouses),
          );
        }

        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  AppSizes.spacingMedium,
                  AppSizes.spacingMedium,
                  AppSizes.spacingMedium,
                  AppSizes.spacingSmall,
                ),
                child: Row(
                  children: [
                    Text(
                      l10n.promotionsWarehouseFilterTitle,
                      style: sheetContext.textTheme.titleSmall,
                    ),
                  ],
                ),
              ),
              Divider(height: 1, color: AppColors.borderOf(sheetContext)),
              Flexible(
                child: ListView(
                  shrinkWrap: true,
                  children: [
                    row(label: l10n.promotionsAllWarehouses, value: null),
                    for (final warehouse in warehouses)
                      row(label: warehouse.name(isArabic), value: warehouse.id),
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );

    if (chosen == null) return; // dismissed without choosing
    onWarehouseChanged(chosen == _allWarehouses ? null : chosen);
  }

  // Sentinel for "All warehouses", so a dismissed sheet (null) and an explicit
  // "all" choice stay distinguishable.
  static const String _allWarehouses = '__all__';
}

class _KindChip extends StatelessWidget {
  const _KindChip({required this.label, required this.selected, required this.onSelected});

  final String label;
  final bool selected;
  final VoidCallback onSelected;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsetsDirectional.only(end: AppSizes.spacingSmall),
      child: ChoiceChip(
        label: Text(label),
        selected: selected,
        onSelected: (_) => onSelected(),
        showCheckmark: false,
        labelStyle: context.textTheme.bodySmall?.copyWith(
          color: selected ? AppColors.primaryOf(context) : AppColors.textOf(context),
          fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
        ),
        backgroundColor: AppColors.surfaceOf(context),
        selectedColor: AppColors.primaryOf(context).withValues(alpha: 0.12),
        side: BorderSide(
          color: selected
              ? AppColors.primaryOf(context).withValues(alpha: 0.4)
              : AppColors.borderOf(context),
        ),
        shape: const StadiumBorder(),
      ),
    );
  }
}
