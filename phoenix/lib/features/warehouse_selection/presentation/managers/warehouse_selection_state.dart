import 'package:phoenix/features/warehouse_selection/data/models/warehouse_model.dart';

enum WarehouseListStatus { initial, loading, loaded, error }

class WarehouseSelectionState {
  const WarehouseSelectionState({
    this.status = WarehouseListStatus.initial,
    this.warehouses = const [],
    this.errorMessage,
    this.errorCode,
  });

  final WarehouseListStatus status;
  final List<WarehouseModel> warehouses;
  final String? errorMessage;
  // Machine-readable error id (backend domain code or a FailureCode) - the
  // view turns it into a localized sentence via translateErrorCode.
  final String? errorCode;

  WarehouseSelectionState copyWith({
    WarehouseListStatus? status,
    List<WarehouseModel>? warehouses,
    String? errorMessage,
    String? errorCode,
  }) {
    return WarehouseSelectionState(
      status: status ?? this.status,
      warehouses: warehouses ?? this.warehouses,
      errorMessage: errorMessage,
      errorCode: errorCode,
    );
  }
}
