import 'package:phoenix/features/warehouse_selection/data/models/warehouse_model.dart';
import 'package:phoenix/features/warehouse_selection/data/models/warehouse_profile_model.dart';

abstract class WarehouseRepository {
  Future<List<WarehouseModel>> getWarehouses();

  Future<WarehouseProfileModel> getWarehouseProfile(String warehouseId);
}
