// Account History "Money Saved" card (GET /orders/savings-summary).
//
// Money-Flow V2 changed two things about this figure.
//
// It is now COMPLETE. V1 counted only the per-line offer + manufacturer
// savings, so a pharmacy that bought nothing but advertisement packages - the
// deepest discounts in the product - was told it had saved nothing at all. The
// package saving and Feniq's own platform discount are both real money the
// pharmacy did not pay, and both are counted now.
//
// And it is STABLE. V1 read a USD total and converted it at the LIVE rate, so
// a pharmacy's lifetime savings drifted every time the lira did. Every
// component is now summed in frozen SYP.
class SavingsSummary {
  const SavingsSummary({
    required this.offerAndManufacturerSyp,
    required this.advertisementSyp,
    required this.platformDiscountSyp,
    required this.totalSavingsSyp,
    required this.totalSavingsUsd,
  });

  /// Warehouse offers and standing manufacturer discounts, from the frozen
  /// per-line figures.
  final num offerAndManufacturerSyp;

  /// The gap between an advertisement package's price and its catalog sum.
  final num advertisementSyp;

  /// Feniq's own subsidy on every order.
  final num platformDiscountSyp;

  /// The headline: everything the pharmacy did not pay.
  final num totalSavingsSyp;

  /// A frozen hint beside the SYP total, not a live conversion of it.
  final num totalSavingsUsd;

  static const empty = SavingsSummary(
    offerAndManufacturerSyp: 0,
    advertisementSyp: 0,
    platformDiscountSyp: 0,
    totalSavingsSyp: 0,
    totalSavingsUsd: 0,
  );

  factory SavingsSummary.fromJson(Map<String, dynamic> json) => SavingsSummary(
    offerAndManufacturerSyp: (json['offerAndManufacturerSyp'] as num?) ?? 0,
    advertisementSyp: (json['advertisementSyp'] as num?) ?? 0,
    platformDiscountSyp: (json['platformDiscountSyp'] as num?) ?? 0,
    totalSavingsSyp: (json['totalSavingsSyp'] as num?) ?? 0,
    totalSavingsUsd: (json['totalSavingsUsd'] as num?) ?? 0,
  );
}
