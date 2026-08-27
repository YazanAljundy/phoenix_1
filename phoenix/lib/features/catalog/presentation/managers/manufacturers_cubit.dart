import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:phoenix/core/error/failure.dart';
import 'package:phoenix/features/catalog/data/repositories/catalog_repository.dart';

import 'manufacturers_state.dart';

class ManufacturersCubit extends Cubit<ManufacturersState> {
  ManufacturersCubit({
    required CatalogRepository catalogRepository,
    required String warehouseId,
  }) : _catalogRepository = catalogRepository,
       _warehouseId = warehouseId,
       super(const ManufacturersState());

  final CatalogRepository _catalogRepository;
  final String _warehouseId;

  Future<void> loadManufacturers() async {
    emit(state.copyWith(status: ManufacturersStatus.loading));
    try {
      final manufacturers = await _catalogRepository.getManufacturers(warehouseId: _warehouseId);
      emit(
        state.copyWith(status: ManufacturersStatus.loaded, manufacturers: manufacturers),
      );
    } on Failure catch (f) {
      emit(state.copyWith(status: ManufacturersStatus.error, errorMessage: f.errMessage, errorCode: f.code));
    }
  }
}
