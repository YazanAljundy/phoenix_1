import 'package:firebase_messaging/firebase_messaging.dart';

/// One entry in the in-app notification inbox, built from a received FCM
/// [RemoteMessage].
///
/// The payload is exactly what `backend/src/services/notification.service.js`
/// sends and is NOT changed by this feature:
///   notification: { title, body }   // already localised by the backend per user.lang
///   data: { type, relatedOrderId? } // type ∈ order_update | offer | system
enum NotificationType { orderUpdate, offer, system, unknown }

class NotificationModel {
  const NotificationModel({
    required this.id,
    required this.title,
    required this.body,
    required this.receivedAt,
    this.isRead = false,
    this.type = NotificationType.unknown,
    this.relatedOrderId,
    this.data = const {},
  });

  /// FCM message id when present, otherwise a content hash - stable across
  /// every callback for the same push (foreground / background isolate /
  /// onMessageOpenedApp / getInitialMessage), which is what makes dedup work.
  final String id;
  final String title;
  final String body;

  /// UTC. `sentTime` from FCM, or now() if the message carried none.
  final DateTime receivedAt;
  final bool isRead;
  final NotificationType type;

  /// Present only for `type == order_update` - the existing deep-link target.
  final String? relatedOrderId;

  /// The raw `data` map as received, kept verbatim for forward-compatibility.
  final Map<String, String> data;

  bool get hasOrderDeepLink =>
      relatedOrderId != null && relatedOrderId!.isNotEmpty;

  /// Builds an inbox entry from an FCM message, or `null` when there is
  /// nothing worth showing (no title and no body - the current backend never
  /// sends that, but a stray data-only message might).
  static NotificationModel? fromRemoteMessage(RemoteMessage message) {
    final title = message.notification?.title?.trim() ?? '';
    final body = message.notification?.body?.trim() ?? '';
    if (title.isEmpty && body.isEmpty) return null;

    final data = <String, String>{
      for (final entry in message.data.entries) entry.key: '${entry.value}',
    };
    final relatedOrderId = data['relatedOrderId'];

    return NotificationModel(
      id: _stableId(message, title, body),
      title: title,
      body: body,
      receivedAt: (message.sentTime ?? DateTime.now()).toUtc(),
      type: _parseType(data['type']),
      relatedOrderId: (relatedOrderId == null || relatedOrderId.isEmpty)
          ? null
          : relatedOrderId,
      data: data,
    );
  }

  static String _stableId(RemoteMessage message, String title, String body) {
    final messageId = message.messageId?.trim();
    if (messageId != null && messageId.isNotEmpty) return messageId;
    // No FCM id (rare) - a content hash that is identical for the same push
    // seen by two different callbacks.
    final sent = message.sentTime?.toUtc().toIso8601String() ?? '';
    return 'local:${Object.hash(title, body, message.data['type'], message.data['relatedOrderId'], sent)}';
  }

  static NotificationType _parseType(String? raw) {
    switch (raw) {
      case 'order_update':
        return NotificationType.orderUpdate;
      case 'offer':
        return NotificationType.offer;
      case 'system':
        return NotificationType.system;
      default:
        return NotificationType.unknown;
    }
  }

  NotificationModel copyWith({bool? isRead}) => NotificationModel(
    id: id,
    title: title,
    body: body,
    receivedAt: receivedAt,
    isRead: isRead ?? this.isRead,
    type: type,
    relatedOrderId: relatedOrderId,
    data: data,
  );

  Map<String, dynamic> toJson() => {
    'id': id,
    'title': title,
    'body': body,
    'receivedAt': receivedAt.toUtc().toIso8601String(),
    'isRead': isRead,
    'type': type.name,
    if (relatedOrderId != null) 'relatedOrderId': relatedOrderId,
    'data': data,
  };

  factory NotificationModel.fromJson(Map<String, dynamic> json) =>
      NotificationModel(
        id: json['id'] as String,
        title: (json['title'] as String?) ?? '',
        body: (json['body'] as String?) ?? '',
        receivedAt:
            DateTime.tryParse(json['receivedAt'] as String? ?? '')?.toUtc() ??
            DateTime.now().toUtc(),
        isRead: (json['isRead'] as bool?) ?? false,
        type: NotificationType.values.firstWhere(
          (t) => t.name == json['type'],
          orElse: () => NotificationType.unknown,
        ),
        relatedOrderId: json['relatedOrderId'] as String?,
        data:
            (json['data'] as Map?)?.map(
              (key, value) => MapEntry('$key', '$value'),
            ) ??
            const {},
      );
}
