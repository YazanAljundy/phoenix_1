import 'package:phoenix/features/warehouse_selection/data/models/warehouse_model.dart';

abstract class WarehouseRepository {
  Future<List<WarehouseModel>> getWarehouses();
}
