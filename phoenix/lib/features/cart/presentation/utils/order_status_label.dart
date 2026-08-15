import 'package:phoenix/generated/app_localizations.dart';

// Shared between the status history list, the progress bar labels, and the
// "my orders" list badge - one switch over orders.status, not three.
String orderStatusLabel(AppLocalizations l10n, String status) {
  switch (status) {
    case 'pending':
      return l10n.stageSent;
    case 'confirmed':
      return l10n.stageUnderReview;
    case 'preparing':
      return l10n.stagePreparing;
    case 'out_for_delivery':
      return l10n.stageOutForDelivery;
    case 'delivered':
      return l10n.stageDelivered;
    case 'cancelled':
      return l10n.stageCancelled;
    default:
      return status;
  }
}
