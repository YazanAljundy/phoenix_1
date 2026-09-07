import 'package:phoenix/features/debts/data/models/warehouse_debt_model.dart';

enum DebtsStatus { initial, loading, loaded, error }

class DebtsState {
  const DebtsState({
    this.status = DebtsStatus.initial,
    this.summary = DebtsSummaryModel.empty,
    this.errorMessage,
    this.errorCode,
  });

  final DebtsStatus status;
  /// Money-Flow V2: every account plus the three server-computed totals.
  final DebtsSummaryModel summary;

  /// The accounts themselves, for the list.
  List<WarehouseDebtModel> get debts => summary.accounts;
  final String? errorMessage;
  // Machine-readable error id - see translateErrorCode.
  final String? errorCode;

  DebtsState copyWith({
    DebtsStatus? status,
    DebtsSummaryModel? summary,
    String? errorMessage,
    String? errorCode,
  }) {
    return DebtsState(
      status: status ?? this.status,
      summary: summary ?? this.summary,
      errorMessage: errorMessage,
      errorCode: errorCode,
    );
  }
}
