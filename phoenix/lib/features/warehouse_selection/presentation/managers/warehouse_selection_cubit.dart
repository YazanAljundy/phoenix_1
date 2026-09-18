import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:feniq/core/error/failure.dart';
import 'package:feniq/core/session/session_scope.dart';
import 'package:feniq/features/warehouse_selection/data/repositories/warehouse_repository.dart';

import 'warehouse_selection_state.dart';

// Global (main.dart), but scoped to one sign-in: the list is the one the
// server narrowed to THIS pharmacy's city, and the city scope (the "my city /
// all cities" choice and the sticky cityScopeAvailable) is this pharmacy's
// too. A sign-out resets it through SessionScope, so the next account starts
// from its own city with no toggle it may not be entitled to.
class WarehouseSelectionCubit extends Cubit<WarehouseSelectionState> implements SessionScoped {
  WarehouseSelectionCubit({
    required WarehouseRepository warehouseRepository,
    SessionScope? sessionScope,
  }) : _warehouseRepository = warehouseRepository,
       _sessionScope = sessionScope,
       super(const WarehouseSelectionState()) {
    _sessionScope?.register(this);
  }

  final WarehouseRepository _warehouseRepository;
  final SessionScope? _sessionScope;

  // Bumped by every sign-out, so a list requested for the previous account
  // can't land after the reset.
  int _session = 0;

  @override
  void resetForSignOut() {
    _session++;
    if (isClosed) return;
    emit(const WarehouseSelectionState());
  }

  @override
  Future<void> close() {
    _sessionScope?.unregister(this);
    return super.close();
  }

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
    final session = _session;
    try {
      final result = await _warehouseRepository.getWarehouses(onlyMyCity: onlyMyCity);
      if (session != _session) return;
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
      if (session != _session) return;
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
