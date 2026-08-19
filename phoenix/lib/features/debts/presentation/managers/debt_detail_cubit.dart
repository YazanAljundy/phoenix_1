import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:phoenix/core/error/failure.dart';
import 'package:phoenix/features/debts/data/repositories/debt_repository.dart';

import 'debt_detail_state.dart';

class DebtDetailCubit extends Cubit<DebtDetailState> {
  DebtDetailCubit({
    required DebtRepository debtRepository,
    required String warehouseId,
  }) : _debtRepository = debtRepository,
       _warehouseId = warehouseId,
       super(const DebtDetailState());

  final DebtRepository _debtRepository;
  final String _warehouseId;

  Future<void> load() async {
    emit(state.copyWith(status: DebtDetailStatus.loading));
    try {
      final detail = await _debtRepository.getDebtDetail(_warehouseId);
      emit(state.copyWith(status: DebtDetailStatus.loaded, detail: detail));
    } on Failure catch (f) {
      emit(state.copyWith(status: DebtDetailStatus.error, errorMessage: f.errMessage));
    }
  }
}
