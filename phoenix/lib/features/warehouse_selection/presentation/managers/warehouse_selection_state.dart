import 'package:phoenix/features/warehouse_selection/data/models/warehouse_model.dart';

enum WarehouseListStatus { initial, loading, loaded, error }

class WarehouseSelectionState {
  const WarehouseSelectionState({
    this.status = WarehouseListStatus.initial,
    this.warehouses = const [],
    this.errorMessage,
  });

  final WarehouseListStatus status;
  final List<WarehouseModel> warehouses;
  final String? errorMessage;

  WarehouseSelectionState copyWith({
    WarehouseListStatus? status,
    List<WarehouseModel>? warehouses,
    String? errorMessage,
  }) {
    return WarehouseSelectionState(
      status: status ?? this.status,
      warehouses: warehouses ?? this.warehouses,
      errorMessage: errorMessage,
    );
  }
}
