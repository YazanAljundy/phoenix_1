import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_padding.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/features/debts/presentation/managers/debts_cubit.dart';
import 'package:phoenix/features/debts/presentation/widgets/debts_overview.dart';

// The pharmacist's standalone debts page, opened from the Account History
// screen's Debts card. It is only a shell around DebtsOverview - the same
// widget, DebtsCubit, repository and per-warehouse DebtDetailView the profile
// screen already uses. Nothing about how a debt is calculated changes here.
class MyDebtsView extends StatelessWidget {
  const MyDebtsView({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return Scaffold(
      appBar: AppBar(
        backgroundColor: AppColors.navyOf(context),
        foregroundColor: Colors.white,
        title: Text(l10n.debtsTitle),
      ),
      body: RefreshIndicator(
        onRefresh: () => context.read<DebtsCubit>().load(),
        child: ListView(
          padding: AppPadding.screen,
          children: const [DebtsOverview()],
        ),
      ),
    );
  }
}
