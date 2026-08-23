import 'dart:async';

import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:phoenix/core/constants/storage_keys.dart';
import 'package:phoenix/core/error/failure.dart';
import 'package:phoenix/core/services/fcm_service.dart';
import 'package:phoenix/core/services/secure_storage_service.dart';
import 'package:phoenix/features/auth/data/models/user_model.dart';
import 'package:phoenix/features/auth/data/repositories/auth_repository_impl.dart';

import 'auth_state.dart';

class AuthCubit extends Cubit<AuthState> {
  AuthCubit({
    required AuthRepositoryImpl authRepository,
    required SecureStorageService secureStorage,
    required FcmService fcmService,
  }) : _authRepository = authRepository,
       _secureStorage = secureStorage,
       _fcmService = fcmService,
       super(const AuthState());

  final AuthRepositoryImpl _authRepository;
  final SecureStorageService _secureStorage;
  final FcmService _fcmService;

  Future<void> checkSession() async {
    try {
      final token = await _secureStorage.read(StorageKeys.authToken);
      if (token == null || token.isEmpty) {
        emit(state.copyWith(sessionStatus: SessionStatus.unauthenticated));
        return;
      }

      final me = await _authRepository.getMe();
      final sessionStatus = _sessionStatusFor(me.user);
      emit(
        state.copyWith(
          sessionStatus: sessionStatus,
          user: me.user,
          pharmacy: me.pharmacy,
        ),
      );
      _registerForPushIfActive(sessionStatus);
    } catch (_) {
      try {
        await _secureStorage.delete(StorageKeys.authToken);
      } catch (_) {
        // Best-effort cleanup - falling through to unauthenticated regardless.
      }
      emit(state.copyWith(sessionStatus: SessionStatus.unauthenticated));
    }
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
      emit(state.copyWith(isSubmitting: false, errorMessage: f.errMessage));
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
      emit(state.copyWith(isSubmitting: false, errorMessage: f.errMessage));
      return false;
    }
  }

  Future<void> logout() async {
    await _secureStorage.delete(StorageKeys.authToken);
    emit(const AuthState(sessionStatus: SessionStatus.unauthenticated));
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
}
