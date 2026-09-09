import 'package:feniq/features/warehouse_selection/data/models/warehouse_model.dart';

enum WarehouseListStatus { initial, loading, loaded, error }

class WarehouseSelectionState {
  const WarehouseSelectionState({
    this.status = WarehouseListStatus.initial,
    this.warehouses = const [],
    this.onlyMyCity = true,
    this.cityFilterApplied = false,
    this.cityScopeAvailable = false,
    this.isChangingScope = false,
    this.errorMessage,
    this.errorCode,
  });

  final WarehouseListStatus status;
  final List<WarehouseModel> warehouses;

  /// What the screen is currently *asking* for. Starts true: a pharmacy sees
  /// its own city by default without having to do anything.
  final bool onlyMyCity;

  /// What the server actually did, which isn't always what was asked - a
  /// pharmacy with no usable city gets the whole list back regardless (see
  /// WarehouseListResult). Kept separate from [onlyMyCity] so the screen can
  /// never claim a narrowing that didn't happen; [cityScopeAvailable] below
  /// is what gates the toggle.
  final bool cityFilterApplied;

  /// Whether this pharmacy can be filtered by city at all - true once the
  /// server has confirmed it actually narrowed a list for it. Sticky, unlike
  /// [cityFilterApplied], which goes false the moment the pharmacist switches
  /// to "all cities": the toggle has to survive being toggled. A pharmacy
  /// whose stored city is unusable never sets this, and correctly never sees
  /// a toggle that couldn't do anything.
  final bool cityScopeAvailable;

  /// A scope change is in flight. Distinct from [status] being `loading` on
  /// purpose: the already-loaded list stays on screen while the new one
  /// arrives, so toggling doesn't blank the page, and the toggle itself shows
  /// the progress instead.
  final bool isChangingScope;

  final String? errorMessage;
  // Machine-readable error id (backend domain code or a FailureCode) - the
  // view turns it into a localized sentence via translateErrorCode.
  final String? errorCode;

  /// True when the pharmacy is looking at its own city and there is genuinely
  /// nothing there - the one case that gets the "no warehouses in your city"
  /// empty state with its "view all cities" escape hatch, rather than the
  /// generic "no warehouses yet".
  bool get isEmptyInOwnCity =>
      status == WarehouseListStatus.loaded && warehouses.isEmpty && cityFilterApplied;

  WarehouseSelectionState copyWith({
    WarehouseListStatus? status,
    List<WarehouseModel>? warehouses,
    bool? onlyMyCity,
    bool? cityFilterApplied,
    bool? cityScopeAvailable,
    bool? isChangingScope,
    String? errorMessage,
    String? errorCode,
  }) {
    return WarehouseSelectionState(
      status: status ?? this.status,
      warehouses: warehouses ?? this.warehouses,
      onlyMyCity: onlyMyCity ?? this.onlyMyCity,
      cityFilterApplied: cityFilterApplied ?? this.cityFilterApplied,
      cityScopeAvailable: cityScopeAvailable ?? this.cityScopeAvailable,
      isChangingScope: isChangingScope ?? this.isChangingScope,
      errorMessage: errorMessage,
      errorCode: errorCode,
    );
  }
}
