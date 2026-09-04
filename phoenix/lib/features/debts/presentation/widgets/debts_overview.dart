import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_radius.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/error/error_translator.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/utils/currency_formatter.dart';
import 'package:phoenix/core/widgets/custom_card.dart';
import 'package:phoenix/core/widgets/failure_widget.dart';
import 'package:phoenix/features/debts/data/models/warehouse_debt_model.dart';
import 'package:phoenix/features/debts/presentation/managers/debts_cubit.dart';
import 'package:phoenix/features/debts/presentation/managers/debts_state.dart';
import 'package:phoenix/features/exchange_rate/presentation/managers/exchange_rate_cubit.dart';
import 'package:phoenix/routes/route_names.dart';

// Section 16: the pharmacist's "my debts" list - one row per warehouse they
// owe, plus a total. Extracted verbatim from ProfileView so the Account
// History screen's dedicated debts page (MyDebtsView) and the profile screen
// render the exact same thing from the exact same DebtsCubit. Tapping a row
// still opens the per-warehouse read-only DebtDetailView, unchanged.
class DebtsOverview extends StatelessWidget {
  const DebtsOverview({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';

    return BlocBuilder<DebtsCubit, DebtsState>(
      builder: (context, debtsState) {
        if (debtsState.status == DebtsStatus.loading ||
            debtsState.status == DebtsStatus.initial) {
          return const SizedBox(
            height: 24,
            child: Center(child: CircularProgressIndicator(strokeWidth: 2)),
          );
        }
        // A failed load must not masquerade as "no debts yet".
        if (debtsState.status == DebtsStatus.error && debtsState.debts.isEmpty) {
          return FailureWidget(
            dense: true,
            message: translateErrorCode(
              l10n,
              debtsState.errorCode,
              debtsState.errorMessage ?? l10n.errorState,
            ),
            onRetry: () => context.read<DebtsCubit>().load(),
          );
        }
        if (debtsState.debts.isEmpty) {
          return _EmptyHint(l10n.noDebtsYet);
        }
        final usdToSyp = context.watch<ExchangeRateCubit>().state.usdToSyp;
        final total = debtsState.debts.fold<num>(0, (sum, d) => sum + d.balanceUsd);
        final totalUsdHint = usdHintFromUsd(total, usdToSyp);

        return CustomCard(
          padding: const EdgeInsets.symmetric(
            horizontal: AppSizes.spacingMedium,
            vertical: AppSizes.spacingSmall,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (final debt in debtsState.debts)
                _DebtTile(debt: debt, isArabic: isArabic, usdToSyp: usdToSyp),
              Divider(height: AppSizes.spacingLarge, color: AppColors.borderOf(context)),
              Padding(
                padding: const EdgeInsets.only(bottom: AppSizes.spacingSmall),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(l10n.totalDebtsLabel, style: context.textTheme.titleSmall),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Text(
                          formatMoneyFromUsd(total, usdToSyp, l10n.currencySuffix),
                          style: context.textTheme.titleMedium?.copyWith(
                            color: AppColors.errorOf(context),
                          ),
                        ),
                        if (totalUsdHint != null)
                          Text(
                            totalUsdHint,
                            style: context.textTheme.bodySmall?.copyWith(
                              color: AppColors.textSecondaryOf(context),
                            ),
                          ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

// A soft bordered strip rather than bare text, so an empty section still
// looks intentional. Same treatment as ProfileView's shared empty hint.
class _EmptyHint extends StatelessWidget {
  const _EmptyHint(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(
        horizontal: AppSizes.spacingMedium,
        vertical: AppSizes.spacingMedium,
      ),
      decoration: BoxDecoration(
        color: AppColors.surfaceOf(context),
        borderRadius: AppRadius.medium,
        border: Border.all(color: AppColors.borderOf(context)),
      ),
      child: Text(
        text,
        style: context.textTheme.bodyMedium?.copyWith(
          color: AppColors.textSecondaryOf(context),
        ),
      ),
    );
  }
}

// Section 16: one row of "my debts" - tapping it opens the read-only detail
// screen (orders + payments) for that one warehouse, see DebtDetailView. The
// design's per-row "last payment date" isn't shown - WarehouseDebtModel
// doesn't carry it.
class _DebtTile extends StatelessWidget {
  const _DebtTile({required this.debt, required this.isArabic, required this.usdToSyp});

  final WarehouseDebtModel debt;
  final bool isArabic;
  final double? usdToSyp;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final name = isArabic ? debt.nameAr : (debt.nameEn ?? debt.nameAr);
    final usdHint = usdHintFromUsd(debt.balanceUsd, usdToSyp);

    return InkWell(
      onTap: () => context.pushNamed(
        RouteNames.debtDetail,
        pathParameters: {'warehouseId': debt.warehouseId},
        extra: name,
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: AppSizes.spacingSmall),
        child: Row(
          children: [
            Container(
              width: 34,
              height: 34,
              decoration: BoxDecoration(
                color: AppColors.surfaceOf(context),
                borderRadius: AppRadius.small,
              ),
              child: Icon(Icons.storefront_outlined, size: 17, color: AppColors.textSecondaryOf(context)),
            ),
            const SizedBox(width: AppSizes.spacingSmall),
            Expanded(
              child: Text(
                name,
                style: context.textTheme.bodyMedium,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            const SizedBox(width: AppSizes.spacingSmall),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  formatMoneyFromUsd(debt.balanceUsd, usdToSyp, l10n.currencySuffix),
                  style: context.textTheme.bodyMedium?.copyWith(
                    color: AppColors.errorOf(context),
                    fontWeight: FontWeight.bold,
                  ),
                ),
                if (usdHint != null)
                  Text(
                    usdHint,
                    style: context.textTheme.bodySmall?.copyWith(
                      fontSize: 10.5,
                      color: AppColors.textSecondaryOf(context),
                    ),
                  ),
              ],
            ),
            const SizedBox(width: AppSizes.spacingXSmall),
            Icon(Icons.chevron_right, size: AppSizes.iconSizeSmall, color: AppColors.textSecondaryOf(context)),
          ],
        ),
      ),
    );
  }
}
