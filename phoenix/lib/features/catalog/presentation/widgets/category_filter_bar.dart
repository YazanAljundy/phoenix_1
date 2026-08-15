import 'package:flutter/material.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/features/catalog/data/models/category_model.dart';

class CategoryFilterBar extends StatelessWidget {
  const CategoryFilterBar({
    super.key,
    required this.categories,
    required this.selectedCategoryId,
    required this.onSelect,
  });

  final List<CategoryModel> categories;
  final String? selectedCategoryId;
  final ValueChanged<String?> onSelect;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';

    return SizedBox(
      height: 44,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: AppSizes.spacingMedium),
        itemCount: categories.length + 1,
        separatorBuilder: (context, index) => const SizedBox(width: AppSizes.spacingSmall),
        itemBuilder: (context, index) {
          if (index == 0) {
            return ChoiceChip(
              label: Text(l10n.allCategories),
              selected: selectedCategoryId == null,
              selectedColor: AppColors.primaryOf(context).withValues(alpha: 0.15),
              onSelected: (_) => onSelect(null),
            );
          }
          final category = categories[index - 1];
          final name = isArabic ? category.nameAr : category.nameEn;
          return ChoiceChip(
            label: Text(name),
            selected: selectedCategoryId == category.id,
            selectedColor: AppColors.primaryOf(context).withValues(alpha: 0.15),
            onSelected: (_) => onSelect(category.id),
          );
        },
      ),
    );
  }
}
