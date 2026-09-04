// Account History "Money Saved" card: the pharmacy's running total of money
// saved through discounts, from GET /orders/savings-summary. The backend sums
// OrderItem.savingsUsd (locked in at order time - offer + manufacturer
// discount) across every non-cancelled order; it is USD-native like the rest
// of the catalog's stored money, and the UI converts it to SYP for display
// with the live exchange rate.
class SavingsSummary {
  const SavingsSummary({required this.totalSavingsUsd});

  final num totalSavingsUsd;

  factory SavingsSummary.fromJson(Map<String, dynamic> json) =>
      SavingsSummary(totalSavingsUsd: (json['totalSavingsUsd'] as num?) ?? 0);
}
