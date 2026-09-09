import 'package:feniq/features/warehouse_selection/data/models/warehouse_list_result.dart';
import 'package:feniq/features/warehouse_selection/data/models/warehouse_profile_model.dart';

abstract class WarehouseRepository {
  /// [onlyMyCity] asks the server to narrow the list to the pharmacy's own
  /// city. The filtering itself happens server-side (the pharmacy's city is
  /// resolved there from the authenticated user, never sent from here), so
  /// the app never downloads warehouses it isn't going to show.
  Future<WarehouseListResult> getWarehouses({required bool onlyMyCity});

  Future<WarehouseProfileModel> getWarehouseProfile(String warehouseId);
}
