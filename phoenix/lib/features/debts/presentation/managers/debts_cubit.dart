import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:phoenix/core/error/failure.dart';
import 'package:phoenix/features/debts/data/repositories/debt_repository.dart';

import 'debts_state.dart';

class DebtsCubit extends Cubit<DebtsState> {
  DebtsCubit({required DebtRepository debtRepository})
    : _debtRepository = debtRepository,
      super(const DebtsState());

  final DebtRepository _debtRepository;

  Future<void> load() async {
    emit(state.copyWith(status: DebtsStatus.loading));
    try {
      final debts = await _debtRepository.getMyDebts();
      emit(state.copyWith(status: DebtsStatus.loaded, debts: debts));
    } on Failure catch (f) {
      emit(state.copyWith(status: DebtsStatus.error, errorMessage: f.errMessage));
    }
  }
}
