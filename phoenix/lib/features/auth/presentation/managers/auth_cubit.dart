import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:feniq/core/constants/storage_keys.dart';
import 'package:feniq/core/error/failure.dart';
import 'package:feniq/core/services/auth_event_bus.dart';
import 'package:feniq/core/services/fcm_service.dart';
import 'package:feniq/core/services/navigation_service.dart';
import 'package:feniq/core/services/secure_storage_service.dart';
import 'package:feniq/features/auth/data/models/auth_response.dart';
import 'package:feniq/features/auth/data/models/user_model.dart';
import 'package:feniq/features/auth/data/repositories/auth_repository_impl.dart';
import 'package:feniq/features/notifications/data/repositories/notification_repository.dart';
import 'package:feniq/routes/route_names.dart';

import 'auth_state.dart';

class AuthCubit extends Cubit<AuthState> {
  AuthCubit({
    required AuthRepositoryImpl authRepository,
    required SecureStorageService secureStorage,
    required FcmService fcmService,
    required NotificationRepository notificationRepository,
  }) : _authRepository = authRepository,
       _secureStorage = secureStorage,
       _fcmService = fcmService,
       _notificationRepository = notificationRepository,
       super(const AuthState()) {
    // A single app-wide place reacts to "an authenticated request got 401"
    // (emitted by AuthInterceptor). Re-entrancy is guarded inside
    // _handleUnauthorized, so a burst of parallel 401s still logs out once.
    _unauthorizedSubscription = AuthEventBus.instance.onUnauthorized.listen(
      (_) => _handleUnauthorized(),
    );
  }

  final AuthRepositoryImpl _authRepository;
  final SecureStorageService _secureStorage;
  final FcmService _fcmService;

  // Injected rather than reached through NotificationCubit so that both
  // logout paths - the deliberate one and the forced 401 one - clear the
  // inbox from the same place, instead of each caller having to remember.
  final NotificationRepository _notificationRepository;

  late final StreamSubscription<void> _unauthorizedSubscription;

  // Guards against the token being deleted / the user being redirected more
  // than once when several requests come back 401 at nearly the same time.
  // Reset on any successful authentication (fresh valid session).
  bool _isHandlingUnauthorized = false;

  // Serializes session checks: splash start, the approval screen's "check
  // status" button and app-resume revalidation all funnel through
  // checkSession(); this stops them from firing overlapping GET /auth/me.
  bool _sessionCheckInFlight = false;

  // When the last session validation actually hit the network. Used to
  // throttle app-resume revalidation (see revalidateOnResume).
  DateTime? _lastValidatedAt;

  // Long enough that a quick trip to the camera / a permission dialog / the
  // app switcher never triggers a /auth/me, short enough that a session
  // revoked while the app sat in the background (admin block, 7-day expiry)
  // is caught soon after the user returns rather than on their next action.
  static const Duration _resumeRevalidateThrottle = Duration(minutes: 5);

  void _log(String message) {
    if (kDebugMode) debugPrint(message);
  }

