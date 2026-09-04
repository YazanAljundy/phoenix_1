import 'package:phoenix/features/account_history/data/models/savings_summary.dart';

abstract class SavingsRepository {
  // The pharmacy's total money saved through app discounts. Read-only - the
  // server only sums figures already stored on each order.
  Future<SavingsSummary> getSavingsSummary();
}
