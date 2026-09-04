import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_padding.dart';
import 'package:phoenix/core/constants/app_radius.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/error/error_translator.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/utils/currency_formatter.dart';
import 'package:phoenix/core/widgets/custom_card.dart';
import 'package:phoenix/features/account_history/presentation/managers/savings_cubit.dart';
import 'package:phoenix/features/account_history/presentation/managers/savings_state.dart';
import 'package:phoenix/features/debts/presentation/managers/debts_cubit.dart';
import 'package:phoenix/features/debts/presentation/managers/debts_state.dart';
import 'package:phoenix/features/exchange_rate/presentation/managers/exchange_rate_cubit.dart';
import 'package:phoenix/features/returns/presentation/managers/my_returns_cubit.dart';
import 'package:phoenix/features/returns/presentation/managers/my_returns_state.dart';
import 'package:phoenix/routes/route_names.dart';

// The pharmacy's financial home. It owns no business logic of its own: the
// three cards each read an existing cubit (SavingsCubit / DebtsCubit /
// MyReturnsCubit) and the Debts and Returns cards are just entry points into
// the pages that already exist. Each card loads and fails independently, so a
// dead exchange rate or a failing savings fetch never blanks the others.
class AccountHistoryView extends StatelessWidget {
  const AccountHistoryView({super.key});

