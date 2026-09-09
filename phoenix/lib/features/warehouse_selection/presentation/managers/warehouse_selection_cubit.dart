import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:feniq/core/error/failure.dart';
import 'package:feniq/features/warehouse_selection/data/repositories/warehouse_repository.dart';

import 'warehouse_selection_state.dart';

class WarehouseSelectionCubit extends Cubit<WarehouseSelectionState> {
  WarehouseSelectionCubit({required WarehouseRepository warehouseRepository})
    : _warehouseRepository = warehouseRepository,
      super(const WarehouseSelectionState());

  final WarehouseRepository _warehouseRepository;

  /// Loads the list at the scope currently selected - which on a first load is
  /// the pharmacy's own city, so the screen opens pre-filtered without the
  /// pharmacist doing anything.
  Future<void> loadWarehouses() => _load(onlyMyCity: state.onlyMyCity);

  /// The "my city" / "all cities" toggle. Re-fetches at the new scope, keeping
  /// the current list visible while it does (see [WarehouseSelectionState
  /// .isChangingScope]) so broadening the search doesn't flash an empty page.
  Future<void> setOnlyMyCity(bool onlyMyCity) {
    if (onlyMyCity == state.onlyMyCity) return Future.value();
    return _load(onlyMyCity: onlyMyCity, keepCurrentList: true);
  }

  Future<void> _load({required bool onlyMyCity, bool keepCurrentList = false}) async {
    emit(
      state.copyWith(
        // A scope change keeps the loaded list on screen and reports progress
        // through isChangingScope instead; only a genuine (re)load blanks it.
        status: keepCurrentList ? null : WarehouseListStatus.loading,
        isChangingScope: keepCurrentList,
        onlyMyCity: onlyMyCity,
      ),
    );
    try {
      final result = await _warehouseRepository.getWarehouses(onlyMyCity: onlyMyCity);
      emit(
        state.copyWith(
          status: WarehouseListStatus.loaded,
          warehouses: result.warehouses,
          // What the server did, not what was asked for.
          cityFilterApplied: result.cityFilterApplied,
          // Sticky: a confirmed narrowing is proof this pharmacy has a city
          // worth offering a toggle for, and that stays true while the
          // pharmacist is looking at all cities.
          cityScopeAvailable: result.cityFilterApplied || state.cityScopeAvailable,
          isChangingScope: false,
        ),
      );
    } on Failure catch (f) {
      emit(
        state.copyWith(
          status: WarehouseListStatus.error,
          isChangingScope: false,
          errorMessage: f.errMessage,
          errorCode: f.code,
        ),
      );
    }
  }
}
