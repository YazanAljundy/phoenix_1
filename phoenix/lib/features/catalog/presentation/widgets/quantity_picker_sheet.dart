import 'package:flutter/material.dart';
import 'package:phoenix/core/constants/app_padding.dart';
import 'package:phoenix/core/constants/app_radius.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/widgets/app_text_field.dart';
import 'package:phoenix/core/widgets/primary_button.dart';

// Shown before a product is actually added to the cart (Section 17) - a
// quantity chosen up front instead of always starting at 1 and tapping +
// repeatedly. No max/stock validation here (the warehouse is the one that
// enforces that, at order time) - only enough to guarantee a sane positive
// integer reaches CartCubit.
Future<int?> showQuantityPickerSheet(BuildContext context) {
  return showModalBottomSheet<int>(
    context: context,
    isScrollControlled: true,
    builder: (context) => const _QuantityPickerSheet(),
  );
}

class _QuantityPickerSheet extends StatefulWidget {
  const _QuantityPickerSheet();

  @override
  State<_QuantityPickerSheet> createState() => _QuantityPickerSheetState();
}

class _QuantityPickerSheetState extends State<_QuantityPickerSheet> {
  late final TextEditingController _controller = TextEditingController(text: '1');

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _submit() {
    final parsed = int.tryParse(_controller.text.trim());
    Navigator.pop(context, (parsed != null && parsed > 0) ? parsed : 1);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return Padding(
      padding: EdgeInsets.only(
        left: AppPadding.screen.left,
        right: AppPadding.screen.right,
        top: AppSizes.spacingMedium,
        bottom: MediaQuery.of(context).viewInsets.bottom + AppSizes.spacingLarge,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Center(
            child: Container(
              width: 40,
              height: 4,
              margin: const EdgeInsets.only(bottom: AppSizes.spacingMedium),
              decoration: BoxDecoration(
                color: Theme.of(context).dividerColor,
                borderRadius: AppRadius.full,
              ),
            ),
          ),
          AppTextField(
            label: l10n.returnQuantityLabel,
            controller: _controller,
            keyboardType: TextInputType.number,
          ),
          const SizedBox(height: AppSizes.spacingMedium),
          PrimaryButton(label: l10n.addToCartButton, onPressed: _submit),
        ],
      ),
    );
  }
}
