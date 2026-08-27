import 'package:phoenix/features/debts/data/models/warehouse_debt_model.dart';

enum DebtsStatus { initial, loading, loaded, error }

class DebtsState {
  const DebtsState({
    this.status = DebtsStatus.initial,
    this.debts = const [],
    this.errorMessage,
    this.errorCode,
  });

  final DebtsStatus status;
  final List<WarehouseDebtModel> debts;
  final String? errorMessage;
  // Machine-readable error id - see translateErrorCode.
  final String? errorCode;

  DebtsState copyWith({
    DebtsStatus? status,
    List<WarehouseDebtModel>? debts,
    String? errorMessage,
    String? errorCode,
  }) {
    return DebtsState(
      status: status ?? this.status,
      debts: debts ?? this.debts,
      errorMessage: errorMessage,
      errorCode: errorCode,
    );
  }
}
