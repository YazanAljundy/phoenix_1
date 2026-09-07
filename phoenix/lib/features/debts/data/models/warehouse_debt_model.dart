// Money-Flow V2. The pharmacy's own account list (GET /pharmacy/debts).
//
// V1 returned only the warehouses in debt and let the client sum them, so a
// pharmacy $100 down at one warehouse and $40 up at another was told it owed
// $100 with no sign of the $40. The endpoint now returns EVERY account it
// holds - in debt, settled, or in credit - together with the three headline
// figures, all computed server-side.
//
// Balances are SYP-native: SYP is the ledger's settlement currency, and the
// figure is frozen, so it no longer drifts every time the exchange rate moves.
// `balanceUsd` rides along as an equally frozen hint.
class WarehouseDebtModel {
  const WarehouseDebtModel({
    required this.warehouseId,
    required this.nameAr,
    this.nameEn,
    required this.phone,
    required this.balanceSyp,
    this.balanceUsd,
    this.lastActivityAt,
  });

  final String warehouseId;
  final String nameAr;
  final String? nameEn;
  final String phone;

  /// Positive: the pharmacy owes this warehouse. Negative: it is in credit.
  final num balanceSyp;
  final num? balanceUsd;
  final DateTime? lastActivityAt;

  bool get isCredit => balanceSyp < 0;
  bool get isSettled => balanceSyp == 0;

  /// What is owed, never negative - so a screen can show debt and credit as
  /// two separate positive figures instead of one signed number the reader has
  /// to interpret.
  num get outstandingDebtSyp => balanceSyp > 0 ? balanceSyp : 0;
  num get creditBalanceSyp => balanceSyp < 0 ? -balanceSyp : 0;

  factory WarehouseDebtModel.fromJson(Map<String, dynamic> json) => WarehouseDebtModel(
    warehouseId: json['warehouseId'] as String,
    nameAr: json['nameAr'] as String,
    nameEn: json['nameEn'] as String?,
    phone: json['phone'] as String,
    balanceSyp: (json['balanceSyp'] as num?) ?? 0,
    balanceUsd: json['balanceUsd'] as num?,
    lastActivityAt: json['lastActivityAt'] != null
        ? DateTime.parse(json['lastActivityAt'] as String)
        : null,
  );
}

/// The whole response: every account plus the three headline figures. Summed
/// on the server precisely so two different screens can never disagree about
/// what a pharmacy owes - V1 folded the balances client-side, in two files.
class DebtsSummaryModel {
  const DebtsSummaryModel({
    required this.totalDebtSyp,
    required this.totalCreditSyp,
    required this.netPositionSyp,
    required this.accounts,
  });

  /// Sum of every account that is owed money. Never nets a credit into it.
  final num totalDebtSyp;

  /// Sum of every account the pharmacy has paid ahead on.
  final num totalCreditSyp;

  /// totalDebt - totalCredit. Can be negative.
  final num netPositionSyp;

  final List<WarehouseDebtModel> accounts;

  static const empty = DebtsSummaryModel(
    totalDebtSyp: 0,
    totalCreditSyp: 0,
    netPositionSyp: 0,
    accounts: [],
  );

  bool get hasCredit => totalCreditSyp > 0;

  factory DebtsSummaryModel.fromJson(Map<String, dynamic> json) => DebtsSummaryModel(
    totalDebtSyp: (json['totalDebtSyp'] as num?) ?? 0,
    totalCreditSyp: (json['totalCreditSyp'] as num?) ?? 0,
    netPositionSyp: (json['netPositionSyp'] as num?) ?? 0,
    accounts: ((json['accounts'] as List?) ?? const [])
        .cast<Map<String, dynamic>>()
        .map(WarehouseDebtModel.fromJson)
        .toList(),
  );
}
