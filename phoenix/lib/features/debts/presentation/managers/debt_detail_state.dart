import 'package:phoenix/features/debts/data/models/debt_detail_model.dart';

enum DebtDetailStatus { initial, loading, loaded, error }

class DebtDetailState {
  const DebtDetailState({
    this.status = DebtDetailStatus.initial,
    this.detail,
    this.errorMessage,
  });

  final DebtDetailStatus status;
  final DebtDetailModel? detail;
  final String? errorMessage;

  DebtDetailState copyWith({
    DebtDetailStatus? status,
    DebtDetailModel? detail,
    String? errorMessage,
  }) {
    return DebtDetailState(
      status: status ?? this.status,
      detail: detail ?? this.detail,
      errorMessage: errorMessage,
    );
  }
}
