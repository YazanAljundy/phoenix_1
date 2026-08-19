import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:phoenix/core/error/failure.dart';
import 'package:phoenix/features/warehouse_selection/data/repositories/warehouse_repository.dart';

import 'warehouse_profile_state.dart';

class WarehouseProfileCubit extends Cubit<WarehouseProfileState> {
  WarehouseProfileCubit({
    required WarehouseRepository warehouseRepository,
    required String warehouseId,
  }) : _warehouseRepository = warehouseRepository,
       _warehouseId = warehouseId,
       super(const WarehouseProfileState());

  final WarehouseRepository _warehouseRepository;
  final String _warehouseId;

  Future<void> load() async {
    emit(state.copyWith(status: WarehouseProfileStatus.loading));
    try {
      final profile = await _warehouseRepository.getWarehouseProfile(_warehouseId);
      emit(state.copyWith(status: WarehouseProfileStatus.loaded, profile: profile));
    } on Failure catch (f) {
      emit(state.copyWith(status: WarehouseProfileStatus.error, errorMessage: f.errMessage));
    }
  }
}
