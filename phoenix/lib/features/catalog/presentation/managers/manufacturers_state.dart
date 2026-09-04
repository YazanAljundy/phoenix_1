import 'package:phoenix/features/catalog/data/models/manufacturer_model.dart';

enum ManufacturersStatus { initial, loading, loaded, error }

class ManufacturersState {
  const ManufacturersState({
    this.status = ManufacturersStatus.initial,
    this.manufacturers = const [],
    this.errorMessage,
    this.errorCode,
  });

  final ManufacturersStatus status;
  final List<ManufacturerModel> manufacturers;
  final String? errorMessage;
  // Machine-readable error id - see translateErrorCode.
  final String? errorCode;

  ManufacturersState copyWith({
    ManufacturersStatus? status,
    List<ManufacturerModel>? manufacturers,
    String? errorMessage,
    String? errorCode,
  }) {
    return ManufacturersState(
      status: status ?? this.status,
      manufacturers: manufacturers ?? this.manufacturers,
      errorMessage: errorMessage,
      errorCode: errorCode,
    );
  }
}
