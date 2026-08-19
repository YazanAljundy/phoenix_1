import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_padding.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/utils/currency_formatter.dart';
import 'package:phoenix/core/utils/date_formatter.dart';
import 'package:phoenix/core/widgets/app_loading.dart';
import 'package:phoenix/core/widgets/custom_card.dart';
import 'package:phoenix/core/widgets/empty_view.dart';
import 'package:phoenix/core/widgets/error_view.dart';
import 'package:phoenix/core/widgets/secondary_price_hint.dart';
import 'package:phoenix/features/debts/data/models/debt_detail_model.dart';
import 'package:phoenix/features/debts/presentation/managers/debt_detail_cubit.dart';
import 'package:phoenix/features/debts/presentation/managers/debt_detail_state.dart';
import 'package:phoenix/features/exchange_rate/presentation/managers/exchange_rate_cubit.dart';

// Section 16: strictly read-only - no payment recording, editing, or
// deletion here. Only the warehouse's own web panel can act on a payment
// (see backend/warehousePayment routes); this screen just shows what
// already happened.
class DebtDetailView extends StatelessWidget {
  const DebtDetailView({super.key, required this.warehouseName});

  final String warehouseName;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return Scaffold(
      appBar: AppBar(
        backgroundColor: AppColors.navyOf(context),
        foregroundColor: Colors.white,
        title: Text(warehouseName, maxLines: 1, overflow: TextOverflow.ellipsis),
      ),
      body: BlocBuilder<DebtDetailCubit, DebtDetailState>(
        builder: (context, state) {
          if (state.status == DebtDetailStatus.initial || state.status == DebtDetailStatus.loading) {
            return const AppLoading();
          }
          if (state.status == DebtDetailStatus.error || state.detail == null) {
            return ErrorView(
              message: state.errorMessage ?? l10n.errorState,
              onRetry: () => context.read<DebtDetailCubit>().load(),
            );
          }

          final detail = state.detail!;
          return ListView(
            padding: AppPadding.screen,
            children: [
              _BalanceSummaryCard(detail: detail),
              const SizedBox(height: AppSizes.spacingXLarge),
              Text(l10n.deliveredOrdersTitle, style: context.textTheme.titleMedium),
              const SizedBox(height: AppSizes.spacingSmall),
              if (detail.orders.isEmpty)
                EmptyView(message: l10n.noOrdersYet)
              else
                CustomCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      for (final order in detail.orders) ...[
                        if (order != detail.orders.first) const Divider(height: AppSizes.spacingLarge),
                        _OrderRow(order: order),
                      ],
                    ],
                  ),
                ),
              const SizedBox(height: AppSizes.spacingXLarge),
              Text(l10n.paymentsTitle, style: context.textTheme.titleMedium),
              const SizedBox(height: AppSizes.spacingSmall),
              if (detail.payments.isEmpty)
                Text(
                  l10n.noPaymentsYet,
                  style: context.textTheme.bodyMedium?.copyWith(
                    color: AppColors.textSecondaryOf(context),
                  ),
                )
              else
                CustomCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      for (final payment in detail.payments) ...[
                        if (payment != detail.payments.first) const Divider(height: AppSizes.spacingLarge),
                        _PaymentRow(payment: payment),
                      ],
                    ],
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}

class _BalanceSummaryCard extends StatelessWidget {
  const _BalanceSummaryCard({required this.detail});

  final DebtDetailModel detail;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final isCredit = detail.balanceUsd < 0;
    final usdToSyp = context.watch<ExchangeRateCubit>().state.usdToSyp;
    final balanceSypText = formatSypApprox(detail.balanceUsd.abs(), usdToSyp, l10n.currencySuffix);

    return CustomCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _SummaryLine(label: l10n.totalOrdersLabel, valueUsd: detail.totalOrdersUsd),
          const SizedBox(height: AppSizes.spacingSmall),
          _SummaryLine(label: l10n.totalPaidLabel, valueUsd: detail.totalPaidUsd),
          const Divider(height: AppSizes.spacingLarge),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Flexible(
                child: Text(
                  isCredit ? l10n.creditBalanceLabel : l10n.currentBalanceLabel,
                  style: context.textTheme.titleMedium,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const SizedBox(width: AppSizes.spacingSmall),
              Flexible(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      '\$${detail.balanceUsd.abs()}',
                      style: context.textTheme.titleMedium?.copyWith(
                        color: isCredit ? AppColors.secondaryOf(context) : AppColors.errorOf(context),
                        fontWeight: FontWeight.bold,
                      ),
                      textAlign: TextAlign.end,
                    ),
                    if (balanceSypText != null) SecondaryPriceHint(text: balanceSypText),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _SummaryLine extends StatelessWidget {
  const _SummaryLine({required this.label, required this.valueUsd});

  final String label;
  final num valueUsd;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Flexible(
          child: Text(
            label,
            style: context.textTheme.bodyMedium?.copyWith(color: AppColors.textSecondaryOf(context)),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
        Flexible(
          // No ellipsis on the amount itself - truncating a monetary figure
          // would be misleading (an obscured "$27..." reads as a different,
          // smaller number). It wraps instead if genuinely squeezed.
          child: Text('\$$valueUsd', style: context.textTheme.bodyMedium, textAlign: TextAlign.end),
        ),
      ],
    );
  }
}

class _OrderRow extends StatelessWidget {
  const _OrderRow({required this.order});

  final DebtOrderModel order;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                l10n.orderNumberLabel(order.orderNumber.toString()),
                style: context.textTheme.bodyMedium,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              const SizedBox(height: 2),
              Text(
                DateFormatter.formatDate(order.createdAt),
                style: context.textTheme.bodySmall?.copyWith(color: AppColors.textSecondaryOf(context)),
              ),
            ],
          ),
        ),
        const SizedBox(width: AppSizes.spacingSmall),
        Text(
          '${order.finalPrice} ${l10n.currencySuffix}',
          style: context.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.bold),
        ),
      ],
    );
  }
}

class _PaymentRow extends StatelessWidget {
  const _PaymentRow({required this.payment});

  final DebtPaymentModel payment;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                DateFormatter.formatDateTime(payment.createdAt),
                style: context.textTheme.bodySmall?.copyWith(color: AppColors.textSecondaryOf(context)),
              ),
              if (payment.note != null && payment.note!.isNotEmpty) ...[
                const SizedBox(height: 2),
                Text(payment.note!, style: context.textTheme.bodyMedium),
              ],
            ],
          ),
        ),
        Text(
          '${payment.amount} ${payment.currency}',
          style: context.textTheme.bodyMedium?.copyWith(
            color: AppColors.secondaryOf(context),
            fontWeight: FontWeight.bold,
          ),
        ),
      ],
    );
  }
}
