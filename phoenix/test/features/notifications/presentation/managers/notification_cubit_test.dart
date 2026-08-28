import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:phoenix/core/services/storage_service.dart';
import 'package:phoenix/features/notifications/data/models/notification_model.dart';
import 'package:phoenix/features/notifications/data/repositories/notification_repository.dart';
import 'package:phoenix/features/notifications/presentation/managers/notification_cubit.dart';

NotificationModel _model(String id, {DateTime? at}) => NotificationModel(
  id: id,
  title: 'Title $id',
  body: 'Body $id',
  receivedAt: at ?? DateTime.utc(2026, 1, 1),
  type: NotificationType.offer,
);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late NotificationRepository repo;
  late NotificationCubit cubit;

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    repo = NotificationRepository(
      StorageService(await SharedPreferences.getInstance()),
    );
    cubit = NotificationCubit(repository: repo);
  });

  tearDown(() => cubit.close());

  test('starts empty', () {
    expect(cubit.state.notifications, isEmpty);
    expect(cubit.state.unreadCount, 0);
  });

  test('a new notification increments the unread count', () async {
    await repo.add(_model('a', at: DateTime.utc(2026, 1, 1)));
    await pumpEventQueue();
    expect(cubit.state.unreadCount, 1);

    await repo.add(_model('b', at: DateTime.utc(2026, 1, 2)));
    await pumpEventQueue();
    expect(cubit.state.unreadCount, 2);
    expect(cubit.state.notifications.first.id, 'b'); // newest first
  });

  test('marking one read decrements the unread count', () async {
    await repo.add(_model('a', at: DateTime.utc(2026, 1, 1)));
    await repo.add(_model('b', at: DateTime.utc(2026, 1, 2)));
    await pumpEventQueue();
    expect(cubit.state.unreadCount, 2);

    await cubit.markAsRead('a');
    await pumpEventQueue();
    expect(cubit.state.unreadCount, 1);
  });

  test('mark all as read takes the count to zero', () async {
    await repo.add(_model('a', at: DateTime.utc(2026, 1, 1)));
    await repo.add(_model('b', at: DateTime.utc(2026, 1, 2)));
    await pumpEventQueue();

    await cubit.markAllAsRead();
    await pumpEventQueue();

    expect(cubit.state.unreadCount, 0);
    expect(cubit.state.notifications.every((n) => n.isRead), isTrue);
  });

  test('duplicate delivery does not double-count', () async {
    await repo.add(_model('a'));
    await repo.add(_model('a'));
    await pumpEventQueue();
    expect(cubit.state.unreadCount, 1);
    expect(cubit.state.notifications.length, 1);
  });
}
