import 'package:phoenix/features/auth/data/models/pharmacy_model.dart';
import 'package:phoenix/features/auth/data/models/user_model.dart';

// Drives routing decisions (splash -> registration / approval-pending / home).
enum SessionStatus { unknown, unauthenticated, pendingApproval, blocked, active }

class AuthState {
  const AuthState({
    this.sessionStatus = SessionStatus.unknown,
    this.isSubmitting = false,
    this.errorMessage,
    this.errorCode,
    this.otpSent = false,
    this.user,
    this.pharmacy,
  });

  final SessionStatus sessionStatus;
  final bool isSubmitting;
  final String? errorMessage;
  // Machine-readable error id (a FailureCode for transport errors) so the
  // view can localize it via translateErrorCode. Null for the auth
  // endpoints that only send an English message.
  final String? errorCode;
  final bool otpSent;
  final UserModel? user;
  final PharmacyModel? pharmacy;

  AuthState copyWith({
    SessionStatus? sessionStatus,
    bool? isSubmitting,
    String? errorMessage,
    String? errorCode,
    bool clearError = false,
    bool? otpSent,
    UserModel? user,
    PharmacyModel? pharmacy,
  }) {
    return AuthState(
      sessionStatus: sessionStatus ?? this.sessionStatus,
      isSubmitting: isSubmitting ?? this.isSubmitting,
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
      errorCode: clearError ? null : (errorCode ?? this.errorCode),
      otpSent: otpSent ?? this.otpSent,
      user: user ?? this.user,
      pharmacy: pharmacy ?? this.pharmacy,
    );
  }
}
