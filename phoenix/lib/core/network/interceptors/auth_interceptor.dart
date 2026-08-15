import 'package:dio/dio.dart';
import 'package:phoenix/core/constants/storage_keys.dart';
import 'package:phoenix/core/services/secure_storage_service.dart';

// Attaches the stored JWT to every outgoing request. The token is written to
// secure storage by AuthCubit on successful register/login.
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
}
