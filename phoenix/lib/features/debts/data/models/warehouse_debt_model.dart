// Section 16: one row of the pharmacist's own "my debts" list (GET
// /pharmacy/debts) - a warehouse this pharmacy currently owes money to.
// Only ever positive here - the endpoint itself excludes zero/credit
// balances, see pharmacyBalance.service.js's listDebtsForPharmacy.
class WarehouseDebtModel {
  const WarehouseDebtModel({
    required this.warehouseId,
    required this.nameAr,
    this.nameEn,
    required this.phone,
    required this.balanceUsd,
  });

  final String warehouseId;
  final String nameAr;
  final String? nameEn;
  final String phone;
  final num balanceUsd;

  factory WarehouseDebtModel.fromJson(Map<String, dynamic> json) => WarehouseDebtModel(
    warehouseId: json['warehouseId'] as String,
    nameAr: json['nameAr'] as String,
    nameEn: json['nameEn'] as String?,
    phone: json['phone'] as String,
    balanceUsd: json['balanceUsd'] as num,
  );
}
