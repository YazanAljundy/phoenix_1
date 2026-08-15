import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:phoenix/core/error/failure.dart';
import 'package:phoenix/features/warehouse_selection/data/repositories/warehouse_repository.dart';

import 'warehouse_selection_state.dart';

class WarehouseSelectionCubit extends Cubit<WarehouseSelectionState> {
  WarehouseSelectionCubit({required WarehouseRepository warehouseRepository})
    : _warehouseRepository = warehouseRepository,
      super(const WarehouseSelectionState());

  final WarehouseRepository _warehouseRepository;

  Future<void> loadWarehouses() async {
    emit(state.copyWith(status: WarehouseListStatus.loading));
    try {
      final warehouses = await _warehouseRepository.getWarehouses();
      emit(
        state.copyWith(status: WarehouseListStatus.loaded, warehouses: warehouses),
      );
    } on Failure catch (f) {
      emit(
        state.copyWith(status: WarehouseListStatus.error, errorMessage: f.errMessage),
      );
    }
  }
}
