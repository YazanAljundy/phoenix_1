enum SavingsStatus { initial, loading, loaded, error }

class SavingsState {
  const SavingsState({
    this.status = SavingsStatus.initial,
    this.totalSavingsUsd = 0,
    this.errorMessage,
    this.errorCode,
  });

  final SavingsStatus status;
  final num totalSavingsUsd;
  final String? errorMessage;
  // Machine-readable error id - see translateErrorCode.
  final String? errorCode;

  SavingsState copyWith({
    SavingsStatus? status,
    num? totalSavingsUsd,
    String? errorMessage,
    String? errorCode,
  }) {
    return SavingsState(
      status: status ?? this.status,
      totalSavingsUsd: totalSavingsUsd ?? this.totalSavingsUsd,
      errorMessage: errorMessage,
      errorCode: errorCode,
    );
  }
}
