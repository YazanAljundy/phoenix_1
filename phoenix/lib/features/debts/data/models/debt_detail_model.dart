// Section 16: one delivered order contributing to a debt - a read-only
// snapshot (orderNumber/finalPrice/date), not a live order lookup.
class DebtOrderModel {
  const DebtOrderModel({
    required this.id,
    required this.orderNumber,
    required this.finalPrice,
    required this.createdAt,
  });

  final String id;
  final int orderNumber;
  final num finalPrice; // SYP
  final DateTime createdAt;

  factory DebtOrderModel.fromJson(Map<String, dynamic> json) => DebtOrderModel(
    id: json['id'] as String,
    orderNumber: json['orderNumber'] as int,
    finalPrice: json['finalPrice'] as num,
    createdAt: DateTime.parse(json['createdAt'] as String),
  );
}

// Section 16: a payment the warehouse recorded against this debt. Read-only
// here - only the warehouse's own panel offers edit/delete (at any time; see
// warehousePayment routes). The pharmacist's view never renders those actions.
class DebtPaymentModel {
  const DebtPaymentModel({
    required this.id,
    required this.amount,
    required this.currency,
    this.note,
    required this.createdAt,
  });

  final String id;
  final num amount;
  final String currency; // 'USD' or 'SYP'
  final String? note;
  final DateTime createdAt;

  factory DebtPaymentModel.fromJson(Map<String, dynamic> json) => DebtPaymentModel(
    id: json['id'] as String,
    amount: json['amount'] as num,
    currency: json['currency'] as String,
    note: json['note'] as String?,
    createdAt: DateTime.parse(json['createdAt'] as String),
  );
}

// Section 16: GET /pharmacy/debts/:warehouseId - the full read-only picture
// behind one row of the pharmacist's debts list: the running totals plus
// every delivered order and payment that made them up.
class DebtDetailModel {
  const DebtDetailModel({
    required this.balanceUsd,
    required this.totalOrdersUsd,
    required this.totalPaidUsd,
    required this.warehouseNameAr,
    this.warehouseNameEn,
    required this.warehousePhone,
    required this.orders,
    required this.payments,
  });

  final num balanceUsd;
  final num totalOrdersUsd;
  final num totalPaidUsd;
  final String warehouseNameAr;
  final String? warehouseNameEn;
  final String warehousePhone;
  final List<DebtOrderModel> orders;
  final List<DebtPaymentModel> payments;

  factory DebtDetailModel.fromJson(Map<String, dynamic> json) {
    final warehouse = json['warehouse'] as Map<String, dynamic>;
    return DebtDetailModel(
      balanceUsd: json['balanceUsd'] as num,
      totalOrdersUsd: json['totalOrdersUsd'] as num,
      totalPaidUsd: json['totalPaidUsd'] as num,
      warehouseNameAr: warehouse['nameAr'] as String,
      warehouseNameEn: warehouse['nameEn'] as String?,
      warehousePhone: warehouse['phone'] as String,
      orders: (json['orders'] as List)
          .map((e) => DebtOrderModel.fromJson(e as Map<String, dynamic>))
          .toList(),
      payments: (json['payments'] as List)
          .map((e) => DebtPaymentModel.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }
}
