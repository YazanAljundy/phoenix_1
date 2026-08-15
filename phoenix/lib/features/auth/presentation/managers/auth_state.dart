import 'package:phoenix/features/auth/data/models/pharmacy_model.dart';
import 'package:phoenix/features/auth/data/models/user_model.dart';

// Drives routing decisions (splash -> registration / approval-pending / home).
enum SessionStatus { unknown, unauthenticated, pendingApproval, blocked, active }

class AuthState {
  const AuthState({
    this.sessionStatus = SessionStatus.unknown,
    this.isSubmitting = false,
    this.errorMessage,
    this.otpSent = false,
    this.user,
    this.pharmacy,
  });

  final SessionStatus sessionStatus;
  final bool isSubmitting;
  final String? errorMessage;
  final bool otpSent;
  final UserModel? user;
  final PharmacyModel? pharmacy;

  AuthState copyWith({
    SessionStatus? sessionStatus,
    bool? isSubmitting,
    String? errorMessage,
    bool clearError = false,
    bool? otpSent,
    UserModel? user,
    PharmacyModel? pharmacy,
  }) {
    return AuthState(
      sessionStatus: sessionStatus ?? this.sessionStatus,
      isSubmitting: isSubmitting ?? this.isSubmitting,
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
      otpSent: otpSent ?? this.otpSent,
      user: user ?? this.user,
      pharmacy: pharmacy ?? this.pharmacy,
    );
  }
}
