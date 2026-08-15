import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:image_picker/image_picker.dart';
import 'package:phoenix/core/constants/storage_keys.dart';
import 'package:phoenix/core/error/failure.dart';
import 'package:phoenix/core/services/secure_storage_service.dart';
import 'package:phoenix/features/auth/data/models/user_model.dart';
import 'package:phoenix/features/auth/data/repositories/auth_repository_impl.dart';

import 'auth_state.dart';

class AuthCubit extends Cubit<AuthState> {
  AuthCubit({
    required AuthRepositoryImpl authRepository,
    required SecureStorageService secureStorage,
  }) : _authRepository = authRepository,
       _secureStorage = secureStorage,
       super(const AuthState());

  final AuthRepositoryImpl _authRepository;
  final SecureStorageService _secureStorage;

  Future<void> checkSession() async {
    try {
      final token = await _secureStorage.read(StorageKeys.authToken);
      if (token == null || token.isEmpty) {
        emit(state.copyWith(sessionStatus: SessionStatus.unauthenticated));
        return;
      }

      final me = await _authRepository.getMe();
      emit(
        state.copyWith(
          sessionStatus: _sessionStatusFor(me.user),
          user: me.user,
          pharmacy: me.pharmacy,
        ),
      );
    } catch (_) {
      try {
        await _secureStorage.delete(StorageKeys.authToken);
      } catch (_) {
        // Best-effort cleanup - falling through to unauthenticated regardless.
      }
      emit(state.copyWith(sessionStatus: SessionStatus.unauthenticated));
    }
  }

  Future<bool> sendOtp(String phone) async {
    emit(state.copyWith(isSubmitting: true, clearError: true));
    try {
      await _authRepository.sendOtp(phone);
      emit(state.copyWith(isSubmitting: false, otpSent: true));
      return true;
    } on Failure catch (f) {
      emit(state.copyWith(isSubmitting: false, errorMessage: f.errMessage));
      return false;
    }
  }

  // Also serves as the returning-user re-entry path: if `phone` already has an
  // account, the backend logs it back in and ignores
  // name/pharmacyName/address/password/verificationPhoto.
  Future<bool> register({
    required String name,
    required String pharmacyName,
    required String phone,
    required String address,
    required String otpCode,
    required String password,
    required XFile verificationPhoto,
  }) async {
    emit(state.copyWith(isSubmitting: true, clearError: true));
    try {
      final result = await _authRepository.register(
        name: name,
        pharmacyName: pharmacyName,
        phone: phone,
        address: address,
        otpCode: otpCode,
        password: password,
        verificationPhoto: verificationPhoto,
      );
      await _secureStorage.write(StorageKeys.authToken, result.token);
      emit(
        state.copyWith(
          isSubmitting: false,
          sessionStatus: _sessionStatusFor(result.user),
          user: result.user,
          pharmacy: result.pharmacy,
        ),
      );
      return true;
    } on Failure catch (f) {
      emit(state.copyWith(isSubmitting: false, errorMessage: f.errMessage));
      return false;
    }
  }

  // Section 6-2: phone + password, no OTP - only usable after an account
  // already went through register() at least once.
  Future<bool> loginWithPassword({required String phone, required String password}) async {
    emit(state.copyWith(isSubmitting: true, clearError: true));
    try {
      final result = await _authRepository.loginWithPassword(phone: phone, password: password);
      await _secureStorage.write(StorageKeys.authToken, result.token);
      emit(
        state.copyWith(
          isSubmitting: false,
          sessionStatus: _sessionStatusFor(result.user),
          user: result.user,
          pharmacy: result.pharmacy,
        ),
      );
      return true;
    } on Failure catch (f) {
      emit(state.copyWith(isSubmitting: false, errorMessage: f.errMessage));
      return false;
    }
  }

  Future<void> logout() async {
    await _secureStorage.delete(StorageKeys.authToken);
    emit(const AuthState(sessionStatus: SessionStatus.unauthenticated));
  }

  SessionStatus _sessionStatusFor(UserModel user) {
    if (user.isBlocked) return SessionStatus.blocked;
    if (user.isPending) return SessionStatus.pendingApproval;
    return SessionStatus.active;
  }
}
