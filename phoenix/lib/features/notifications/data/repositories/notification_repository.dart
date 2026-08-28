import 'dart:async';
import 'dart:convert';

import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:phoenix/core/services/storage_service.dart';
import 'package:phoenix/features/notifications/data/models/notification_model.dart';

/// Hard cap on locally-kept notifications. When exceeded the oldest are
/// dropped (never the unread ones specifically - only "oldest first").
const int kMaxStoredNotifications = 100;

/// SharedPreferences key holding the whole inbox as one JSON array.
const String kNotificationsStorageKey = 'notifications.inbox';

// --- Pure helpers (shared by the repository and the background isolate) -----

List<NotificationModel> decodeNotificationList(String? raw) {
  if (raw == null || raw.isEmpty) return const [];
  try {
    final decoded = jsonDecode(raw);
    if (decoded is! List) return const [];
    final items = decoded
        .whereType<Map<String, dynamic>>()
        .map(NotificationModel.fromJson)
        .toList();
    items.sort((a, b) => b.receivedAt.compareTo(a.receivedAt));
    return items;
  } catch (_) {
    return const [];
  }
}

String encodeNotificationList(List<NotificationModel> items) =>
    jsonEncode(items.map((n) => n.toJson()).toList());

/// Newest-first merge of [incoming] into [existing], deduped by id and capped
/// at [maxItems]. Returns [existing] unchanged when the id is already present.
List<NotificationModel> mergeNotification(
  List<NotificationModel> existing,
  NotificationModel incoming, {
  required int maxItems,
}) {
  if (existing.any((n) => n.id == incoming.id)) return existing;
  final combined = [incoming, ...existing]
    ..sort((a, b) => b.receivedAt.compareTo(a.receivedAt));
  return combined.length > maxItems ? combined.sublist(0, maxItems) : combined;
}

/// Called from the FCM **background isolate**
/// (`firebaseMessagingBackgroundHandler`) so a notification received while the
/// app is terminated / backgrounded is already in the inbox the next time the
/// user opens the app - without waiting for them to tap the banner.
///
/// Isolate-safe: its own SharedPreferences handle, a fresh `reload()`, one
/// read-modify-write. Best-effort - never throws; if it fails the inbox still
/// captures the push on tap (onMessageOpenedApp / getInitialMessage) or on the
/// next foreground receipt.
Future<void> saveNotificationInBackground(RemoteMessage message) async {
  try {
    final model = NotificationModel.fromRemoteMessage(message);
    if (model == null) return;
    final prefs = await SharedPreferences.getInstance();
    await prefs.reload();
    final existing = decodeNotificationList(
      prefs.getString(kNotificationsStorageKey),
    );
    if (existing.any((n) => n.id == model.id)) return;
    final merged = mergeNotification(
      existing,
      model,
      maxItems: kMaxStoredNotifications,
    );
    await prefs.setString(
      kNotificationsStorageKey,
      encodeNotificationList(merged),
    );
  } catch (_) {
    // Best-effort only.
  }
}

// --- Repository ------------------------------------------------------------

/// The single source of truth for the in-app inbox, backed by the project's
/// existing non-sensitive local store (SharedPreferences via [StorageService]).
///
/// Every mutating call reconciles with disk first (`reload()`), so a write
/// made by [saveNotificationInBackground] in the background isolate is neither
/// lost nor duplicated.
class NotificationRepository {
  NotificationRepository(this._storage) {
    _items = _readFromDisk();
  }

  final StorageService _storage;
  final StreamController<List<NotificationModel>> _controller =
      StreamController<List<NotificationModel>>.broadcast();

  List<NotificationModel> _items = const [];

  /// Emits the full list (newest first) on every change.
  Stream<List<NotificationModel>> get changes => _controller.stream;

  List<NotificationModel> get current => List.unmodifiable(_items);

  int get unreadCount => _items.where((n) => !n.isRead).length;

  List<NotificationModel> _readFromDisk() =>
      decodeNotificationList(_storage.getString(kNotificationsStorageKey));

  void _emit() {
    if (!_controller.isClosed) _controller.add(current);
  }

  Future<void> _persist(List<NotificationModel> items) async {
    _items = items;
    await _storage.setString(
      kNotificationsStorageKey,
      encodeNotificationList(items),
    );
    _emit();
  }

  /// Re-read from disk - picks up notifications the background isolate saved
  /// while the app was away. Called on app-resume and when the inbox opens.
  Future<void> refresh() async {
    await _storage.reload();
    _items = _readFromDisk();
    _emit();
  }

  /// Store one received notification. A no-op (bar a refresh) when a
  /// notification with the same id already exists - safe to call from every
  /// FCM callback for the same message.
  Future<void> add(NotificationModel model) async {
    await _storage.reload();
    final current = _readFromDisk();
    if (current.any((n) => n.id == model.id)) {
      // Already stored (e.g. by the background isolate) - just surface
      // whatever else disk now has.
      _items = current;
      _emit();
      return;
    }
    await _persist(
      mergeNotification(current, model, maxItems: kMaxStoredNotifications),
    );
  }

  Future<void> markAsRead(String id) async {
    await _storage.reload();
    final current = _readFromDisk();
    if (!current.any((n) => n.id == id && !n.isRead)) {
      _items = current;
      _emit();
      return;
    }
    await _persist([
      for (final n in current) n.id == id ? n.copyWith(isRead: true) : n,
    ]);
  }

  Future<void> markAllAsRead() async {
    await _storage.reload();
    final current = _readFromDisk();
    if (current.every((n) => n.isRead)) {
      _items = current;
      _emit();
      return;
    }
    await _persist([for (final n in current) n.copyWith(isRead: true)]);
  }
}
