import 'package:phoenix/generated/app_localizations.dart';

// Shared between the status history list, the progress bar labels, and the
// "my orders" list badge - one switch over orders.status, not three.
//
// The order status flow (user-facing terminology):
//   pending          -> Sent / تم الإرسال
//   confirmed        -> Waiting for Approval / بانتظار الموافقة
//   preparing        -> Preparing / قيد التحضير
//   out_for_delivery -> On the Way / بالطريق
//   delivered        -> Delivered / تم التسليم
// The internal `order.status` values are unchanged; only the labels are.
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
    // Not a real order.status value - only ever appears as a statusHistory
    // entry pushed when the warehouse edits a still-pending order's items
    // (see backend/src/services/warehouseOrder.service.js's
    // updateOrderItems). The order's own status stays 'pending'.
    case 'modified':
      return l10n.stageModified;
    default:
      return status;
  }
}

// The one-line user-facing description shown under the current stage on the
// tracking screen. 'pending' ("Sent") deliberately has none - it needs no
// explanation. Returns null for statuses that carry no description (Sent,
// cancelled, modified, unknown).
String? orderStatusDescription(AppLocalizations l10n, String status) {
  switch (status) {
    case 'confirmed':
      return l10n.stageUnderReviewDesc;
    case 'preparing':
      return l10n.stagePreparingDesc;
    case 'out_for_delivery':
      return l10n.stageOutForDeliveryDesc;
    case 'delivered':
      return l10n.stageDeliveredDesc;
    default:
      return null;
  }
}
