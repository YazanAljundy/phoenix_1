import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/utils/currency_formatter.dart';
import 'package:phoenix/core/widgets/custom_card.dart';
import 'package:phoenix/core/widgets/secondary_price_hint.dart';
import 'package:phoenix/features/cart/data/models/order_line_item.dart';
import 'package:phoenix/features/exchange_rate/presentation/managers/exchange_rate_cubit.dart';

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
    this.advertisementDiscountAmount = 0,
    required this.finalPrice,
  });

  final List<OrderLineItem> items;
  final num totalPrice;
  final num discountAmount;
  // The package discount when this order came from a warehouse advertisement -
  // its own line, never folded into discountAmount above (which is the
  // platform's rate-derived cut). 0 on a normal order, which is how every
  // order placed before packages existed reads.
  final num advertisementDiscountAmount;
  final num finalPrice;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    // Section 15: savings are no longer broken out per line - one combined
    // total at the foot of the invoice instead (see _InvoiceLineRow below).
    // savingsUsd is USD-native (see OrderLineItem) - shown in SYP at the live
    // rate, like the rest of the invoice.
    final totalSavingsUsd = items.fold<num>(0, (sum, item) => sum + (item.savingsUsd ?? 0));
    final usdToSyp = context.watch<ExchangeRateCubit>().state.usdToSyp;

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
          if (advertisementDiscountAmount > 0)
            _TotalsRow(
              label: l10n.advertisementDiscountLabel,
              amount: -advertisementDiscountAmount,
            ),
          const SizedBox(height: AppSizes.spacingXSmall),
          _TotalsRow(label: l10n.invoiceTotalLabel, amount: finalPrice, emphasized: true),
          if (totalSavingsUsd > 0) ...[
            const SizedBox(height: AppSizes.spacingXSmall),
            Text(
              l10n.totalSavingsLabel(formatMoneyFromUsd(totalSavingsUsd, usdToSyp, l10n.currencySuffix)),
              style: context.textTheme.bodySmall?.copyWith(
                color: AppColors.secondaryOf(context),
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
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
    final name = isArabic ? item.productNameAr : (item.productNameEn ?? item.productNameAr);

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
                // Section 15: the original price only - no strikethrough, no
                // discounted number, no per-line savings. Any discount is
                // communicated once, combined, at the foot of the invoice
                // (see OrderInvoiceSection's totalSavingsUsd).
                Text(
                  '${item.quantity} × ${formatSyp(item.unitPrice, l10n.currencySuffix)}',
                  style: context.textTheme.bodySmall?.copyWith(
                    color: AppColors.textSecondaryOf(context),
                  ),
                ),
              ],
            ),
          ),
          Text(
            formatSyp(item.lineTotal, l10n.currencySuffix),
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

    // The USD hint only makes sense on the grand total - a per-row
    // conversion for the subtotal/discount lines above it would be noise,
    // not useful context.
    final usdToSyp = emphasized ? context.watch<ExchangeRateCubit>().state.usdToSyp : null;
    final usdText = emphasized ? formatUsdApprox(amount, usdToSyp) : null;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Flexible(
            child: Text(label, style: style, maxLines: 1, overflow: TextOverflow.ellipsis),
          ),
          Flexible(
            child: Wrap(
              alignment: WrapAlignment.end,
              crossAxisAlignment: WrapCrossAlignment.center,
              spacing: AppSizes.spacingXSmall,
              children: [
                Text(formatSyp(amount, l10n.currencySuffix), style: style),
                if (usdText != null) SecondaryPriceHint(text: usdText),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
