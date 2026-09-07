// Money-Flow V2. The account statement for one warehouse relationship
// (GET /pharmacy/debts/:warehouseId).
//
// V1's "debt detail" was two disconnected lists - every delivered order, every
// payment - under three summary cards computed on a DIFFERENT basis from the
// rows beneath them (the cards live-converted a USD cache; the rows were
// frozen SYP), so after any exchange-rate move the two visibly disagreed.
//
// This is one chronological list of financial events with a running balance.
// Every row and every total is the same frozen SYP figure off the same
// immutable ledger entries, so they cannot tell different stories.

/// What a statement row refers to - an invoice, a payment - so the pharmacist
/// can quote something when asking about it.
class StatementReference {
  const StatementReference({
    this.invoiceNumber,
    this.orderNumber,
    this.orderId,
    this.paymentNumber,
    this.method,
  });

  final int? invoiceNumber;
  final int? orderNumber;
  final String? orderId;
  final int? paymentNumber;
  final String? method;

  factory StatementReference.fromJson(Map<String, dynamic>? json) {
    if (json == null) return const StatementReference();
    return StatementReference(
      invoiceNumber: json['invoiceNumber'] as int?,
      orderNumber: json['orderNumber'] as int?,
      orderId: json['orderId'] as String?,
      paymentNumber: json['paymentNumber'] as int?,
      method: json['method'] as String?,
    );
  }
}

/// One line of the statement: what happened, on what date, and the balance
/// after it. Debit and credit are separate so the reader never has to work out
/// a sign.
class StatementRowModel {
  const StatementRowModel({
    required this.id,
    required this.kind,
    required this.effectiveAt,
    required this.debitSyp,
    required this.creditSyp,
    required this.balanceSyp,
    this.entryNumber,
    this.amountUsd,
    this.reason,
    this.reversalOf,
    this.reference = const StatementReference(),
  });

  final String id;

  /// One of the ledger's entry kinds: charge, payment, payment_reversal,
  /// return_credit, manual_credit, manual_debit, ... The UI maps it to a label.
  final String kind;
  final DateTime effectiveAt;

  /// Exactly one of these is non-zero.
  final num debitSyp;
  final num creditSyp;

  /// The running balance after this row.
  final num balanceSyp;

  final int? entryNumber;
  final num? amountUsd;

  /// Mandatory on manual adjustments and every reversal - it is what makes
  /// those rows legible rather than mysterious.
  final String? reason;

  /// Set on a reversal: the entry it undid.
  final String? reversalOf;
  final StatementReference reference;

  bool get isDebit => debitSyp > 0;
  num get amountSyp => isDebit ? debitSyp : creditSyp;

  factory StatementRowModel.fromJson(Map<String, dynamic> json) => StatementRowModel(
    id: json['id'] as String,
    kind: json['kind'] as String,
    effectiveAt: DateTime.parse(json['effectiveAt'] as String),
    debitSyp: (json['debitSyp'] as num?) ?? 0,
    creditSyp: (json['creditSyp'] as num?) ?? 0,
    balanceSyp: (json['balanceSyp'] as num?) ?? 0,
    entryNumber: json['entryNumber'] as int?,
    amountUsd: json['amountUsd'] as num?,
    reason: json['reason'] as String?,
    reversalOf: json['reversalOf'] as String?,
    reference: StatementReference.fromJson(json['reference'] as Map<String, dynamic>?),
  );
}

/// The period's movement, grouped the way a reader asks about it. Reversals
/// are netted into the family they belong to, so a payment that was reversed
/// shows the pair's true effect rather than inflating the column.
class StatementSummary {
  const StatementSummary({
    required this.chargesSyp,
    required this.paymentsSyp,
    required this.returnCreditsSyp,
    required this.adjustmentsSyp,
  });

  final num chargesSyp;
  final num paymentsSyp;
  final num returnCreditsSyp;
  final num adjustmentsSyp;

  factory StatementSummary.fromJson(Map<String, dynamic>? json) => StatementSummary(
    chargesSyp: (json?['chargesSyp'] as num?) ?? 0,
    paymentsSyp: (json?['paymentsSyp'] as num?) ?? 0,
    returnCreditsSyp: (json?['returnCreditsSyp'] as num?) ?? 0,
    adjustmentsSyp: (json?['adjustmentsSyp'] as num?) ?? 0,
  );
}

class DebtDetailModel {
  const DebtDetailModel({
    required this.openingSyp,
    required this.closingSyp,
    required this.outstandingDebtSyp,
    required this.creditBalanceSyp,
    required this.summary,
    required this.rows,
    required this.warehouseNameAr,
    this.warehouseNameEn,
    required this.warehousePhone,
    this.periodFrom,
    this.periodTo,
  });

  /// The balance carried in from before the window, so the running total in
  /// the rows starts from something visible.
  final num openingSyp;

  /// The balance after the last row. Positive: owed. Negative: in credit.
  final num closingSyp;

  /// The same figure split so a screen can show two positive numbers.
  final num outstandingDebtSyp;
  final num creditBalanceSyp;

  final StatementSummary summary;
  final List<StatementRowModel> rows;

  final String warehouseNameAr;
  final String? warehouseNameEn;
  final String warehousePhone;
  final DateTime? periodFrom;
  final DateTime? periodTo;

  bool get isCredit => closingSyp < 0;

  factory DebtDetailModel.fromJson(Map<String, dynamic> json) {
    final statement = json['statement'] as Map<String, dynamic>;
    final warehouse = (statement['warehouse'] as Map<String, dynamic>?) ?? const {};
    final period = (statement['period'] as Map<String, dynamic>?) ?? const {};
    final opening = (statement['opening'] as Map<String, dynamic>?) ?? const {};
    final closing = (statement['closing'] as Map<String, dynamic>?) ?? const {};

    return DebtDetailModel(
      openingSyp: (opening['syp'] as num?) ?? 0,
      closingSyp: (closing['syp'] as num?) ?? 0,
      outstandingDebtSyp: (statement['outstandingDebtSyp'] as num?) ?? 0,
      creditBalanceSyp: (statement['creditBalanceSyp'] as num?) ?? 0,
      summary: StatementSummary.fromJson(statement['summary'] as Map<String, dynamic>?),
      rows: ((statement['rows'] as List?) ?? const [])
          .cast<Map<String, dynamic>>()
          .map(StatementRowModel.fromJson)
          .toList(),
      warehouseNameAr: (warehouse['nameAr'] as String?) ?? '',
      warehouseNameEn: warehouse['nameEn'] as String?,
      warehousePhone: (warehouse['phone'] as String?) ?? '',
      periodFrom: period['from'] != null ? DateTime.parse(period['from'] as String) : null,
      periodTo: period['to'] != null ? DateTime.parse(period['to'] as String) : null,
    );
  }
}
