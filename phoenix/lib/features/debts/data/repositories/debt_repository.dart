import 'package:phoenix/features/debts/data/models/debt_detail_model.dart';
import 'package:phoenix/features/debts/data/models/warehouse_debt_model.dart';

abstract class DebtRepository {
  Future<List<WarehouseDebtModel>> getMyDebts();

  Future<DebtDetailModel> getDebtDetail(String warehouseId);
}
