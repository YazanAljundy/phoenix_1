import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:phoenix/core/services/storage_service.dart';
import 'package:phoenix/features/notifications/data/models/notification_model.dart';
import 'package:phoenix/features/notifications/data/repositories/notification_repository.dart';

RemoteMessage _backgroundMessage(String id) => RemoteMessage(
  messageId: id,
  sentTime: DateTime.utc(2026, 6, 1),
  data: const {'type': 'order_update', 'relatedOrderId': 'ord-bg'},
  notification: const RemoteNotification(title: 'Bg', body: 'From background'),
);

NotificationModel _model(
  String id, {
  DateTime? at,
  bool isRead = false,
  String? orderId,
  NotificationType type = NotificationType.orderUpdate,
}) {
  return NotificationModel(
    id: id,
    title: 'Title $id',
    body: 'Body $id',
    receivedAt: at ?? DateTime.utc(2026, 1, 1),
    isRead: isRead,
    type: type,
    relatedOrderId: orderId,
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late StorageService storage;
  late NotificationRepository repo;

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    storage = StorageService(await SharedPreferences.getInstance());
    repo = NotificationRepository(storage);
  });

  test('1. save + 2. retrieve newest first', () async {
    await repo.add(_model('a', at: DateTime.utc(2026, 1, 1)));
    await repo.add(_model('c', at: DateTime.utc(2026, 1, 3)));
    await repo.add(_model('b', at: DateTime.utc(2026, 1, 2)));

    expect(repo.current.map((n) => n.id).toList(), ['c', 'b', 'a']);
  });

  test('3. duplicate id is ignored', () async {
    await repo.add(_model('a'));
    await repo.add(_model('a', at: DateTime.utc(2030)));

    expect(repo.current.length, 1);
    expect(repo.current.single.receivedAt, DateTime.utc(2026, 1, 1));
  });

  test('4. markAsRead affects only that notification', () async {
    await repo.add(_model('a', at: DateTime.utc(2026, 1, 1)));
    await repo.add(_model('b', at: DateTime.utc(2026, 1, 2)));

    await repo.markAsRead('a');

    expect(repo.current.firstWhere((n) => n.id == 'a').isRead, isTrue);
    expect(repo.current.firstWhere((n) => n.id == 'b').isRead, isFalse);
  });

  test('5. markAllAsRead', () async {
    await repo.add(_model('a', at: DateTime.utc(2026, 1, 1)));
    await repo.add(_model('b', at: DateTime.utc(2026, 1, 2)));

    await repo.markAllAsRead();

    expect(repo.current.every((n) => n.isRead), isTrue);
    expect(repo.unreadCount, 0);
  });

  test('6. unread count is correct', () async {
    await repo.add(_model('a', at: DateTime.utc(2026, 1, 1)));
    await repo.add(_model('b', at: DateTime.utc(2026, 1, 2)));
    await repo.add(_model('c', at: DateTime.utc(2026, 1, 3)));
    expect(repo.unreadCount, 3);

    await repo.markAsRead('b');
    expect(repo.unreadCount, 2);
  });

  test('7. notifications survive a repository reload', () async {
    await repo.add(_model('a', orderId: 'ord-1'));
    await repo.markAsRead('a');

    // A fresh repository over the same storage = an app restart.
    final reopened = NotificationRepository(storage);

    expect(reopened.current.length, 1);
    expect(reopened.current.single.id, 'a');
    expect(reopened.current.single.isRead, isTrue);
    expect(reopened.current.single.relatedOrderId, 'ord-1');
  });

  test('8. exceeding the limit drops the oldest, keeps the newest', () async {
    for (var i = 0; i < kMaxStoredNotifications + 5; i++) {
      await repo.add(
        _model('n$i', at: DateTime.utc(2026, 1, 1).add(Duration(minutes: i))),
      );
    }

    expect(repo.current.length, kMaxStoredNotifications);
    // Newest kept...
    expect(repo.current.first.id, 'n${kMaxStoredNotifications + 4}');
    // ...oldest five dropped.
    expect(repo.current.any((n) => n.id == 'n0'), isFalse);
    expect(repo.current.any((n) => n.id == 'n4'), isFalse);
    expect(repo.current.any((n) => n.id == 'n5'), isTrue);
  });

  test('9. relatedOrderId is preserved through save + reload', () async {
    await repo.add(_model('a', orderId: 'order-777'));
    final reopened = NotificationRepository(storage);
    expect(reopened.current.single.relatedOrderId, 'order-777');
    expect(reopened.current.single.hasOrderDeepLink, isTrue);
  });

  test('10. empty inbox works', () async {
    expect(repo.current, isEmpty);
    expect(repo.unreadCount, 0);
    await repo.markAllAsRead();
    await repo.markAsRead('nope');
    expect(repo.current, isEmpty);
  });

  test(
    'a notification saved by "another isolate" is picked up on refresh',
    () async {
      // Simulate the FCM background isolate writing straight to storage.
      await saveNotificationInBackground(_backgroundMessage('bg-1'));

      expect(repo.current, isEmpty); // not seen yet (in-memory)
      await repo.refresh();
      expect(repo.current.single.id, 'bg-1');

      // add() for the same id (e.g. onMessageOpenedApp) must NOT duplicate it.
      await repo.add(_model('bg-1'));
      expect(repo.current.length, 1);
    },
  );
}
