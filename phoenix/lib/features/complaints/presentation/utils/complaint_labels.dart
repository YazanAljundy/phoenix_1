import 'package:phoenix/core/widgets/status_badge.dart';
import 'package:phoenix/generated/app_localizations.dart';

// Section 13/14: the four complaint states, each with a localized label and a
// visual tone. The status -> tone mapping is domain knowledge that belongs
// here with the data, not in StatusBadge (per that widget's own doc comment):
//   pending   -> warning  (orange)
//   in_review -> info     (navy)
//   resolved  -> success  (green)
//   closed    -> neutral  (rendered as info/navy - the "muted" of the four)
String complaintStatusLabel(AppLocalizations l10n, String status) {
  switch (status) {
    case 'pending':
      return l10n.complaintStatusPending;
    case 'in_review':
      return l10n.complaintStatusInReview;
    case 'resolved':
      return l10n.complaintStatusResolved;
    case 'closed':
      return l10n.complaintStatusClosed;
    default:
      return status;
  }
}

StatusBadgeTone complaintStatusTone(String status) {
  switch (status) {
    case 'resolved':
      return StatusBadgeTone.success;
    case 'in_review':
      return StatusBadgeTone.info;
    case 'closed':
      return StatusBadgeTone.info;
    case 'pending':
    default:
      return StatusBadgeTone.pending;
  }
}
