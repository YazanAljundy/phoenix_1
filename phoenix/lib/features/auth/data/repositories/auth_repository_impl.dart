import 'package:dio/dio.dart';
import 'package:phoenix/core/error/failure.dart';
import 'package:phoenix/core/network/api_client.dart';
import 'package:phoenix/core/network/endpoints.dart';
import 'package:phoenix/features/auth/data/models/auth_response.dart';
import 'package:phoenix/features/auth/data/models/me_response.dart';

import 'auth_repository.dart';

class AuthRepositoryImpl implements AuthRepository {
  AuthRepositoryImpl({required ApiClient apiClient}) : _apiClient = apiClient;

  final ApiClient _apiClient;

  @override
  Future<void> sendOtp(String phone) async {
    try {
      await _apiClient.dio.post(Endpoints.sendOtp, data: {'phone': phone});
    } on DioException catch (e) {
      throw ServerFailure.fromDioError(e);
    }
  }

  @override
  Future<AuthResponse> register({
    required String name,
    required String pharmacyName,
    required String phone,
    required String address,
    required String password,
    double? latitude,
    double? longitude,
  }) async {
    try {
      final response = await _apiClient.dio.post(
        Endpoints.register,
        data: {
          'name': name,
          'pharmacyName': pharmacyName,
          'phone': phone,
          'address': address,
          'password': password,
          'confirmPassword': password,
          if (latitude != null && longitude != null) 'latitude': latitude,
          if (latitude != null && longitude != null) 'longitude': longitude,
        },
      );
      return AuthResponse.fromJson(response.data as Map<String, dynamic>);
    } on DioException catch (e) {
      throw ServerFailure.fromDioError(e);
    }
  }

  @override
  Future<AuthResponse> loginWithPassword({required String phone, required String password}) async {
    try {
      final response = await _apiClient.dio.post(
        Endpoints.loginPassword,
        data: {'phone': phone, 'password': password},
      );
      return AuthResponse.fromJson(response.data as Map<String, dynamic>);
    } on DioException catch (e) {
      throw ServerFailure.fromDioError(e);
    }
  }

  @override
  Future<MeResponse> getMe() async {
    try {
      final response = await _apiClient.dio.get(Endpoints.me);
      return MeResponse.fromJson(response.data as Map<String, dynamic>);
    } on DioException catch (e) {
      throw ServerFailure.fromDioError(e);
    }
  }

  @override
  Future<void> registerDeviceToken({required String fcmToken, required String deviceType}) async {
    try {
      await _apiClient.dio.post(
        Endpoints.deviceToken,
        data: {'fcmToken': fcmToken, 'deviceType': deviceType},
      );
    } on DioException catch (e) {
      throw ServerFailure.fromDioError(e);
    }
  }
}