  // Section 6.10 / audit C1: differentiate the outcomes of validating the
  // stored token instead of treating every failure as "log out".
  //
  //   no token                     -> unauthenticated -> Login
  //   200                          -> active / pendingApproval / blocked
  //   401 / 403                    -> clear token -> unauthenticated -> Login
  //   timeout / offline / 5xx      -> KEEP token
  //                                   startup  -> SessionStatus.offline (splash
  //                                               proceeds into the app anyway)
  //                                   resume   -> no state change (stay signed in)
  Future<void> checkSession({bool isResume = false}) async {
    if (_sessionCheckInFlight) {
      _log('[AUTH] Session check already running - ignoring duplicate call');
      return;
    }
    _sessionCheckInFlight = true;
    try {
      _log('[AUTH] Session check started (resume: $isResume)');
      final token = await _secureStorage.read(StorageKeys.authToken);
      if (token == null || token.isEmpty) {
        _log('[AUTH] No token - unauthenticated');
        _isHandlingUnauthorized = false;
        emit(const AuthState(sessionStatus: SessionStatus.unauthenticated));
        return;
      }
      _log('[AUTH] Token found - validating with GET /auth/me');
      _lastValidatedAt = DateTime.now();

      try {
        final me = await _authRepository.getMe();
        final sessionStatus = _sessionStatusFor(me.user);
        _isHandlingUnauthorized = false;
        _log('[AUTH] Session valid ($sessionStatus)');
        emit(
          state.copyWith(
            sessionStatus: sessionStatus,
            user: me.user,
            pharmacy: me.pharmacy,
            clearError: true,
          ),
        );
        _registerForPushIfActive(sessionStatus);
      } on Failure catch (f) {
        final statusCode = f is ServerFailure ? f.statusCode : null;
        if (statusCode == 401 || statusCode == 403) {
          _log('[AUTH] Unauthorized ($statusCode) - clearing session');
          await _handleUnauthorized();
        } else if (isResume) {
          _log(
            '[AUTH] Network/server error on resume - keeping session, no change',
          );
        } else {
          _log('[AUTH] Network/server error - keeping token, showing offline');
          emit(
            state.copyWith(
              sessionStatus: SessionStatus.offline,
              errorCode: f.code,
              errorMessage: f.errMessage,
            ),
          );
        }
      }
    } catch (e) {
      // Anything unexpected (e.g. a malformed /auth/me body) is not proof the
      // token is bad - never delete it here. Startup falls back to the retry
      // screen; a resume leaves the session as-is.
      _log('[AUTH] Unexpected error during session check - keeping token ($e)');
      if (!isResume) {
        emit(state.copyWith(sessionStatus: SessionStatus.offline));
      }
    } finally {
      _sessionCheckInFlight = false;
    }
  }

  // Audit P5: re-validate the session when the app returns to the foreground
  // after actually being backgrounded - throttled, and only when we believe
  // we have a session to check. A network failure here never signs the user
  // out (checkSession(isResume: true)); only a 401/403 does.
  Future<void> revalidateOnResume() async {
    final status = state.sessionStatus;
    if (status != SessionStatus.active &&
        status != SessionStatus.pendingApproval) {
      return;
    }
    final last = _lastValidatedAt;
    if (last != null &&
        DateTime.now().difference(last) < _resumeRevalidateThrottle) {
      _log(
        '[AUTH] App resumed - within throttle window, skipping revalidation',
      );
      return;
    }
    _log('[AUTH] App resumed - revalidating session');
    await checkSession(isResume: true);
  }

  // Called by WarehouseSelectionView (the one guaranteed post-auth landing
  // screen) once it is on screen. Lets FcmService safely act on a cold-start
  // notification deep link now that the session is confirmed active and app
  // navigation is ready - fixing the splash/deep-link race (audit P7).
  void notifyAppShellReady() {
    _fcmService.markAppReady();
  }

  // TODO(re-enable-otp): unused by the current registration flow - kept for
  // a future re-enable. The backend route is still live.
  Future<bool> sendOtp(String phone) async {
    emit(state.copyWith(isSubmitting: true, clearError: true));
    try {
      await _authRepository.sendOtp(phone);
      emit(state.copyWith(isSubmitting: false, otpSent: true));
      return true;
    } on Failure catch (f) {
      emit(
        state.copyWith(
          isSubmitting: false,
          errorMessage: f.errMessage,
          errorCode: f.code,
        ),
      );
      return false;
    }
  }

