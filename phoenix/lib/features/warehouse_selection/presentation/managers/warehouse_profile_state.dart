import 'package:phoenix/features/warehouse_selection/data/models/warehouse_profile_model.dart';

enum WarehouseProfileStatus { initial, loading, loaded, error }

class WarehouseProfileState {
  const WarehouseProfileState({
    this.status = WarehouseProfileStatus.initial,
    this.profile,
    this.errorMessage,
    this.errorCode,
  });

  final WarehouseProfileStatus status;
  final WarehouseProfileModel? profile;
  final String? errorMessage;
  // See WarehouseSelectionState.errorCode.
  final String? errorCode;

  WarehouseProfileState copyWith({
    WarehouseProfileStatus? status,
    WarehouseProfileModel? profile,
    String? errorMessage,
    String? errorCode,
  }) {
    return WarehouseProfileState(
      status: status ?? this.status,
      profile: profile ?? this.profile,
      errorMessage: errorMessage,
      errorCode: errorCode,
    );
  }
}
