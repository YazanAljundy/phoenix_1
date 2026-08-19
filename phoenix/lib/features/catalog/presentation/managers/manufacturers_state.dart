enum ManufacturersStatus { initial, loading, loaded, error }

class ManufacturersState {
  const ManufacturersState({
    this.status = ManufacturersStatus.initial,
    this.manufacturers = const [],
    this.errorMessage,
  });

  final ManufacturersStatus status;
  final List<String> manufacturers;
  final String? errorMessage;

  ManufacturersState copyWith({
    ManufacturersStatus? status,
    List<String>? manufacturers,
    String? errorMessage,
  }) {
    return ManufacturersState(
      status: status ?? this.status,
      manufacturers: manufacturers ?? this.manufacturers,
      errorMessage: errorMessage,
    );
  }
}
