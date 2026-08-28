import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:phoenix/features/notifications/data/models/notification_model.dart';

RemoteMessage _message({
  String? messageId,
  String? title = 'Order Update',
  String? body = 'Your order #123 is ready',
  Map<String, dynamic> data = const {},
  DateTime? sentTime,
}) {
  return RemoteMessage(
    messageId: messageId,
    sentTime: sentTime,
    data: data,
    notification: (title == null && body == null)
        ? null
        : RemoteNotification(title: title, body: body),
  );
}

void main() {
  group('NotificationModel.fromRemoteMessage', () {
    test('maps every supported field from the FCM payload', () {
      final model = NotificationModel.fromRemoteMessage(
        _message(
          messageId: 'abc123',
          title: 'Order Update',
          body: 'Your order #42 is on the way',
          sentTime: DateTime.utc(2026, 1, 2, 10, 30),
          data: const {'type': 'order_update', 'relatedOrderId': 'order-42'},
        ),
      )!;

      expect(model.id, 'abc123');
      expect(model.title, 'Order Update');
      expect(model.body, 'Your order #42 is on the way');
      expect(model.type, NotificationType.orderUpdate);
      expect(model.relatedOrderId, 'order-42');
      expect(model.hasOrderDeepLink, isTrue);
      expect(model.isRead, isFalse);
      expect(model.receivedAt, DateTime.utc(2026, 1, 2, 10, 30));
      expect(model.data['type'], 'order_update');
    });

    test('parses each backend notification type', () {
      NotificationType typeOf(String raw) =>
          NotificationModel.fromRemoteMessage(
            _message(data: {'type': raw}),
          )!.type;

      expect(typeOf('order_update'), NotificationType.orderUpdate);
      expect(typeOf('offer'), NotificationType.offer);
      expect(typeOf('system'), NotificationType.system);
      expect(typeOf('something_new'), NotificationType.unknown);
    });

    test('offer / system notifications carry no order deep-link', () {
      final offer = NotificationModel.fromRemoteMessage(
        _message(data: const {'type': 'offer'}),
      )!;
      expect(offer.relatedOrderId, isNull);
      expect(offer.hasOrderDeepLink, isFalse);
    });

    test('returns null when there is nothing to show (no title, no body)', () {
      expect(
        NotificationModel.fromRemoteMessage(_message(title: null, body: null)),
        isNull,
      );
    });

    test('falls back to a stable content id when FCM sends no messageId', () {
      final a = NotificationModel.fromRemoteMessage(
        _message(
          messageId: null,
          sentTime: DateTime.utc(2026, 1, 1),
          data: const {'type': 'offer'},
        ),
      )!;
      final b = NotificationModel.fromRemoteMessage(
        _message(
          messageId: null,
          sentTime: DateTime.utc(2026, 1, 1),
          data: const {'type': 'offer'},
        ),
      )!;

      // Same push seen twice -> same id -> dedup still works.
      expect(a.id, b.id);
      expect(a.id, startsWith('local:'));
    });
  });

  group('NotificationModel JSON round-trip', () {
    test('preserves every field including relatedOrderId and data', () {
      final original = NotificationModel.fromRemoteMessage(
        _message(
          messageId: 'm1',
          sentTime: DateTime.utc(2026, 3, 4, 8),
          data: const {'type': 'order_update', 'relatedOrderId': 'ord-9'},
        ),
      )!.copyWith(isRead: true);

      final restored = NotificationModel.fromJson(original.toJson());

      expect(restored.id, original.id);
      expect(restored.title, original.title);
      expect(restored.body, original.body);
      expect(restored.receivedAt, original.receivedAt);
      expect(restored.isRead, isTrue);
      expect(restored.type, NotificationType.orderUpdate);
      expect(restored.relatedOrderId, 'ord-9');
      expect(restored.data['relatedOrderId'], 'ord-9');
    });
  });
}
