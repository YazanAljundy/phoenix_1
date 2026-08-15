import 'package:dio/dio.dart';
import 'package:image_picker/image_picker.dart';
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
    required String otpCode,
    required String password,
    required XFile verificationPhoto,
  }) async {
    try {
      final photoBytes = await verificationPhoto.readAsBytes();
      final formData = FormData.fromMap({
        'name': name,
        'pharmacyName': pharmacyName,
        'phone': phone,
        'address': address,
        'otpCode': otpCode,
        'password': password,
        'confirmPassword': password,
        'verificationPhoto': MultipartFile.fromBytes(
          photoBytes,
          filename: verificationPhoto.name,
        ),
      });
      final response = await _apiClient.dio.post(Endpoints.register, data: formData);
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
}
