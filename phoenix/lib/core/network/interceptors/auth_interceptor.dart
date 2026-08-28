import 'package:dio/dio.dart';
import 'package:phoenix/core/constants/storage_keys.dart';
import 'package:phoenix/core/services/auth_event_bus.dart';
import 'package:phoenix/core/services/secure_storage_service.dart';

class AuthInterceptor extends Interceptor {
  AuthInterceptor({required SecureStorageService secureStorage})
    : _secureStorage = secureStorage;

  final SecureStorageService _secureStorage;

  @override
  Future<void> onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    final token = await _secureStorage.read(StorageKeys.authToken);
    if (token != null && token.isNotEmpty) {
      options.headers['Authorization'] = 'Bearer $token';
    }
    handler.next(options);
  }

  // A 401 on an authenticated endpoint means the stored token is no longer
  // valid (expired, or the account was blocked/removed). Signal it once,
  // app-wide, so AuthCubit runs the single logout flow - clearing the token,
  // resetting auth state and sending the user to Login - instead of every
  // Cubit that made a request having to notice and react on its own.
  //
  // The error still flows on to the caller (`handler.next(err)`), so the
  // screen that fired the request keeps showing its usual "session expired"
  // message during the brief moment before navigation.
  //
  // The unauthenticated entry points (login / register / OTP) are skipped:
  // a 401 there is "wrong phone or password", not an expired session, and
  // must not trigger a logout/redirect.
  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    if (err.response?.statusCode == 401 &&
        !_isUnauthenticatedEndpoint(err.requestOptions.path)) {
      AuthEventBus.instance.emitUnauthorized();
    }
    handler.next(err);
  }

  static bool _isUnauthenticatedEndpoint(String path) {
    return path.contains('/auth/login') ||
        path.contains('/auth/register') ||
        path.contains('/auth/otp');
  }
}
