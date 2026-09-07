import 'package:phoenix/features/account_history/data/models/savings_summary.dart';

enum SavingsStatus { initial, loading, loaded, error }

class SavingsState {
  const SavingsState({
    this.status = SavingsStatus.initial,
    this.savings = SavingsSummary.empty,
    this.errorMessage,
    this.errorCode,
  });

  final SavingsStatus status;
  /// Money-Flow V2: the whole breakdown, SYP-native and frozen.
  final SavingsSummary savings;
  final String? errorMessage;
  // Machine-readable error id - see translateErrorCode.
  final String? errorCode;

  SavingsState copyWith({
    SavingsStatus? status,
    SavingsSummary? savings,
    String? errorMessage,
    String? errorCode,
  }) {
    return SavingsState(
      status: status ?? this.status,
      savings: savings ?? this.savings,
      errorMessage: errorMessage,
      errorCode: errorCode,
    );
  }
}
