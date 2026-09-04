import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:phoenix/core/error/failure.dart';
import 'package:phoenix/features/account_history/data/repositories/savings_repository.dart';

import 'savings_state.dart';

// Feeds the Account History "Money Saved" card. Mirrors DebtsCubit's shape so
// the screen can treat all three of its data sources the same way; a failure
// here never blocks the debts or returns cards from rendering.
class SavingsCubit extends Cubit<SavingsState> {
  SavingsCubit({required SavingsRepository savingsRepository})
    : _savingsRepository = savingsRepository,
      super(const SavingsState());

  final SavingsRepository _savingsRepository;

  Future<void> load() async {
    emit(state.copyWith(status: SavingsStatus.loading));
    try {
      final summary = await _savingsRepository.getSavingsSummary();
      emit(state.copyWith(status: SavingsStatus.loaded, totalSavingsUsd: summary.totalSavingsUsd));
    } on Failure catch (f) {
      emit(state.copyWith(status: SavingsStatus.error, errorMessage: f.errMessage, errorCode: f.code));
    }
  }
}