  // Section 6-2/3: registers and saves directly - no OTP step (temporarily
  // disabled, see auth_repository.dart).
  //
  // This is registration ONLY. It used to double as the returning-user re-entry
  // path - a phone that already had an account was simply logged back in - but
  // that was an authentication bypass (the server never checked the password;
  // audit C-1 and F-01 are the same finding) and has been closed. A known phone
  // now comes back as a 409 with code PHONE_ALREADY_REGISTERED, which
  // error_translator.dart turns into a message telling the user to sign in
  // instead; the screen already offers a link to PasswordLoginView.
  Future<bool> register({
    required String name,
    required String pharmacyName,
    required String phone,
    required String address,
    required String areaType,
    required String password,
    double? latitude,
    double? longitude,
  }) async {
    emit(state.copyWith(isSubmitting: true, clearError: true));
    try {
      final result = await _authRepository.register(
        name: name,
        pharmacyName: pharmacyName,
        phone: phone,
        address: address,
        areaType: areaType,
        password: password,
        latitude: latitude,
        longitude: longitude,
      );
      await _persistSession(result);
      _onAuthenticated();
      final sessionStatus = _sessionStatusFor(result.user);
      emit(
        state.copyWith(
          isSubmitting: false,
          sessionStatus: sessionStatus,
          user: result.user,
          pharmacy: result.pharmacy,
        ),
      );
      _registerForPushIfActive(sessionStatus);
      return true;
    } on Failure catch (f) {
      emit(
        state.copyWith(
          isSubmitting: false,
          errorMessage: f.errMessage,
          errorCode: f.code,
        ),
      );
      return false;
    }
  }

  // Section 6-2: phone + password, no OTP - only usable after an account
  // already went through register() at least once.
  Future<bool> loginWithPassword({
    required String phone,
    required String password,
  }) async {
    emit(state.copyWith(isSubmitting: true, clearError: true));
    try {
      final result = await _authRepository.loginWithPassword(
        phone: phone,
        password: password,
      );
      await _persistSession(result);
      _onAuthenticated();
      final sessionStatus = _sessionStatusFor(result.user);
      emit(
        state.copyWith(
          isSubmitting: false,
          sessionStatus: sessionStatus,
          user: result.user,
          pharmacy: result.pharmacy,
        ),
      );
      _registerForPushIfActive(sessionStatus);
      return true;
    } on Failure catch (f) {
      emit(
        state.copyWith(
          isSubmitting: false,
          errorMessage: f.errMessage,
          errorCode: f.code,
        ),
      );
      return false;
    } catch (e) {
      // Anything that is NOT a Failure - in practice a parse error on a
      // response shape this build did not expect. Before this existed such an
      // error escaped the cubit entirely, `isSubmitting` stayed true, and the
      // user sat on a spinner with no message and no way back, so a whole
      // class of accounts looked like "login is down" rather than like a bug.
      // A response we cannot read is still a failed login and has to land on
      // the state like any other.
      _log('[AUTH] Unexpected error during password login ($e)');
      emit(
        state.copyWith(
          isSubmitting: false,
          errorCode: 'UNEXPECTED_ERROR',
          errorMessage: e.toString(),
        ),
      );
      return false;
    }
  }

  // Permanently deletes the account, then tears the local session down exactly
  // the way logout() does. The token is already dead server-side by the time
  // this returns (the account's status refuses it), so leaving it on disk would
  // only produce a confusing 401 on the next launch.
  //
  // Returns true on success; on failure the error is published on the state
  // (errorCode 'INVALID_CURRENT_PASSWORD' for a wrong password) and the session
  // is left untouched.
  Future<bool> deleteAccount({required String password}) async {
    emit(state.copyWith(isSubmitting: true, clearError: true));
    try {
      await _authRepository.deleteAccount(password: password);
    } on Failure catch (f) {
      emit(
        state.copyWith(
          isSubmitting: false,
          errorMessage: f.errMessage,
          errorCode: f.code,
        ),
      );
      return false;
    }

    await logout();
    return true;
  }

  Future<void> logout() async {
    _isHandlingUnauthorized = false;
    _lastValidatedAt = null;

    // Before the token goes: detaching the device needs an Authorization
    // header, so this has to happen while the session is still usable
    // (audit F-07). Every step is individually best-effort - none of them
    // may prevent the user from signing out.
    try {
      await _fcmService.unregisterDevice();
    } catch (_) {
      // FcmService already swallows its own failures, but logout must not
      // depend on that staying true - being unable to reach the server can
      // never be a reason a user cannot sign out of this device.
    }
    await _clearLocalUserData();

    try {
      await _clearStoredSession();
    } catch (_) {
      // Best-effort - the local session is cleared regardless.
    }
    emit(const AuthState(sessionStatus: SessionStatus.unauthenticated));
  }

