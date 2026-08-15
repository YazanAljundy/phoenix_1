import 'package:flutter/material.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/widgets/custom_card.dart';
import 'package:phoenix/features/cart/data/models/order_line_item.dart';

// Section 6.8: the digital invoice - full line items plus the same
// totalPrice -> discountAmount -> finalPrice breakdown computed at order
// creation (Section 4). commissionAmount is deliberately not shown: it's the
// platform's cut of the warehouse's payout, not a charge to the pharmacy.
//
// Section 6.9: the return action is now per-order, not per-item (one return
// covers every problem item at once) - see _ReturnStatusSection in
// order_tracking_view.dart for that, rendered separately below this card.
class OrderInvoiceSection extends StatelessWidget {
  const OrderInvoiceSection({
    super.key,
    required this.items,
    required this.totalPrice,
    required this.discountAmount,
    required this.finalPrice,
  });

  final List<OrderLineItem> items;
  final num totalPrice;
  final num discountAmount;
  final num finalPrice;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return CustomCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(l10n.invoiceTitle, style: context.textTheme.titleMedium),
          const SizedBox(height: AppSizes.spacingSmall),
          ...items.map((item) => _InvoiceLineRow(item: item)),
          const Divider(height: AppSizes.spacingLarge),
          _TotalsRow(label: l10n.subtotalLabel, amount: totalPrice),
          if (discountAmount > 0)
            _TotalsRow(label: l10n.discountLabel, amount: -discountAmount),
          const SizedBox(height: AppSizes.spacingXSmall),
          _TotalsRow(label: l10n.invoiceTotalLabel, amount: finalPrice, emphasized: true),
        ],
      ),
    );
  }
}

class _InvoiceLineRow extends StatelessWidget {
  const _InvoiceLineRow({required this.item});

  final OrderLineItem item;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';
    final name = isArabic ? item.productNameAr : item.productNameEn;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSizes.spacingXSmall),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(name, style: context.textTheme.bodyMedium),
                const SizedBox(height: 2),
                Wrap(
                  crossAxisAlignment: WrapCrossAlignment.center,
                  spacing: AppSizes.spacingXSmall,
                  children: [
                    Text(
                      '${item.quantity} × ',
                      style: context.textTheme.bodySmall?.copyWith(
                        color: AppColors.textSecondaryOf(context),
                      ),
                    ),
                    if (item.hasOffer)
                      Text(
                        '${item.unitPrice}',
                        style: TextStyle(
                          decoration: TextDecoration.lineThrough,
                          color: AppColors.textSecondaryOf(context),
                          fontSize: 12,
                        ),
                      ),
                    Text(
                      '${item.discountPrice} ${l10n.currencySuffix}',
                      style: context.textTheme.bodySmall?.copyWith(
                        color: AppColors.textSecondaryOf(context),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          Text(
            '${item.lineTotal} ${l10n.currencySuffix}',
            style: context.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.bold),
          ),
        ],
      ),
    );
  }
}

class _TotalsRow extends StatelessWidget {
  const _TotalsRow({required this.label, required this.amount, this.emphasized = false});

  final String label;
  final num amount;
  final bool emphasized;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final style = emphasized
        ? context.textTheme.titleMedium?.copyWith(color: AppColors.primaryOf(context))
        : context.textTheme.bodyMedium;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: style),
          Text('$amount ${l10n.currencySuffix}', style: style),
        ],
      ),
    );
  }
}
