import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:go_router/go_router.dart';
import 'package:phoenix/core/services/logger_service.dart';
import 'package:phoenix/core/services/navigation_service.dart';
import 'package:phoenix/features/auth/data/repositories/auth_repository.dart';
import 'package:phoenix/routes/route_names.dart';

// Registered as FirebaseMessaging.onBackgroundMessage in main.dart - must be
// a top-level (or static) function annotated exactly like this, since the
// plugin runs it in its own background isolate, not as a method on
// FcmService. There's nothing to do in it: the OS/FCM already renders the
// notification banner for a background/terminated message on its own: this
// only exists because onBackgroundMessage requires *some* handler to be
// registered before it will deliver background messages at all.
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {}

const _androidChannel = AndroidNotificationChannel(
  'phoenix_default_channel',
  'General notifications',
  description: 'Order updates, offers, and announcements from Phoenix.',
  importance: Importance.high,
);

// Push notifications (order status updates, new offers, admin
// announcements - see backend/src/services/notification.service.js).
// Requests permission, keeps the backend's record of this device's FCM
// token current, and renders/reacts to messages depending on whether the
// app is foregrounded, backgrounded, or was launched by tapping one.
//
// Every public entry point here swallows its own errors - notifications are
// a nice-to-have layered on top of an already-successful login, never a
// reason to block or break it.
class FcmService {
  FcmService({required AuthRepository authRepository}) : _authRepository = authRepository;

  final AuthRepository _authRepository;
  // Accessed lazily (not as a field initializer) - FcmService itself is
  // constructed in main() before Firebase.initializeApp() has necessarily
  // resolved (and unconditionally in test setup, which never calls it at
  // all); FirebaseMessaging.instance throws immediately if Firebase isn't
  // ready yet, so this must only be touched once initialize() actually runs.
  FirebaseMessaging get _messaging => FirebaseMessaging.instance;
  final FlutterLocalNotificationsPlugin _localNotifications = FlutterLocalNotificationsPlugin();
  final _logger = LoggerService();
  bool _handlersReady = false;

  Future<void> initialize() async {
    try {
      await _messaging.requestPermission();
      await _setupHandlers();

      final token = await _messaging.getToken();
      if (token != null) await _registerToken(token);
      _messaging.onTokenRefresh.listen(_registerToken);
    } catch (e) {
      _logger.error('FcmService.initialize failed', e);
    }
  }

  Future<void> _registerToken(String token) async {
    try {
      final deviceType = defaultTargetPlatform == TargetPlatform.iOS ? 'ios' : 'android';
      await _authRepository.registerDeviceToken(fcmToken: token, deviceType: deviceType);
    } catch (e) {
      _logger.error('Failed to register device token', e);
    }
  }

  // Idempotent/guarded so calling initialize() again on a later login (a
  // fresh account on the same device, after a logout) doesn't stack a
  // second set of listeners.
  Future<void> _setupHandlers() async {
    if (_handlersReady) return;
    _handlersReady = true;

    await _localNotifications.initialize(
      const InitializationSettings(
        android: AndroidInitializationSettings('@mipmap/ic_launcher'),
        iOS: DarwinInitializationSettings(),
      ),
      onDidReceiveNotificationResponse: (response) {
        final orderId = response.payload;
        if (orderId != null && orderId.isNotEmpty) _openOrderTracking(orderId);
      },
    );
    await _localNotifications
        .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
        ?.createNotificationChannel(_androidChannel);

    // Foreground: FCM never shows a system banner on its own while the app
    // is open - this mirrors it via a local notification so a foreground
    // pharmacist still sees order/offer updates arrive.
    FirebaseMessaging.onMessage.listen((message) {
      final notification = message.notification;
      if (notification == null) return;
      _localNotifications.show(
        notification.hashCode,
        notification.title,
        notification.body,
        NotificationDetails(
          android: AndroidNotificationDetails(
            _androidChannel.id,
            _androidChannel.name,
            channelDescription: _androidChannel.description,
            importance: Importance.high,
            priority: Priority.high,
          ),
          iOS: const DarwinNotificationDetails(),
        ),
        payload: message.data['relatedOrderId'] as String?,
      );
    });

    // Background -> the user taps the OS-rendered notification, bringing
    // the already-running app to the foreground.
    FirebaseMessaging.onMessageOpenedApp.listen((message) {
      final orderId = message.data['relatedOrderId'] as String?;
      if (orderId != null && orderId.isNotEmpty) _openOrderTracking(orderId);
    });

    // Terminated -> tapping a notification is what launches the app fresh,
    // rather than resuming it - onMessageOpenedApp never fires for this
    // case, only getInitialMessage does.
    final initialMessage = await _messaging.getInitialMessage();
    final initialOrderId = initialMessage?.data['relatedOrderId'] as String?;
    if (initialOrderId != null && initialOrderId.isNotEmpty) _openOrderTracking(initialOrderId);
  }

  void _openOrderTracking(String orderId) {
    final context = NavigationService.instance.navigatorKey.currentContext;
    if (context == null) return;
    context.pushNamed(RouteNames.orderTracking, pathParameters: {'orderId': orderId});
  }
}
