import 'dart:async';
import 'dart:developer';

import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:go_router/go_router.dart';
import 'package:feniq/core/services/logger_service.dart';
import 'package:feniq/core/services/navigation_service.dart';
import 'package:feniq/core/session/session_scope.dart';
import 'package:feniq/features/auth/data/repositories/auth_repository.dart';
import 'package:feniq/features/notifications/data/models/notification_model.dart';
import 'package:feniq/features/notifications/data/repositories/notification_repository.dart';
import 'package:feniq/routes/route_names.dart';

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
  // Mirror the message into the local inbox so it is already there next time
  // the user opens the app - even if they never tap the banner. Deep-link
  // handling is untouched: that still happens on tap (onMessageOpenedApp) /
  // cold start (getInitialMessage). Best-effort; never throws.
  await saveNotificationInBackground(message);
}

const _androidChannel = AndroidNotificationChannel(
  'phoenix_default_channel',
  'General notifications',
  description: 'Order updates, offers, and announcements from Feniq.',
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
//
// Only one thing in here belongs to the signed-in account rather than to the
// device: a parked cold-start deep link (see resetForSignOut). It is the only
// part registered with SessionScope; the token handling and the listeners are
// untouched by a sign-out.
class FcmService implements SessionScoped {
  FcmService({
    required AuthRepository authRepository,
    required NotificationRepository notificationRepository,
    SessionScope? sessionScope,
    // Tests only: stands in for FirebaseMessaging.getInitialMessage, which
    // needs a real Firebase app. Production leaves it null.
    Future<RemoteMessage?> Function()? initialMessageReader,
  }) : _authRepository = authRepository,
       _notificationRepository = notificationRepository,
       _initialMessageReader = initialMessageReader {
    // Never unregistered: this service lives as long as the app.
    sessionScope?.register(this);
  }

  final AuthRepository _authRepository;
  final NotificationRepository _notificationRepository;
  final Future<RemoteMessage?> Function()? _initialMessageReader;
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

  // Audit P7: a cold-start notification (getInitialMessage) must not navigate
  // while the splash screen is still deciding the session / route. The whole
  // message is parked here and only acted on once BOTH are true: the app shell
  // is on screen (markAppReady, called from WarehouseSelectionView) and the
  // initial message has been read. `_initialDeepLinkHandled` makes it fire
  // exactly once.
  RemoteMessage? _pendingInitialMessage;
  bool _appReady = false;
  bool _initialDeepLinkHandled = false;

  // Bumped by resetForSignOut, so a cold-start message still being read when
  // the account signs out is dropped once it arrives (see
  // handleInitialMessage).
  int _session = 0;

  /// A parked cold-start message was addressed to the account that was signed
  /// in when the app was launched from it - it names that pharmacy's order or
  /// complaint. If that session ends before the shell came up to open it,
  /// whoever signs in next must not be taken there: the next markAppReady
  /// would otherwise open it for them.
  ///
  /// Only the parked message goes. The FCM token, its registration and the
  /// message listeners are left exactly as they are, and so are `_appReady`
  /// and `_initialDeepLinkHandled`.
  @override
  void resetForSignOut() {
    _session++;
    _pendingInitialMessage = null;
  }

  /// Parks a cold-start message until the app shell is ready (audit P7), or
  /// opens it straight away if the shell already is.
  @visibleForTesting
  void parkInitialMessage(RemoteMessage message) {
    _pendingInitialMessage = message;
    _maybeHandleInitialDeepLink();
  }

  /// Called by the app once the authenticated shell is on screen. Safe to
  /// call more than once.
  void markAppReady() {
    _appReady = true;
    _maybeHandleInitialDeepLink();
  }

  void _maybeHandleInitialDeepLink() {
    if (!_appReady || _initialDeepLinkHandled) return;
    final message = _pendingInitialMessage;
    if (message == null) return;
    _initialDeepLinkHandled = true;
    _pendingInitialMessage = null;
    _logger.info('FCM_DEBUG: processing pending initial deep link');
    _navigateForMessage(message);
  }

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

  /// Detaches this device from the account being signed out (audit F-07).
  ///
  /// Two steps, in this order. The backend row goes first, because that is
  /// what actually stops notifications being addressed here; deleting the
  /// Firebase token first would leave us without the value needed to name the
  /// row to remove. Then the Firebase token itself, so the next sign-in
  /// mints a fresh one rather than reusing an identifier the old account
  /// once owned.
  ///
  /// Never throws. Logging out must succeed even with no network - the
  /// server row is then left behind, but registerDeviceToken already pulls
  /// a token away from any previous owner when someone next signs in here.
  Future<void> unregisterDevice() async {
    try {
      final token = await _messaging.getToken();
      if (token != null && token.isNotEmpty) {
        await _authRepository.deleteDeviceToken(fcmToken: token);
      }
    } catch (e) {
      _logger.error('Failed to unregister device token with backend', e);
    }

    try {
      await _messaging.deleteToken();
    } catch (e) {
      _logger.error('Failed to delete the FCM token', e);
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
        _logger.info(
          'FCM_DEBUG: notification tap received (onDidReceiveNotificationResponse)',
        );
        _openDeepLinkPayload(response.payload);
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
      _logger.info(
        'FCM_DEBUG: relatedOrderId = ${message.data['relatedOrderId']}',
      );
      // Additive: keep a copy in the in-app inbox + bump the unread badge.
      _saveToInbox(message);
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
            payload: _deepLinkPayload(message),
          )
          // TEMP DIAGNOSTIC LOGS (see FCM_DEBUG task) - observes the same
          // Future .show() already returned (previously left unawaited/
          // unobserved) without changing when or how it runs.
          .then(
            (_) => _logger.info('FCM_DEBUG: local notification show completed'),
          )
          .catchError(
            (e) =>
                _logger.info('FCM_DEBUG: local notification show FAILED: $e'),
          );
    });

    // Background -> the user taps the OS-rendered notification, bringing
    // the already-running app to the foreground.
    FirebaseMessaging.onMessageOpenedApp.listen((message) {
      // TEMP DIAGNOSTIC LOGS (see FCM_DEBUG task).
      _logger.info('FCM_DEBUG: notification OPENED (onMessageOpenedApp)');
      // Additive: ensure it is in the inbox (deduped against the copy the
      // background isolate already saved).
      _saveToInbox(message);
      _navigateForMessage(message);
    });

    // Terminated -> tapping a notification is what launches the app fresh,
    // rather than resuming it - onMessageOpenedApp never fires for this
    // case, only getInitialMessage does.
    await handleInitialMessage();
  }

  /// The cold-start message: the notification whose tap launched the app, if
  /// any. Stored in the inbox, and its deep link parked (audit P7) so
  /// _maybeHandleInitialDeepLink navigates once the app shell is ready,
  /// instead of racing the splash screen's own navigation here.
  ///
  /// The read is async and starts while an account is signed in. If that
  /// account signs out (logout, a 401) before the answer arrives, the message
  /// was addressed to it and is dropped entirely - neither stored in the inbox
  /// the sign-out just emptied, nor parked - so the next account never sees
  /// it, listed or opened.
  @visibleForTesting
  Future<void> handleInitialMessage() async {
    // TEMP DIAGNOSTIC LOG (see FCM_DEBUG task).
    _logger.info('FCM_DEBUG: calling getInitialMessage()');
    // The session the read starts in, taken before the await.
    final session = _session;
    final initialMessage =
        await (_initialMessageReader?.call() ?? _messaging.getInitialMessage());
    _logger.info(
      'FCM_DEBUG: getInitialMessage() returned null = ${initialMessage == null}',
    );
    if (initialMessage == null) return;
    if (session != _session) {
      _logger.info(
        'FCM_DEBUG: signed out while the initial message was read - dropped',
      );
      return;
    }
    // Additive: ensure the cold-start message is in the inbox (deduped
    // against the background-isolate copy). This does NOT touch the P7
    // deep-link handling below.
    _saveToInbox(initialMessage);
    if (_deepLinkPayload(initialMessage) != null) {
      parkInitialMessage(initialMessage);
    }
  }

  // Section 12: a push can deep-link to an order OR (new) to a complaint. If a
  // message somehow carries both, the order wins - it is the older, more
  // time-sensitive flow.
  bool _navigateForMessage(RemoteMessage message) {
    final orderId = message.data['relatedOrderId'] as String?;
    if (orderId != null && orderId.isNotEmpty) {
      _openOrderTracking(orderId);
      return true;
    }
    final complaintId = message.data['relatedComplaintId'] as String?;
    if (complaintId != null && complaintId.isNotEmpty) {
      _openComplaintDetail(complaintId);
      return true;
    }
    return false;
  }

  // The string handed to the local (foreground) notification as its tap
  // payload, and parsed back by _openDeepLinkPayload. Kind-prefixed so one
  // channel can route to two different screens.
  String? _deepLinkPayload(RemoteMessage message) {
    final orderId = message.data['relatedOrderId'];
    if (orderId != null && '$orderId'.isNotEmpty) return 'order:$orderId';
    final complaintId = message.data['relatedComplaintId'];
    if (complaintId != null && '$complaintId'.isNotEmpty) return 'complaint:$complaintId';
    return null;
  }

  void _openDeepLinkPayload(String? payload) {
    if (payload == null || payload.isEmpty) return;
    final sep = payload.indexOf(':');
    // No prefix -> an older bare order id, kept working.
    if (sep <= 0) {
      _openOrderTracking(payload);
      return;
    }
    final kind = payload.substring(0, sep);
    final id = payload.substring(sep + 1);
    if (id.isEmpty) return;
    if (kind == 'complaint') {
      _openComplaintDetail(id);
    } else {
      _openOrderTracking(id);
    }
  }

  // Additive: mirror a received message into the in-app inbox. Fire-and-
  // forget so it never delays the deep-link / local-notification path.
  // Idempotent - NotificationRepository.add dedupes by message id, so calling
  // this from several callbacks for the same push stores it once.
  void _saveToInbox(RemoteMessage message) {
    final model = NotificationModel.fromRemoteMessage(message);
    if (model == null) return;
    unawaited(_notificationRepository.add(model));
  }

  void _openOrderTracking(String orderId) {
    // TEMP DIAGNOSTIC LOGS (see FCM_DEBUG task).
    _logger.info(
      'FCM_DEBUG: _openOrderTracking() called with orderId = $orderId',
    );
    final context = NavigationService.instance.navigatorKey.currentContext;
    _logger.info('FCM_DEBUG: navigator context available = ${context != null}');
    if (context == null) return;
    context.pushNamed(
      RouteNames.orderTracking,
      pathParameters: {'orderId': orderId},
    );
  }

  // Section 12: tapping "your complaint got a reply" opens that complaint.
  void _openComplaintDetail(String complaintId) {
    _logger.info('FCM_DEBUG: _openComplaintDetail() called with id = $complaintId');
    final context = NavigationService.instance.navigatorKey.currentContext;
    if (context == null) return;
    context.pushNamed(
      RouteNames.complaintDetail,
      pathParameters: {'complaintId': complaintId},
    );
  }
}
