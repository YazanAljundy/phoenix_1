import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:phoenix/core/constants/storage_keys.dart';
import 'package:phoenix/core/error/failure.dart';
import 'package:phoenix/core/services/auth_event_bus.dart';
import 'package:phoenix/core/services/fcm_service.dart';
import 'package:phoenix/core/services/navigation_service.dart';
import 'package:phoenix/core/services/secure_storage_service.dart';
import 'package:phoenix/features/auth/data/models/user_model.dart';
import 'package:phoenix/features/auth/data/repositories/auth_repository_impl.dart';
import 'package:phoenix/routes/route_names.dart';

import 'auth_state.dart';

class AuthCubit extends Cubit<AuthState> {
  AuthCubit({
    required AuthRepositoryImpl authRepository,
    required SecureStorageService secureStorage,
    required FcmService fcmService,
  }) : _authRepository = authRepository,
       _secureStorage = secureStorage,
       _fcmService = fcmService,
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
  //                                   startup  -> SessionStatus.offline (retry UI)
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
  // disabled, see auth_repository.dart). Also serves as the returning-user
  // re-entry path: if `phone` already has an account, the backend logs it
  // back in and ignores name/pharmacyName/address/password.
  Future<bool> register({
    required String name,
    required String pharmacyName,
    required String phone,
    required String address,
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
        password: password,
        latitude: latitude,
        longitude: longitude,
      );
      await _secureStorage.write(StorageKeys.authToken, result.token);
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
      await _secureStorage.write(StorageKeys.authToken, result.token);
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

  Future<void> logout() async {
    _isHandlingUnauthorized = false;
    _lastValidatedAt = null;
    try {
      await _secureStorage.delete(StorageKeys.authToken);
    } catch (_) {
      // Best-effort - the local session is cleared regardless.
    }
    emit(const AuthState(sessionStatus: SessionStatus.unauthenticated));
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
    try {
      await _secureStorage.delete(StorageKeys.authToken);
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
