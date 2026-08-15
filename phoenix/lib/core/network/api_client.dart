import 'package:dio/dio.dart';
import 'package:phoenix/config/app_config.dart';
import 'package:phoenix/core/network/interceptors/auth_interceptor.dart';
import 'package:phoenix/core/services/secure_storage_service.dart';

class ApiClient {
  ApiClient({required SecureStorageService secureStorage})
    : _dio = Dio(
        BaseOptions(
          baseUrl: AppConfig.apiBaseUrl,
          connectTimeout: const Duration(seconds: 15),
          receiveTimeout: const Duration(seconds: 15),
        ),
      ) {
    _dio.interceptors.add(AuthInterceptor(secureStorage: secureStorage));
  }

  final Dio _dio;

  Dio get dio => _dio;
}
