import 'package:phoenix/generated/app_localizations.dart';

String returnReasonLabel(AppLocalizations l10n, String reasonType) {
  switch (reasonType) {
    case 'damaged':
      return l10n.reasonDamaged;
    case 'wrong_item':
      return l10n.reasonWrongItem;
    case 'other':
      return l10n.reasonOther;
    default:
      return reasonType;
  }
}

// Section 6.9/7/8: status is now the outcome directly (pending/approved/
// rejected) - there's no separate "resolution" field anymore, and no
// "refund" (meaningless under COD; approved always means replacement).
String returnStatusLabel(AppLocalizations l10n, String status) {
  switch (status) {
    case 'pending':
      return l10n.returnStatusPending;
    case 'approved':
      return l10n.returnStatusApproved;
    case 'rejected':
      return l10n.returnStatusRejected;
    default:
      return status;
  }
}