  Future<void> _refreshAll(BuildContext context) async {
    await Future.wait([
      context.read<SavingsCubit>().load(),
      context.read<DebtsCubit>().load(),
      context.read<MyReturnsCubit>().load(),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return Scaffold(
      appBar: AppBar(
        backgroundColor: AppColors.navyOf(context),
        foregroundColor: Colors.white,
        title: Text(l10n.accountHistoryTitle),
      ),
      body: RefreshIndicator(
        onRefresh: () => _refreshAll(context),
        child: ListView(
          padding: AppPadding.screen,
          children: const [
            _MoneySavedCard(),
            SizedBox(height: AppSizes.spacingMedium),
            IntrinsicHeight(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Expanded(child: _DebtsCard()),
                  SizedBox(width: AppSizes.spacingMedium),
                  Expanded(child: _ReturnsCard()),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// Card 1 - the marketing/financial headline, so it gets the most weight: a
// full-width tinted panel, a filled icon badge and a large amount in the
// brand's positive green. The amount area keeps its height while loading so
// the layout doesn't jump.
class _MoneySavedCard extends StatelessWidget {
  const _MoneySavedCard();

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final accent = AppColors.secondaryOf(context);

    return Container(
      padding: const EdgeInsets.all(AppSizes.spacingLarge),
      decoration: BoxDecoration(
        color: accent.withValues(alpha: 0.10),
        borderRadius: AppRadius.large,
        border: Border.all(color: accent.withValues(alpha: 0.30)),
        boxShadow: [
          BoxShadow(
            color: accent.withValues(alpha: 0.10),
            blurRadius: 16,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(color: accent, borderRadius: AppRadius.medium),
                child: const Icon(Icons.savings_rounded, color: Colors.white, size: 24),
              ),
              const SizedBox(width: AppSizes.spacingMedium),
              Expanded(
                child: Text(
                  l10n.moneySavedTitle,
                  style: context.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSizes.spacingLarge),
          BlocBuilder<SavingsCubit, SavingsState>(
            builder: (context, state) {
              final usdToSyp = context.watch<ExchangeRateCubit>().state.usdToSyp;

              if (state.status == SavingsStatus.loading ||
                  state.status == SavingsStatus.initial) {
                return const _AmountPlaceholder(height: 34);
              }
              if (state.status == SavingsStatus.error) {
                return _InlineError(
                  message: translateErrorCode(l10n, state.errorCode, state.errorMessage ?? l10n.errorState),
                  onRetry: () => context.read<SavingsCubit>().load(),
                );
              }
              // scaleDown, never ellipsis - an obscured monetary figure reads
              // as a different, smaller number.
              return FittedBox(
                fit: BoxFit.scaleDown,
                alignment: AlignmentDirectional.centerStart,
                child: Text(
                  formatMoneyFromUsd(state.totalSavingsUsd, usdToSyp, l10n.currencySuffix),
                  style: context.textTheme.headlineMedium?.copyWith(
                    color: accent,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              );
            },
          ),
          const SizedBox(height: AppSizes.spacingXSmall),
          Text(
            l10n.fromDiscountsLabel,
            style: context.textTheme.bodyMedium?.copyWith(
              color: AppColors.textSecondaryOf(context),
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

// Card 2 - taps through to the existing debts page (MyDebtsView). Shows the
// same "sum every warehouse balance" total the profile screen shows.
class _DebtsCard extends StatelessWidget {
  const _DebtsCard();

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return _MiniCard(
      icon: Icons.account_balance_wallet_outlined,
      title: l10n.debtsTitle,
      caption: l10n.outstandingBalanceLabel,
      onTap: () => context.pushNamed(RouteNames.myDebts),
      value: BlocBuilder<DebtsCubit, DebtsState>(
        builder: (context, state) {
          if (state.status == DebtsStatus.loading || state.status == DebtsStatus.initial) {
            return const _AmountPlaceholder(height: 20);
          }
          if (state.status == DebtsStatus.error && state.debts.isEmpty) {
            return _MiniError(onRetry: () => context.read<DebtsCubit>().load());
          }
          final usdToSyp = context.watch<ExchangeRateCubit>().state.usdToSyp;
          final total = state.debts.fold<num>(0, (sum, d) => sum + d.balanceUsd);
          return FittedBox(
            fit: BoxFit.scaleDown,
            alignment: AlignmentDirectional.centerStart,
            child: Text(
              formatMoneyFromUsd(total, usdToSyp, l10n.currencySuffix),
              style: context.textTheme.titleMedium?.copyWith(
                color: AppColors.errorOf(context),
                fontWeight: FontWeight.w800,
              ),
            ),
          );
        },
      ),
    );
  }
}

// Card 3 - taps through to the existing Returns page (MyReturnsView).
class _ReturnsCard extends StatelessWidget {
  const _ReturnsCard();

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return _MiniCard(
      icon: Icons.assignment_return_outlined,
      title: l10n.returnsTitle,
      caption: l10n.viewReturnsLabel,
      onTap: () => context.pushNamed(RouteNames.myReturns),
      value: BlocBuilder<MyReturnsCubit, MyReturnsState>(
        builder: (context, state) {
          if (state.status == MyReturnsStatus.initial ||
              (state.status == MyReturnsStatus.loading && state.returns.isEmpty)) {
            return const _AmountPlaceholder(height: 20);
          }
          if (state.status == MyReturnsStatus.error && state.returns.isEmpty) {
            return _MiniError(onRetry: () => context.read<MyReturnsCubit>().load());
          }
          return FittedBox(
            fit: BoxFit.scaleDown,
            alignment: AlignmentDirectional.centerStart,
            child: Text(
              l10n.returnsRequestsShort(state.returns.length),
              style: context.textTheme.titleMedium?.copyWith(
                color: AppColors.navyOf(context),
                fontWeight: FontWeight.w800,
              ),
            ),
          );
        },
      ),
    );
  }
}

class _MiniCard extends StatelessWidget {
  const _MiniCard({
    required this.icon,
    required this.title,
    required this.caption,
    required this.value,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String caption;
  final Widget value;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return CustomCard(
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 20, color: AppColors.navyOf(context)),
              const SizedBox(width: AppSizes.spacingSmall),
              Expanded(
                child: Text(
                  title,
                  style: context.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSizes.spacingMedium),
          SizedBox(
            height: 28,
            child: Align(alignment: AlignmentDirectional.centerStart, child: value),
          ),
          const SizedBox(height: AppSizes.spacingXSmall),
          Row(
            children: [
              Flexible(
                child: Text(
                  caption,
                  style: context.textTheme.bodySmall?.copyWith(
                    color: AppColors.textSecondaryOf(context),
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              Icon(
                Icons.chevron_right,
                size: AppSizes.iconSizeSmall,
                color: AppColors.textSecondaryOf(context),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

// A soft shimmerless placeholder that holds the amount row's height while its
// cubit loads - matches the profile screen's "small spinner" convention
// without shifting the layout.
class _AmountPlaceholder extends StatelessWidget {
  const _AmountPlaceholder({required this.height});

  final double height;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: AlignmentDirectional.centerStart,
      child: Container(
        width: 96,
        height: height,
        decoration: BoxDecoration(
          color: AppColors.surfaceOf(context),
          borderRadius: AppRadius.small,
        ),
      ),
    );
  }
}

class _InlineError extends StatelessWidget {
  const _InlineError({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          message,
          style: context.textTheme.bodySmall?.copyWith(color: AppColors.errorOf(context)),
        ),
        TextButton.icon(
          onPressed: onRetry,
          style: TextButton.styleFrom(
            padding: EdgeInsets.zero,
            minimumSize: const Size(0, 32),
            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            foregroundColor: AppColors.primaryOf(context),
          ),
          icon: const Icon(Icons.refresh, size: AppSizes.iconSizeSmall),
          label: Text(context.l10n.retryButton),
        ),
      ],
    );
  }
}

// The tap target for a mini card is the whole card, which already opens a
// page with its own retry - so a failed mini card just offers a compact
// retry glyph rather than repeating that affordance at full size.
class _MiniError extends StatelessWidget {
  const _MiniError({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onRetry,
      child: Row(
        children: [
          Icon(Icons.refresh, size: AppSizes.iconSizeSmall, color: AppColors.primaryOf(context)),
          const SizedBox(width: AppSizes.spacingXSmall),
          Text(
            context.l10n.retryButton,
            style: context.textTheme.bodySmall?.copyWith(color: AppColors.primaryOf(context)),
          ),
        ],
      ),
    );
  }
}
