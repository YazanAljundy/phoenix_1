import 'package:flutter/material.dart';
import 'package:phoenix/core/constants/app_padding.dart';
import 'package:phoenix/core/constants/app_radius.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/widgets/primary_button.dart';
import 'package:phoenix/core/widgets/quantity_stepper.dart';

// Shown before a product is actually added to the cart (Section 17) - a
// quantity chosen up front instead of always starting at 1 and tapping +
// repeatedly. No max/stock validation here (the warehouse is the one that
// enforces that, at order time) - only enough to guarantee a sane positive
// integer reaches CartCubit. The number lives here purely because the product
// isn't in the cart yet; once it is, the product card shows a stepper bound to
// the real cart quantity instead.
Future<int?> showQuantityPickerSheet(BuildContext context, {int initialQuantity = 1}) {
  return showModalBottomSheet<int>(
    context: context,
    isScrollControlled: true,
    builder: (context) => _QuantityPickerSheet(initialQuantity: initialQuantity),
  );
}

class _QuantityPickerSheet extends StatefulWidget {
  const _QuantityPickerSheet({required this.initialQuantity});

  final int initialQuantity;

  @override
  State<_QuantityPickerSheet> createState() => _QuantityPickerSheetState();
}

class _QuantityPickerSheetState extends State<_QuantityPickerSheet> {
  late int _quantity = widget.initialQuantity < 1 ? 1 : widget.initialQuantity;

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
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(l10n.returnQuantityLabel, style: context.textTheme.titleMedium),
              QuantityStepper(
                quantity: _quantity,
                liveUpdate: true,
                decrementTooltip: l10n.decreaseQuantityLabel,
                incrementTooltip: l10n.increaseQuantityLabel,
                onChanged: (value) => setState(() => _quantity = value),
              ),
            ],
          ),
          const SizedBox(height: AppSizes.spacingMedium),
          PrimaryButton(
            label: l10n.addToCartButton,
            onPressed: () {
              // Fold in a quantity the user typed but hasn't blurred yet
              // before the sheet closes with the value.
              FocusScope.of(context).unfocus();
              Navigator.pop(context, _quantity);
            },
          ),
        ],
      ),
    );
  }
}
