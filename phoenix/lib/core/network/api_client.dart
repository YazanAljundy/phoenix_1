import 'package:dio/dio.dart';
import 'package:feniq/config/app_config.dart';
import 'package:feniq/core/network/interceptors/auth_interceptor.dart';
import 'package:feniq/core/services/secure_storage_service.dart';

class ApiClient {
  ApiClient({required SecureStorageService secureStorage})
    : _dio = Dio(_baseOptions()) {
    _dio.interceptors.add(
      AuthInterceptor(
        secureStorage: secureStorage,
        // Replays a request through this same client after a refresh, so the
        // replay goes back through the interceptor and picks up the new token.
        retryClient: _dio,
        // A bare client with no interceptors for POST /auth/refresh itself -
        // see the note in AuthInterceptor about why it must not re-enter.
        refreshClient: Dio(_baseOptions()),
      ),
    );
  }

  static BaseOptions _baseOptions() => BaseOptions(
    baseUrl: AppConfig.apiBaseUrl,
    connectTimeout: const Duration(seconds: 15),
    receiveTimeout: const Duration(seconds: 15),
  );

  final Dio _dio;

  Dio get dio => _dio;
}