  // Anything readable on this device that belonged to the account being
  // signed out. The notification inbox is a single global
  // SharedPreferences key, so without this the next person to sign in on a
  // shared phone would read the previous pharmacist's notifications
  // (audit F-08).
  Future<void> _clearLocalUserData() async {
    try {
      await _notificationRepository.clear();
    } catch (_) {
      // Best-effort.
    }
  }

  // Both tokens land together or not at all. The refresh token is what lets
  // AuthInterceptor ride over the 24h access-token expiry (audit F-03)
  // without bouncing the user to the login screen.
  Future<void> _persistSession(AuthResponse result) async {
    await _secureStorage.write(StorageKeys.authToken, result.token);
    final refreshToken = result.refreshToken;
    if (refreshToken != null && refreshToken.isNotEmpty) {
      await _secureStorage.write(StorageKeys.refreshToken, refreshToken);
    } else {
      // Talking to a backend that predates refresh tokens. Drop any stale
      // one rather than leaving a previous session's credential behind.
      await _secureStorage.delete(StorageKeys.refreshToken);
    }
  }

  // Signing out must leave nothing behind that could resume the session -
  // and the refresh token is exactly that, so it has to go with the access
  // token rather than outliving it in secure storage.
  Future<void> _clearStoredSession() async {
    await _secureStorage.delete(StorageKeys.authToken);
    await _secureStorage.delete(StorageKeys.refreshToken);
  }

  // A fresh, confirmed sign-in: re-arm the 401 handler and reset the
  // validation clock so resume-revalidation is measured from now.
  void _onAuthenticated() {
    _isHandlingUnauthorized = false;
    _lastValidatedAt = DateTime.now();
  }

  // Audit C2: the one logout path for "the server rejected our token".
  // Idempotent - a burst of parallel 401s runs the body once. Navigation
  // uses go() (not push()), so Back cannot return to the protected screen.
  Future<void> _handleUnauthorized() async {
    if (_isHandlingUnauthorized) return;
    _isHandlingUnauthorized = true;
    // Already on the auth screens (e.g. a stray in-flight 401 arriving just
    // after a manual logout) - clear anything left, but don't yank the user
    // off the registration/login screen they're already on.
    final alreadySignedOut =
        state.sessionStatus == SessionStatus.unauthenticated;
    _log('[AUTH] Handling unauthorized - clearing token and session');
    // The session is already rejected, so there is no point calling the
    // backend to detach the device - but the local inbox still has to go,
    // for the same shared-device reason a deliberate logout clears it.
    await _clearLocalUserData();
    try {
      await _clearStoredSession();
    } catch (_) {
      // Best-effort cleanup.
    }
    if (!isClosed) {
      emit(const AuthState(sessionStatus: SessionStatus.unauthenticated));
    }
    if (!alreadySignedOut) {
      _goToLogin();
    }
  }

  void _goToLogin() {
    // Navigation must never be able to break the token/state cleanup that
    // already ran above it.
    try {
      final context = NavigationService.instance.navigatorKey.currentContext;
      if (context == null) {
        // No navigator yet (very early startup) - the splash screen's own
        // listener will route on the emitted `unauthenticated` state instead.
        return;
      }
      context.goNamed(RouteNames.login);
    } catch (e) {
      _log('[AUTH] Could not navigate to Login: $e');
    }
  }

  // Fire-and-forget on purpose: FcmService swallows its own errors and this
  // must never delay (or fail) the login/session-restore flow it's called
  // from - a blocked/pending account never reaches this since there's no
  // device registration to do for an account that can't use the app yet.
  void _registerForPushIfActive(SessionStatus sessionStatus) {
    if (sessionStatus == SessionStatus.active) {
      unawaited(_fcmService.initialize());
    }
  }

  SessionStatus _sessionStatusFor(UserModel user) {
    if (user.isBlocked) return SessionStatus.blocked;
    if (user.isPending) return SessionStatus.pendingApproval;
    return SessionStatus.active;
  }

  @override
  Future<void> close() {
    _unauthorizedSubscription.cancel();
    return super.close();
  }
}
