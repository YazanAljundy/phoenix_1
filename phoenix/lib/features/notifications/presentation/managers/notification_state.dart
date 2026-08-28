import 'package:phoenix/features/notifications/data/models/notification_model.dart';

class NotificationState {
  const NotificationState({
    this.notifications = const [],
    this.unreadCount = 0,
  });

  /// Newest first.
  final List<NotificationModel> notifications;

  /// Kept as a field, not a getter - the cubit recomputes it once per inbox
  /// change so the AppBar badge never has to scan the list on a rebuild.
  final int unreadCount;
}
