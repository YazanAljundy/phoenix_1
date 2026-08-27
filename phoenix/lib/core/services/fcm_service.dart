import 'dart:developer';

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
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  // TEMP DIAGNOSTIC LOG (see FCM_DEBUG task) - runs in its own isolate, so
  // it can't use FcmService's _logger; dart:developer's log() is the one
  // already imported in this file and works from a background isolate.
  log('FCM_DEBUG: BACKGROUND MESSAGE RECEIVED');
  log('FCM_DEBUG: messageId = ${message.messageId}');
}

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
  FcmService({required AuthRepository authRepository})
    : _authRepository = authRepository;

  final AuthRepository _authRepository;
  // Accessed lazily (not as a field initializer) - FcmService itself is
  // constructed in main() before Firebase.initializeApp() has necessarily
  // resolved (and unconditionally in test setup, which never calls it at
  // all); FirebaseMessaging.instance throws immediately if Firebase isn't
  // ready yet, so this must only be touched once initialize() actually runs.
  FirebaseMessaging get _messaging => FirebaseMessaging.instance;
  final FlutterLocalNotificationsPlugin _localNotifications =
      FlutterLocalNotificationsPlugin();
  final _logger = LoggerService();
  bool _handlersReady = false;

  Future<void> initialize() async {
    try {
      // TEMP DIAGNOSTIC LOGS (see FCM_DEBUG task).
      _logger.info('FCM_DEBUG: requesting notification permission');
      final settings = await _messaging.requestPermission();
      _logger.info(
        'FCM_DEBUG: notification permission status = ${settings.authorizationStatus}',
      );

      await _setupHandlers();

      _logger.info('FCM_DEBUG: calling getToken()');
      final token = await _messaging.getToken();
      _logger.info('FCM_DEBUG: getToken() returned null = ${token == null}');
      if (token != null) {
        _logger.info('FCM_DEBUG: FCM token = ${_maskedToken(token)}');
        await _registerToken(token);
      }
      _messaging.onTokenRefresh.listen((refreshedToken) {
        _logger.info('FCM_DEBUG: FCM token refreshed');
        _logger.info('FCM_DEBUG: registering refreshed token with backend');
        _registerToken(refreshedToken);
      });
    } catch (e) {
      _logger.error('FcmService.initialize failed', e);
    }
  }

  // TEMP DIAGNOSTIC HELPER (see FCM_DEBUG task) - never logs the full token.
  String _maskedToken(String token) {
    if (token.length <= 16) return token;
    return '${token.substring(0, 8)}...${token.substring(token.length - 8)}';
  }

  Future<void> _registerToken(String token) async {
    try {
      // TEMP DIAGNOSTIC LOG (see FCM_DEBUG task).
      _logger.info('FCM_DEBUG: registering FCM token with backend');
      final deviceType = defaultTargetPlatform == TargetPlatform.iOS
          ? 'ios'
          : 'android';
      await _authRepository.registerDeviceToken(
        fcmToken: token,
        deviceType: deviceType,
      );
      // TEMP DIAGNOSTIC LOG (see FCM_DEBUG task).
      _logger.info('FCM_DEBUG: backend token registration succeeded');
    } catch (e) {
      // TEMP DIAGNOSTIC LOG (see FCM_DEBUG task).
      _logger.info('FCM_DEBUG: backend token registration failed: $e');
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
        // TEMP DIAGNOSTIC LOGS (see FCM_DEBUG task).
        _logger.info('FCM_DEBUG: notification tap received (onDidReceiveNotificationResponse)');
        final orderId = response.payload;
        _logger.info('FCM_DEBUG: relatedOrderId (from payload) = $orderId');
        if (orderId != null && orderId.isNotEmpty) {
          _logger.info('FCM_DEBUG: calling _openOrderTracking() from onDidReceiveNotificationResponse');
          _openOrderTracking(orderId);
        }
      },
    );
    // TEMP DIAGNOSTIC LOG (see FCM_DEBUG task).
    _logger.info('FCM_DEBUG: creating Android notification channel');
    await _localNotifications
        .resolvePlatformSpecificImplementation<
          AndroidFlutterLocalNotificationsPlugin
        >()
        ?.createNotificationChannel(_androidChannel);
    // TEMP DIAGNOSTIC LOG (see FCM_DEBUG task).
    _logger.info('FCM_DEBUG: notification channel created');

    // Foreground: FCM never shows a system banner on its own while the app
    // is open - this mirrors it via a local notification so a foreground
    // pharmacist still sees order/offer updates arrive.
    FirebaseMessaging.onMessage.listen((message) {
      // TEMP DIAGNOSTIC LOGS (see FCM_DEBUG task).
      _logger.info('FCM_DEBUG: onMessage RECEIVED');
      _logger.info('FCM_DEBUG: messageId = ${message.messageId}');
      final notification = message.notification;
      _logger.info('FCM_DEBUG: notification title = ${notification?.title}');
      _logger.info('FCM_DEBUG: notification body = ${notification?.body}');
      _logger.info('FCM_DEBUG: data keys = ${message.data.keys.toList()}');
      _logger.info('FCM_DEBUG: relatedOrderId = ${message.data['relatedOrderId']}');
      if (notification == null) return;
      _logger.info('FCM_DEBUG: showing foreground local notification');
      _localNotifications
          .show(
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
          )
          // TEMP DIAGNOSTIC LOGS (see FCM_DEBUG task) - observes the same
          // Future .show() already returned (previously left unawaited/
          // unobserved) without changing when or how it runs.
          .then((_) => _logger.info('FCM_DEBUG: local notification show completed'))
          .catchError((e) => _logger.info('FCM_DEBUG: local notification show FAILED: $e'));
    });

    // Background -> the user taps the OS-rendered notification, bringing
    // the already-running app to the foreground.
    FirebaseMessaging.onMessageOpenedApp.listen((message) {
      // TEMP DIAGNOSTIC LOGS (see FCM_DEBUG task).
      _logger.info('FCM_DEBUG: notification OPENED (onMessageOpenedApp)');
      final orderId = message.data['relatedOrderId'] as String?;
      _logger.info('FCM_DEBUG: relatedOrderId = $orderId');
      if (orderId != null && orderId.isNotEmpty) {
        _logger.info('FCM_DEBUG: calling _openOrderTracking() from onMessageOpenedApp');
        _openOrderTracking(orderId);
      }
    });

    // Terminated -> tapping a notification is what launches the app fresh,
    // rather than resuming it - onMessageOpenedApp never fires for this
    // case, only getInitialMessage does.
    // TEMP DIAGNOSTIC LOG (see FCM_DEBUG task).
    _logger.info('FCM_DEBUG: calling getInitialMessage()');
    final initialMessage = await _messaging.getInitialMessage();
    _logger.info(
      'FCM_DEBUG: getInitialMessage() returned null = ${initialMessage == null}',
    );
    final initialOrderId = initialMessage?.data['relatedOrderId'] as String?;
    _logger.info('FCM_DEBUG: initial relatedOrderId = $initialOrderId');
    if (initialOrderId != null && initialOrderId.isNotEmpty) {
      _logger.info('FCM_DEBUG: calling _openOrderTracking() from getInitialMessage');
      _openOrderTracking(initialOrderId);
    }
  }

  void _openOrderTracking(String orderId) {
    // TEMP DIAGNOSTIC LOGS (see FCM_DEBUG task).
    _logger.info('FCM_DEBUG: _openOrderTracking() called with orderId = $orderId');
    final context = NavigationService.instance.navigatorKey.currentContext;
    _logger.info('FCM_DEBUG: navigator context available = ${context != null}');
    if (context == null) return;
    context.pushNamed(
      RouteNames.orderTracking,
      pathParameters: {'orderId': orderId},
    );
  }
}
